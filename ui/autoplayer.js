import { AUTOPLAYER_PROMPT_TEMPLATE } from './content.js';
import { findPath, getNeighbors } from './pathfinding.js';
import { callLLM } from './llm.js';

// --- AUTOPLAYER: Acts as the player-character brain each tick ---

const DEFAULT_MAX_CONVERSATION_ROUNDS = 2;

/**
 * Produces a tool_call object (same shape as the tool-calling parser) that
 * represents the AutoPlayer's chosen action for this turn.
 *
 * @param {object} state   - Full game state
 * @param {boolean} isLLMActive - Whether the backend LLM is reachable
 * @returns {Promise<{tool_name: string, arguments: object}>}
 */
export async function runAutoPlayer(state, isLLMActive) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    const maxRounds = activeMilestone?.maxConversationRounds ?? DEFAULT_MAX_CONVERSATION_ROUNDS;

    // Reset all conversation state whenever the player moves to a new room
    if (state._autoPlayerLastLocation !== state.playerLocation) {
        state._autoPlayerLastLocation = state.playerLocation;
        state._autoPlayerConversedThisPause = false;
        state._autoConversationTarget = null;
        state._autoConversationRounds = 0;
    }

    // --- CASE 1: Mid-conversation — continue or close ---
    if (state._autoConversationTarget) {
        const target = state.actors[state._autoConversationTarget];
        const targetStillPresent = target && target.location === state.playerLocation;

        if (targetStillPresent && state._autoConversationRounds < maxRounds) {
            // Continue the conversation for another round
            state._autoConversationRounds++;
            return { tool_name: 'converse', arguments: { character_id: state._autoConversationTarget } };
        } else {
            // Conversation is over — close it and hand off to the Director
            console.log(`[AutoPlayer] Conversation with ${state._autoConversationTarget} closed after ${state._autoConversationRounds} round(s).`);
            state._autoConversationTarget = null;
            state._autoConversationRounds = 0;
            state._autoPlayerConversedThisPause = true;
            // Issue a ticking wait so the Director runs before we move
            return { tool_name: 'wait', arguments: {} };
        }
    }

    // --- CASE 2: Already conversed this room visit — move or wait ---
    if (state._autoPlayerConversedThisPause) {
        return runMoveOrWait(state);
    }

    // --- CASE 3: Start a new conversation or choose another action ---
    let result;
    if (isLLMActive) {
        try {
            result = await runAutoPlayerLLM(state);
        } catch (e) {
            console.warn('[AutoPlayer] LLM failed, falling back to heuristics.', e);
            result = runAutoPlayerHeuristic(state);
        }
    } else {
        result = runAutoPlayerHeuristic(state);
    }

    // If the chosen action starts a conversation, initialise the round tracker
    if (result.tool_name === 'converse') {
        state._autoConversationTarget = result.arguments.character_id;
        state._autoConversationRounds = 1; // This first call counts as round 1
    }
    // Examine is a one-shot non-ticking action — mark it so we don't loop
    if (result.tool_name === 'examine') {
        state._autoPlayerConversedThisPause = true;
    }

    return result;
}

function getEffectiveTargetRoom(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (!activeMilestone) return null;

    const targetRoom = activeMilestone.pressureConfig?.targetRoom;
    const keyItems = activeMilestone.pressureConfig?.keyItems || [];

    // Find any key items required for this milestone that the player is missing
    const missingItem = keyItems.find(item => !state.playerInventory || !state.playerInventory.includes(item));

    if (missingItem) {
        for (const actorId in state.actors) {
            const actor = state.actors[actorId];
            if (actor.inventory && actor.inventory.includes(missingItem)) {
                console.log(`[AutoPlayer] Missing key item "${missingItem}". Located holder: ${actor.name} at ${actor.location}.`);
                return actor.location; // Redirect pathfinding to recover the key item!
            }
        }
    }

    return targetRoom;
}

async function runAutoPlayerLLM(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    const neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
    const presentNPCs = Object.values(state.actors)
        .filter(a => a.location === state.playerLocation)
        .map(a => `${a.name} (${a.role}, id: ${a.id})`)
        .join(', ') || 'Nobody';

    const playerPersona = activeMilestone?.playerPersona ||
        'a cautious traveler trying to do what is right';

    // Compute pathfinding hint so the LLM knows which direction is "toward the goal"
    const targetRoom = getEffectiveTargetRoom(state);
    let nextStepHint = 'No specific destination required — explore freely.';
    if (targetRoom && state.playerLocation !== targetRoom) {
        const path = findPath(state.playerLocation, targetRoom, state.blockedConnections);
        if (path && path.length > 1) {
            const nextRoomId = path[1];
            nextStepHint = `Go to ${state.storyRooms[nextRoomId].name} (${nextRoomId}) — this is the next step on the optimal path to your objective.`;
        }
    } else if (targetRoom && state.playerLocation === targetRoom) {
        nextStepHint = `You are already at the objective location (${state.storyRooms[targetRoom].name}). Stay or interact.`;
    }

    let allowedTools = ['travel', 'wait', 'examine'];
    let presentNPCsText = presentNPCs;
    if (!state._autoPlayerConversedThisPause && presentNPCs !== 'Nobody') {
        allowedTools.push('converse');
    } else if (presentNPCs !== 'Nobody') {
        presentNPCsText = `${presentNPCs} (You already spoke to them during this visit. Converse is disabled.)`;
    }

    const systemPrompt = AUTOPLAYER_PROMPT_TEMPLATE
        .replace('{player_persona}', playerPersona)
        .replace('{location}', `${state.storyRooms[state.playerLocation].name} (${state.playerLocation})`)
        .replace('{inventory}', JSON.stringify(state.playerInventory || []))
        .replace('{objective}', activeMilestone?.description || 'Progress the story.')
        .replace('{present_npcs}', presentNPCsText)
        .replace('{neighbors}', neighbors.map(n => `${n} (${state.storyRooms[n].name})`).join(', ') || 'none')
        .replace('{next_step_hint}', nextStepHint)
        .replace('"tool_name": "travel" | "converse" | "wait" | "examine"', `"tool_name": ${allowedTools.map(t => `"${t}"`).join(' | ')}`);

    const prompt = `Decide your action for this turn.`;
    const res = await callLLM(prompt, systemPrompt, "autoplayer");

    if (res?.tool_name) {
        if (res.thought) {
            console.log(`[AutoPlayer thought] ${res.thought}`);
        }
        // Validate travel destination
        if (res.tool_name === 'travel') {
            const dest = res.arguments?.destination;
            if (!dest || !neighbors.includes(dest)) {
                console.warn(`[AutoPlayer] LLM chose invalid travel destination "${dest}", falling back.`);
                return runMoveOrWait(state);
            }
        }
        // Validate conversation target
        if (res.tool_name === 'converse') {
            const charId = res.arguments?.character_id;
            const keyActors = activeMilestone?.pressureConfig?.keyActors || [];
            if (!charId || !keyActors.includes(charId)) {
                console.warn(`[AutoPlayer] LLM chose to converse with non-key actor "${charId}", falling back to navigation.`);
                return runMoveOrWait(state);
            }
        }
        return { tool_name: res.tool_name, arguments: res.arguments || {} };
    }

    return runMoveOrWait(state);
}

// --- HEURISTIC FALLBACK ---

function runAutoPlayerHeuristic(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    const keyActors = activeMilestone?.pressureConfig?.keyActors || [];
    const presentNPCs = Object.values(state.actors)
        .filter(a => a.location === state.playerLocation);
        
    const relevantNPCs = presentNPCs.filter(a => keyActors.includes(a.id));

    if (relevantNPCs.length > 0 && !state._autoPlayerConversedThisPause) {
        const priorityNPC = relevantNPCs[0];
        state._autoPlayerConversedThisPause = true;
        return {
            tool_name: 'converse',
            arguments: { character_id: priorityNPC.id }
        };
    }

    return runMoveOrWait(state);
}

// --- SHARED MOVE-OR-WAIT LOGIC ---

function runMoveOrWait(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    const neighbors = getNeighbors(state.playerLocation, state.blockedConnections);

    // 1-in-3 chance: inject a wait turn for pacing / Director breathing room
    // Skip this random wait if pressure is high or player is stalling
    const isPassive = (!state.directorMode || state.directorMode === "Passive Monitor");
    const stallCount = state._playerTurnStallCount || 0;
    if (isPassive && stallCount < 2 && Math.random() < 1 / 3) {
        return { tool_name: 'wait', arguments: {} };
    }

    // Travel toward the milestone's target room (or the item holder's room if stolen)
    const targetRoom = getEffectiveTargetRoom(state);
    if (targetRoom && state.playerLocation !== targetRoom) {
        const path = findPath(state.playerLocation, targetRoom, state.blockedConnections);
        if (path && path.length > 1) {
            return { tool_name: 'travel', arguments: { destination: path[1] } };
        }
    } else if (targetRoom && state.playerLocation === targetRoom) {
        // If we are at the target room, instead of waiting, try interacting with a present NPC to trigger the objective
        const keyActors = activeMilestone?.pressureConfig?.keyActors || [];
        const presentNPCs = Object.values(state.actors).filter(a => a.location === state.playerLocation);
        if (presentNPCs.length > 0) {
            const targetNPC = presentNPCs.find(a => keyActors.includes(a.id)) || presentNPCs[0];
            return { tool_name: 'converse', arguments: { character_id: targetNPC.id } };
        }
    }

    // Default: wait
    return { tool_name: 'wait', arguments: {} };
}

// --- DECISION POINT GATE ---

/**
 * Checks whether the active milestone has any unresolved decision points
 * whose condition is currently satisfied. Returns the first matching one,
 * or null if none are ready.
 *
 * @param {object} state
 * @returns {object|null} The decision point definition, or null
 */
export function checkDecisionPoints(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (!activeMilestone?.decisionPoints) return null;

    if (!state.decisionsLog) state.decisionsLog = {};

    for (const dp of activeMilestone.decisionPoints) {
        // Skip already resolved decisions
        if (state.decisionsLog[dp.id]) continue;
        // Check if condition is met
        if (typeof dp.condition === 'function' && dp.condition(state)) {
            return dp;
        }
    }
    return null;
}
