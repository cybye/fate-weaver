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
    const config = STORY_REGISTRY[storyId] || castleConfig;
    
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
    state.history = [];
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
