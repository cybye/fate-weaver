import { STORY_CONFIG as castleConfig } from './stories/castle.js';
import { STORY_CONFIG as alchemistConfig } from './stories/alchemist.js';
import { STORY_CONFIG as defendKeepConfig } from './stories/defendKeep.js';
import { STORY_CONFIG as voidPrologueConfig } from './stories/voidPrologue.js';
import { CAMPAIGN_ORDER } from './stories/campaign_order.js';
import { setConnections } from './pathfinding.js';

export const STORY_REGISTRY = {
    void_prologue: voidPrologueConfig,
    castle: castleConfig,
    alchemist_elixir: alchemistConfig,
    defend_keep: defendKeepConfig
};

/**
 * Validates a story configuration's referential integrity and its consistency
 * with the campaign order. Throws with a descriptive message on the first error
 * found, so authoring mistakes surface loudly instead of failing at runtime.
 * @param {Object} config - A STORY_CONFIG object.
 */
export function validateStory(config) {
    const where = config && config.id ? `story "${config.id}"` : 'story';
    if (!config || typeof config !== 'object') {
        throw new Error(`Invalid ${where}: expected a STORY_CONFIG object.`);
    }
    if (!config.id) throw new Error(`Invalid ${where}: missing "id".`);
    if (!config.rooms || typeof config.rooms !== 'object') throw new Error(`${where}: missing "rooms".`);
    if (!Array.isArray(config.connections)) throw new Error(`${where}: missing "connections".`);
    if (!config.storyDag || !config.storyDag.nodes) throw new Error(`${where}: missing "storyDag.nodes".`);
    if (!config.storyDag.startNodeId) throw new Error(`${where}: missing "storyDag.startNodeId".`);
    if (!config.storyDag.nodes[config.storyDag.startNodeId]) {
        throw new Error(`${where}: startNodeId "${config.storyDag.startNodeId}" does not exist in nodes.`);
    }

    const roomKeys = new Set(Object.keys(config.rooms));

    if (!config.title) throw new Error(`${where}: missing "title".`);
    if (!config.chapterTitle) throw new Error(`${where}: missing "chapterTitle".`);
    if (!config.initialPlayerLocation) throw new Error(`${where}: missing "initialPlayerLocation".`);
    if (!roomKeys.has(config.initialPlayerLocation)) {
        throw new Error(`${where}: initialPlayerLocation "${config.initialPlayerLocation}" is not a defined room.`);
    }
    if (!Array.isArray(config.initialPlayerInventory)) {
        throw new Error(`${where}: "initialPlayerInventory" must be an array.`);
    }

    // Story-defined free-text intents must be well-formed so the engine can
    // safely compile their regex at runtime.
    if (config.customIntents) {
        if (!Array.isArray(config.customIntents)) {
            throw new Error(`${where}: "customIntents" must be an array.`);
        }
        config.customIntents.forEach((ci, i) => {
            if (!ci || typeof ci.match !== 'string') {
                throw new Error(`${where}: customIntents[${i}] missing string "match".`);
            }
            try {
                new RegExp(ci.match, 'i');
            } catch (e) {
                throw new Error(`${where}: customIntents[${i}] has invalid regex "${ci.match}": ${e.message}`);
            }
            if (typeof ci.tool !== 'string') {
                throw new Error(`${where}: customIntents[${i}] missing string "tool".`);
            }
        });
    }
    if (config.onCustomAction && typeof config.onCustomAction !== 'function') {
        throw new Error(`${where}: "onCustomAction" must be a function.`);
    }

    // Connections must reference real rooms (both directions).
    for (const c of config.connections) {
        if (!roomKeys.has(c.from)) throw new Error(`${where}: connection from unknown room "${c.from}".`);
        if (!roomKeys.has(c.to)) throw new Error(`${where}: connection to unknown room "${c.to}".`);
    }

    // Actors must start in a real room.
    if (config.actors) {
        for (const actorId in config.actors) {
            const a = config.actors[actorId];
            if (a.location && !roomKeys.has(a.location)) {
                throw new Error(`${where}: actor "${actorId}" starts in unknown room "${a.location}".`);
            }
            if (a.desireTargets) {
                for (const key in a.desireTargets) {
                    const target = a.desireTargets[key];
                    if (target && !roomKeys.has(target)) {
                        throw new Error(`${where}: actor "${actorId}" desireTarget "${key}" -> unknown room "${target}".`);
                    }
                }
            }
        }
    }

    // DAG nodes: nextNodes and pressureConfig targets must reference real nodes/rooms.
    for (const nodeId in config.storyDag.nodes) {
        const node = config.storyDag.nodes[nodeId];
        if (!node.id) throw new Error(`${where}: node "${nodeId}" missing "id".`);
        if (Array.isArray(node.nextNodes)) {
            for (const next of node.nextNodes) {
                if (!config.storyDag.nodes[next]) {
                    throw new Error(`${where}: node "${nodeId}" nextNodes references unknown node "${next}".`);
                }
            }
        }
        if (node.pressureConfig && node.pressureConfig.targetRoom && !roomKeys.has(node.pressureConfig.targetRoom)) {
            throw new Error(`${where}: node "${nodeId}" pressureConfig.targetRoom references unknown room "${node.pressureConfig.targetRoom}".`);
        }
    }

    // Reachability: every node must be reachable from startNodeId, otherwise part
    // of the chapter can never be played. BFS over nextNodes.
    const nodes = config.storyDag.nodes;
    const reachable = new Set([config.storyDag.startNodeId]);
    const queue = [config.storyDag.startNodeId];
    while (queue.length) {
        const cur = queue.shift();
        const nexts = nodes[cur] && nodes[cur].nextNodes;
        if (Array.isArray(nexts)) {
            for (const n of nexts) {
                if (!reachable.has(n)) {
                    reachable.add(n);
                    queue.push(n);
                }
            }
        }
    }
    for (const nodeId in nodes) {
        if (!reachable.has(nodeId)) {
            throw new Error(`${where}: node "${nodeId}" is unreachable from startNodeId "${config.storyDag.startNodeId}".`);
        }
    }

    // A chapter must have at least one terminal node (no nextNodes) so the DAG can
    // actually complete and trigger the campaign bridge / completion.
    const hasTerminal = Object.values(nodes).some(n => !Array.isArray(n.nextNodes) || n.nextNodes.length === 0);
    if (!hasTerminal) {
        throw new Error(`${where}: storyDag has no terminal node (every node has nextNodes). The chapter can never complete.`);
    }
}

/**
 * Validates every registered story plus campaign-order consistency. Call once at
 * startup; failures are logged but do not throw (so a single bad story doesn't
 * take down the whole app — loadStory still fails fast per-story).
 */
export function validateAllStories() {
    for (const id in STORY_REGISTRY) {
        try {
            validateStory(STORY_REGISTRY[id]);
        } catch (e) {
            console.error('[storyManager] Story validation failed:', e.message);
        }
    }
    for (const id of CAMPAIGN_ORDER) {
        if (!STORY_REGISTRY[id]) {
            console.error(`[storyManager] CAMPAIGN_ORDER references unknown story "${id}".`);
        }
    }
}

/**
 * Returns the next chapter id in the campaign after the given one, or null.
 * @param {string} storyId - The current chapter id.
 * @returns {string|null}
 */
export function getNextChapterId(storyId) {
    const idx = CAMPAIGN_ORDER.indexOf(storyId);
    if (idx === -1 || idx === CAMPAIGN_ORDER.length - 1) return null;
    return CAMPAIGN_ORDER[idx + 1];
}

/**
 * Loads a story configuration into the global game state, preserving player identity metadata.
 * @param {string} storyId - The ID of the story to load.
 * @param {Object} state - The game state to populate.
 * @param {Object} [carry] - Optional state carried over from a previous chapter in the campaign.
 *        Use to preserve playerName, playerInventory, and chronicleHistory across chapters.
 */
export function loadStory(storyId, state, carry = null) {
    const config = STORY_REGISTRY[storyId];
    if (!config) {
        throw new Error(`Unknown story id "${storyId}". Available stories: ${Object.keys(STORY_REGISTRY).join(', ')}.`);
    }
    
    state.activeStoryId = config.id;
    state.storyTitle = config.title;
    state.chapterTitle = config.chapterTitle;
    // Keep a reference to the active config so the engine can read story-defined
    // hooks (customIntents, onCustomAction) without hardcoding story logic in game.js.
    state.storyConfig = config;
    
    // Core geometry and lore
    state.storyRooms = { ...config.rooms };
    state.storyConnections = [ ...config.connections ];
    setConnections(state.storyConnections);
    state.loreDb = [ ...config.loreLedger ];
    
    // Objective DAG
    state.storyDag = { ...config.storyDag };
    state.activeMilestoneId = config.storyDag.startNodeId;
    state.milestoneStartTurn = 1;
    
    // Player status (preserve name/history if continuing)
    state.playerLocation = config.initialPlayerLocation;
    state.playerInventory = [ ...config.initialPlayerInventory ];
    // Carry-over from a previous chapter (identity + inventory), per campaign design
    if (carry) {
        if (carry.playerName) state.playerName = carry.playerName;
        if (Array.isArray(carry.playerInventory)) {
            state.playerInventory = [ ...carry.playerInventory ];
        }
        if (Array.isArray(carry.chronicleHistory)) {
            state.chronicleHistory = [ ...carry.chronicleHistory ];
        }
    }
    state.playerName = state.playerName || "the traveler";
    
    // Clone actors to prevent modifying original definitions
    state.actors = {};
    for (const actorId in config.actors) {
        const actorSpec = config.actors[actorId];
        state.actors[actorId] = {
            id: actorSpec.id,
            name: actorSpec.name,
            role: actorSpec.role,
            color: actorSpec.color,
            location: actorSpec.location,
            inventory: [ ...actorSpec.inventory ],
            desires: { ...actorSpec.desires },
            desireTargets: { ...actorSpec.desireTargets },
            activePlan: [],
            longTermGoal: null,
            skills: { ...actorSpec.skills },
            memories: [],
            promptTemplate: actorSpec.promptTemplate,
            // Re-bind callbacks
            subscriptions: actorSpec.subscriptions || {},
            heuristics: actorSpec.heuristics
        };
    }
    
    // Reset path blocks & local logs
    state.blockedConnections = [];
    state.turn = 1;
    state.storyState = "running";
    // Keep the terminal history continuous across campaign chapters (only reset on a
    // fresh start) so the left panel survives a reload after a chapter transition.
    if (!carry) state.history = [];
    // Preserve chronicle continuity across campaign chapters; only reset on a fresh start.
    if (!carry) {
        state.chronicleHistory = [];
        state.chapterBreaks = [];
        state.chapterBreakClosers = [];
    }
    state.decisionsLog = {};
}

/**
 * Re-binds functional code blocks (heuristics, sub callbacks, conditions, DAG updates)
 * back to the serialized active state object loaded from localStorage.
 * @param {Object} state - The parsed local state object.
 */
export function restoreStoryFunctions(state) {
    if (!state || !state.activeStoryId) return;
    const config = STORY_REGISTRY[state.activeStoryId];
    if (!config) return;

    // Re-bind the active story config. On a fresh load this is already the live
    // module object, but after a localStorage reload `state.storyConfig` is a
    // plain deserialized object whose functions (customIntents/onCustomAction)
    // are gone. Without this, story-defined intents silently stop working.
    state.storyConfig = config;

    // Restore storyDag functions
    if (state.storyDag && state.storyDag.nodes) {
        for (const nodeId in config.storyDag.nodes) {
            const stateNode = state.storyDag.nodes[nodeId];
            const configNode = config.storyDag.nodes[nodeId];
            if (stateNode && configNode) {
                stateNode.convergenceCheck = configNode.convergenceCheck;
                stateNode.updateObjectives = configNode.updateObjectives;
                stateNode.onComplete = configNode.onComplete;
                
                if (stateNode.decisionPoints && configNode.decisionPoints) {
                    stateNode.decisionPoints.forEach((stateDp, idx) => {
                        const configDp = configNode.decisionPoints[idx];
                        if (stateDp && configDp) {
                            stateDp.condition = configDp.condition;
                        }
                    });
                }
            }
        }
    }

    // Restore actor functions
    if (state.actors) {
        for (const actorId in config.actors) {
            const stateActor = state.actors[actorId];
            const configActor = config.actors[actorId];
            if (stateActor && configActor) {
                stateActor.heuristics = configActor.heuristics;
                stateActor.subscriptions = configActor.subscriptions || {};
            }
        }
    }
}
