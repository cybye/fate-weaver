import { STORY_CONFIG as castleConfig } from './stories/castle.js';
import { STORY_CONFIG as alchemistConfig } from './stories/alchemist.js';
import { setConnections } from './pathfinding.js';

export const STORY_REGISTRY = {
    castle: castleConfig,
    alchemist_elixir: alchemistConfig
};

/**
 * Loads a story configuration into the global game state, preserving player identity metadata.
 * @param {string} storyId - The ID of the story to load.
 * @param {Object} state - The game state to populate.
 */
export function loadStory(storyId, state) {
    const config = STORY_REGISTRY[storyId] || castleConfig;
    
    state.activeStoryId = config.id;
    state.storyTitle = config.title;
    state.chapterTitle = config.chapterTitle;
    
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
    state.chronicleHistory = [];
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
