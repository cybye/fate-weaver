import { ROOMS, STORY_DAG, AUTOPLAYER_PROMPT_TEMPLATE } from './content.js';
import { findPath, getNeighbors } from './pathfinding.js';
import { callOllama } from './ollama.js';

// --- AUTOPLAYER: Acts as the player-character brain each tick ---

const DEFAULT_MAX_CONVERSATION_ROUNDS = 2;

/**
 * Produces a tool_call object (same shape as the tool-calling parser) that
 * represents the AutoPlayer's chosen action for this turn.
 *
 * @param {object} state   - Full game state
 * @param {boolean} isLLMActive - Whether Ollama is reachable
 * @returns {Promise<{tool_name: string, arguments: object}>}
 */
export async function runAutoPlayer(state, isLLMActive) {
    const activeMilestone = STORY_DAG.nodes[state.activeMilestoneId];
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

// --- LLM BRANCH ---

async function runAutoPlayerLLM(state) {
    const activeMilestone = STORY_DAG.nodes[state.activeMilestoneId];
    const neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
    const presentNPCs = Object.values(state.actors)
        .filter(a => a.location === state.playerLocation)
        .map(a => `${a.name} (${a.role}, id: ${a.id})`)
        .join(', ') || 'Nobody';

    const playerPersona = activeMilestone?.playerPersona ||
        'a cautious traveler trying to do what is right';

    const systemPrompt = AUTOPLAYER_PROMPT_TEMPLATE
        .replace('{player_persona}', playerPersona)
        .replace('{location}', `${ROOMS[state.playerLocation].name} (${state.playerLocation})`)
        .replace('{inventory}', JSON.stringify(state.playerInventory || []))
        .replace('{objective}', activeMilestone?.description || 'Progress the story.')
        .replace('{present_npcs}', presentNPCs)
        .replace('{neighbors}', neighbors.map(n => `${n} (${ROOMS[n].name})`).join(', ') || 'none');

    const prompt = `Decide your action for this turn.`;
    const res = await callOllama(prompt, systemPrompt);

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
        return { tool_name: res.tool_name, arguments: res.arguments || {} };
    }

    return runMoveOrWait(state);
}

// --- HEURISTIC FALLBACK ---

function runAutoPlayerHeuristic(state) {
    // Converse with a present NPC if we haven't yet this room visit
    const presentNPCs = Object.values(state.actors)
        .filter(a => a.location === state.playerLocation);

    if (presentNPCs.length > 0 && !state._autoPlayerConversedThisPause) {
        // Prefer story-relevant (keyActors) NPCs over bystanders
        const activeMilestone = STORY_DAG.nodes[state.activeMilestoneId];
        const keyActors = activeMilestone?.pressureConfig?.keyActors || [];
        const priorityNPC = presentNPCs.find(a => keyActors.includes(a.id)) || presentNPCs[0];

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
    const activeMilestone = STORY_DAG.nodes[state.activeMilestoneId];
    const neighbors = getNeighbors(state.playerLocation, state.blockedConnections);

    // 1-in-3 chance: inject a wait turn for pacing / Director breathing room
    if (Math.random() < 1 / 3) {
        return { tool_name: 'wait', arguments: {} };
    }

    // Travel toward the milestone's target room
    const targetRoom = activeMilestone?.pressureConfig?.targetRoom;
    if (targetRoom && state.playerLocation !== targetRoom) {
        const path = findPath(state.playerLocation, targetRoom, state.blockedConnections);
        if (path && path.length > 1) {
            return { tool_name: 'travel', arguments: { destination: path[1] } };
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
    const activeMilestone = STORY_DAG.nodes[state.activeMilestoneId];
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
