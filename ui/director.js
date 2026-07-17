import { DIRECTOR_PROFILE } from './director_actor.js';
import { findPath, getNeighbors } from './pathfinding.js';
import { callLLM } from './llm.js';
import { STORY_REGISTRY } from './storyManager.js';

export async function runDirector(state, playerAction, logGame, logDirector, isLLMActive) {
    // Update dynamic critical objectives for all actors
    updateCriticalObjectives(state);

    // Initialize plan if missing
    if (!state.directorPlan) {
        state.directorPlan = {
            steps: [],
            currentGoal: state.activeMilestoneId || state.storyDag.startNodeId
        };
    }

    // 1. Always execute content-defined heuristics and events first
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (activeMilestone && typeof activeMilestone.heuristics === 'function') {
        activeMilestone.heuristics(state, logGame, logDirector);
    }

    // 2. Calculate dynamic pressure level
    const { pressure, mode } = calculateNarrativePressure(state);
    state.directorMode = mode;

    logDirector(`Pressure calculation: P = ${pressure.toFixed(2)} (Mode: ${mode})`);

    // 3. Plan verification: If there is a scheduled intervention for this turn, check if it matches the current required mode
    let hasValidScheduledStep = false;
    let nextStepIndex = state.directorPlan.steps.findIndex(step => step.turn === state.turn);

    if (nextStepIndex !== -1) {
        const step = state.directorPlan.steps[nextStepIndex];
        // If current pressure mode is at least the planned step intensity, we execute it
        const intensityMap = { "Passive Monitor": 0, "Soft Nudges": 1, "Medium Nudges": 2, "Strong Nudges": 3 };
        const currentIntensity = intensityMap[mode];
        const stepIntensity = intensityMap[step.mode] || 0;

        if (currentIntensity >= stepIntensity) {
            hasValidScheduledStep = true;
            logDirector(`[Plan Execution] Executing planned step for turn ${state.turn}: ${step.nudgeDescription || 'nudge'}`);
            if (step.mutations) {
                executeMutations(state, step.mutations, logGame, logDirector);
            }
            if (step.nudgeDescription) {
                logGame("director-announce", `<i><b>Fate Shift:</b> ${step.nudgeDescription}</i>`);
            }
            // Remove executed step
            state.directorPlan.steps.splice(nextStepIndex, 1);
        } else {
            logDirector(`[Plan Flexing] Urgency is low (${mode}). Skipping planned step: ${step.nudgeDescription}`);
        }
    }

    if (hasValidScheduledStep) {
        return; // Deterministic step ran, bypass LLM
    }

    // 4. If no step ran, and we need nudges (P > 0.5), call LLM to generate a new plan
    if (isLLMActive && mode !== "Passive Monitor") {
        try {
            await runDirectorLLM(state, playerAction, logGame, logDirector, mode);
        } catch (e) {
            console.warn("Director LLM failed.", e);
        }
    }
}

function calculateNarrativePressure(state) {
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (!activeMilestone) return { pressure: 0, mode: "Passive Monitor" };

    const maxTurns = activeMilestone.maxTurns || 10;
    const milestoneStart = state.milestoneStartTurn || 1;
    const elapsed = state.turn - milestoneStart;
    const remainingTurns = Math.max(1, maxTurns - elapsed);

    const config = activeMilestone.pressureConfig || {};
    const targetRoom = config.targetRoom;

    if (!targetRoom) {
        return { pressure: 0, mode: "Passive Monitor" };
    }

    // Find player distance to targetRoom
    const playerPath = findPath(state.playerLocation, targetRoom, state.blockedConnections);
    const playerDist = playerPath ? playerPath.length - 1 : 5; // Fallback to 5 if unreachable

    // Find key actor distances if they have the key items
    let actorDist = 0;
    if (config.keyActors && config.keyActors.length > 0) {
        config.keyActors.forEach(actorId => {
            const actor = state.actors[actorId];
            if (actor) {
                const carriesKeyItem = !config.keyItems || config.keyItems.length === 0 || 
                                       config.keyItems.some(item => actor.inventory.includes(item));
                if (carriesKeyItem) {
                    const actorPath = findPath(actor.location, targetRoom, state.blockedConnections);
                    actorDist += actorPath ? actorPath.length - 1 : 3;
                }
            }
        });
    }

    const totalDist = playerDist + actorDist;
    const pressure = totalDist / remainingTurns;
    
    let mode = "Passive Monitor";
    if (pressure <= 0.5) mode = "Passive Monitor";
    else if (pressure <= 1.0) mode = "Soft Nudges";
    else if (pressure <= 1.5) mode = "Medium Nudges";
    else if (pressure <= 2.0) mode = "Strong Nudges";
    else mode = "Creative Fate Correction";

    // Stall warning escalation
    const stallCount = state._playerTurnStallCount || 0;
    if (stallCount >= 5) {
        mode = "Creative Fate Correction";
    } else if (stallCount >= 3) {
        mode = "Strong Nudges";
    } else if (stallCount >= 2) {
        if (mode === "Passive Monitor") {
            mode = "Soft Nudges";
        }
    }

    // Turn warning escalation (last turn or two of the milestone always escalate pressure)
    if (remainingTurns <= 1) {
        mode = "Creative Fate Correction";
    } else if (remainingTurns <= 2) {
        if (mode !== "Creative Fate Correction") {
            mode = "Strong Nudges";
        }
    }

    return { pressure, mode };
}

function executeMutations(state, mutations, logGame, logDirector) {
    if (!Array.isArray(mutations)) return;

    mutations.forEach(mut => {
        if (!mut || typeof mut !== 'object') return;

        switch (mut.type) {
            case "spawn_actor":
                const actorDef = mut.actorDef;
                if (actorDef && actorDef.id) {
                    const currentActorCount = Object.keys(state.actors).length;
                    if (currentActorCount < 6) {
                        state.actors[actorDef.id] = {
                            ...actorDef,
                            location: mut.location || actorDef.location || "square",
                            inventory: actorDef.inventory || [],
                            activePlan: [],
                            longTermGoal: null,
                            memories: []
                        };
                        
                        const spawned = state.actors[actorDef.id];
                        const storySpec = STORY_REGISTRY[state.activeStoryId] || STORY_REGISTRY.castle;
                        if (storySpec && storySpec.actors[spawned.id]) {
                            spawned.heuristics = storySpec.actors[spawned.id].heuristics;
                            spawned.subscriptions = storySpec.actors[spawned.id].subscriptions;
                        }
                        
                        logDirector(`Mutation: Spawned dynamic actor ${actorDef.name} at ${state.storyRooms[spawned.location].name}`);
                        logGame("system", `<i>${actorDef.name} has arrived in the world.</i>`);
                    } else {
                        logDirector(`Mutation: Spawn skipped. Actor limit reached (${currentActorCount}/6).`);
                    }
                }
                break;

            case "move_actor":
                const dest = mut.target;
                if (dest && state.storyRooms[dest]) {
                    if (mut.actorId === "player") {
                        state.playerLocation = dest;
                        logDirector(`Mutation: Moved player to ${state.storyRooms[dest].name}`);
                    } else {
                        const actor = state.actors[mut.actorId];
                        if (actor) {
                            actor.location = dest;
                            logDirector(`Mutation: Moved ${actor.name} to ${state.storyRooms[dest].name}`);
                            
                            if (state.followingActorId === mut.actorId) {
                                state.playerLocation = dest;
                                logGame("system", `<i>You follow ${actor.name} to the ${state.storyRooms[dest].name}.</i>`);
                            }
                        }
                    }
                }
                break;

            case "transfer_item":
                const item = mut.item;
                let fromActor = state.actors[mut.from];
                let toActor = state.actors[mut.to];

                if (fromActor && toActor) {
                    fromActor.inventory = fromActor.inventory.filter(i => i !== item);
                    toActor.inventory.push(item);
                    logDirector(`Mutation: Transferred ${item} from ${mut.from} to ${mut.to}`);
                }
                break;

            case "block_path":
                const conn = mut.connection;
                if (conn && !state.blockedConnections.includes(conn)) {
                    state.blockedConnections.push(conn);
                    logDirector(`Mutation: Blocked path ${conn}`);
                }
                break;

            case "unblock_path":
                const unconn = mut.connection;
                state.blockedConnections = state.blockedConnections.filter(c => c !== unconn);
                logDirector(`Mutation: Unblocked path ${unconn}`);
                break;

            case "set_desires":
                const actor = state.actors[mut.actorId];
                if (actor && mut.desires && typeof mut.desires === 'object') {
                    for (let desireKey in mut.desires) {
                        actor.desires[desireKey] = mut.desires[desireKey];
                    }
                    logDirector(`Mutation: Set desires of ${actor.name} to ${JSON.stringify(mut.desires)}`);
                }
                break;

            default:
                console.warn(`Unknown mutation type: ${mut.type}`);
        }
    });
}

async function runDirectorLLM(state, playerAction, logGame, logDirector, targetMode) {
    let actorStatusList = Object.values(state.actors).map(a => 
        `- ${a.name} (Role: ${a.role}) is at ${a.location}. Inventory: ${JSON.stringify(a.inventory)}.`
    ).join('\n');

    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];

    // --- Build dynamic prompt values from live state ---

    // Actor roster: one line per NPC with name, role, and id
    const actorRoster = Object.values(state.actors)
        .map(a => `- ${a.name} (${a.role}, id: "${a.id}")`)
        .join('\n');

    // Valid actorId options for mutations (NPC IDs only; "player" is added verbatim in the template)
    const actorIds = Object.keys(state.actors)
        .map(id => `"${id}"`)
        .join(' | ');

    // Valid target room options for move_actor mutations
    const roomIds = Object.keys(state.storyRooms)
        .map(k => `"${k}"`)
        .join(' | ');

    // Key items: union of all items currently held by any actor or the player
    const allItems = new Set();
    Object.values(state.actors).forEach(a => a.inventory.forEach(i => allItems.add(i)));
    (state.playerInventory || []).forEach(i => allItems.add(i));
    const keyItems = allItems.size > 0
        ? [...allItems].map(i => `"${i}"`).join(' | ')
        : '"(no items in circulation)"';

    let systemPrompt = DIRECTOR_PROFILE.promptTemplate
        .replace('{goal_desc}', activeMilestone.description)
        .replace('{max_turns}', activeMilestone.maxTurns)
        .replace('{actor_roster}', actorRoster)
        .replaceAll('{actor_ids}', actorIds)
        .replace('{room_ids}', roomIds)
        .replace('{key_items}', keyItems);

    const prompt = `Current Turn: ${state.turn}
Required Intervention Mode: ${targetMode} (You must match this mode)
Player is currently at: ${state.playerLocation}
Actor Statuses:
${actorStatusList}
Blocked connections: ${state.blockedConnections.join(', ') || 'None'}
Player's last action: "${playerAction}"

Formulate your immediate nudge, any state mutations, and a flexible plan of steps for future turns.`;

    const res = await callLLM(prompt, systemPrompt, "director");
    console.log("Director LLM output:", res);

    state.directorMode = res.mode || targetMode;

    // Apply immediate mutations
    if (res.mutations) {
        executeMutations(state, res.mutations, logGame, logDirector);
    }

    if (res.nudgeDescription) {
        logGame("director-announce", `<i><b>Fate Shift:</b> ${res.nudgeDescription}</i>`);
        logDirector(res.nudgeDescription);
    }

    // Store future plan steps
    if (res.plan_steps && Array.isArray(res.plan_steps)) {
        res.plan_steps.forEach(step => {
            if (step && step.turn > state.turn) {
                step.mode = step.mode || state.directorMode;
                const existingIdx = state.directorPlan.steps.findIndex(s => s.turn === step.turn);
                if (existingIdx !== -1) {
                    state.directorPlan.steps[existingIdx] = step;
                } else {
                    state.directorPlan.steps.push(step);
                }
            }
        });
        logDirector(`[Plan Formulation] Director planned future interventions: ${JSON.stringify(state.directorPlan.steps)}`);
    }
}

/**
 * Dynamically computes a role-appropriate "critical objective" for each actor 
 * based on the current turn, following status, inventories, and room locations.
 */
export function updateCriticalObjectives(state) {
    // Clear old critical objectives first
    for (let id in state.actors) {
        state.actors[id].criticalObjective = null;
    }

    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (activeMilestone && typeof activeMilestone.updateObjectives === 'function') {
        activeMilestone.updateObjectives(state);
    }
}
