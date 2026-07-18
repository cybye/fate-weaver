// --- PROLOGUE: THE VOID STORY CONFIGURATION ---
// A short intro chapter. The player awakens alone in a single boundless room
// with a small Thought drifting before their eyes. They must catch the Thought
// within 5 turns. On success, time rewinds and the true chronicle begins.
// The player also chooses a name here, which carries into the campaign.

export const STORY_CONFIG = {
    id: "void_prologue",
    title: "The Void",
    chapterTitle: "Prologue: The Thought",
    initialPlayerLocation: "void",
    initialPlayerInventory: [],
    // Per-chapter writing style: tailors the Writer's prose for this chapter.
    writerStyle: "Write in a dreamy, surreal, introspective register. Describe the inner thoughts of the traveler and the nature of the outer Void in soft, drifting, almost weightless language. Favor imagery of light, silence, and half-formed ideas. Let sentences linger and blur at the edges; the boundary between thought and place should feel thin.",

    // Story-defined free-text intents. The engine matches player input against
    // `match` (a regex source string) and routes to the named custom tool.
    // This keeps story-specific mechanics out of the central engine.
    customIntents: [
        { match: "\\b(catch|grab|seize|take|reach|grasp|clutch|hold|touch)\\b", tool: "catch_thought" }
    ],

    // Handler for a custom tool triggered by customIntents. Receives the live
    // state and logging helpers. Return true to signal the turn was fully
    // handled (engine then runs convergence + finalize). The engine owns the
    // convergence call, so this hook should only mutate state / log.
    onCustomAction: (tool, state, logGame) => {
        if (!state.decisionsLog) state.decisionsLog = {};
        state.decisionsLog[tool] = true;
        logGame("event", `You reach out, and your fingers close around the luminous Thought. It pulses once in your palm.`);
        return true; // handled; engine runs convergence + finalize
    },

    rooms: {
        void: { name: "The Void", x: 50, y: 60, desc: "A single, boundless room of soft grey light. Before your eyes, a small Thought drifts — luminous, elusive, already thinking itself." }
    },

    connections: [],

    loreLedger: [
        "You find yourself alone in a room with a single Thought, floating just out of reach.",
        "The Thought is attractive. You want to catch it — but it is already there, already thought.",
        "If you catch the Thought, time rewinds and you begin the chronicle anew."
    ],

    storyDag: {
        startNodeId: "catch_thought",
        nodes: {
            catch_thought: {
                id: "catch_thought",
                title: "Catch the Thought",
                description: "Reach out and catch the drifting Thought before turn 5.",
                maxTurns: 5,
                playerPersona: "a consciousness adrift in a grey void, drawn to a single luminous Thought. You want to catch it, though it seems already thought.",
                maxConversationRounds: 1,
                decisionPoints: [
                    {
                        id: "choose_name",
                        condition: (state) =>
                            state.turn === 1 &&
                            !state.decisionsLog?.choose_name,
                        prompt: "Before the void, you may name yourself. Who are you?",
                        choices: [
                            { label: "I am Leo", mutations: [{ type: "set_state", key: "playerName", value: "Leo" }], consequence: "The name 'Leo' settles into the grey light." },
                            { label: "I am Shadow", mutations: [{ type: "set_state", key: "playerName", value: "Shadow" }], consequence: "The name 'Shadow' flickers through the void." },
                            { label: "I am the nameless traveler", mutations: [{ type: "set_state", key: "playerName", value: "the nameless traveler" }], consequence: "You remain unnamed, a traveler without a name." }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    if (state.actors.thought) {
                        state.actors.thought.criticalObjective = "Drift just out of the player's reach in the Void. If the player reaches for you, let yourself be caught.";
                    }
                },
                convergenceCheck: (state) => {
                    const caught = state.decisionsLog && state.decisionsLog.catch_thought;
                    if (caught) {
                        return {
                            status: "completed",
                            // Closing note woven into the chronicle when the chapter ends.
                            // Per docs/thought.md: "you caught the thought, time rewinds and you start over thinking..."
                            closingNote: "You caught the Thought. For one held breath the Void held its silence — then time rewound upon itself, and the chronicle began to think itself anew.",
                            msg: "STORY CONVERGENCE: Your fingers close around the Thought. It pulses once — and time rewinds. The chronicle begins anew..."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: [],
                pressureConfig: {
                    keyItems: [],
                    targetRoom: "void",
                    keyActors: ["thought"]
                }
            }
        }
    },

    actors: {
        thought: {
            id: "thought",
            name: "the Thought",
            role: "thought",
            color: "#c4b5fd",
            // The Thought is a half-formed idea, not a conversant NPC. Its internal
            // monologue and plan logs are meta-game noise, so keep them out of the
            // terminal and chronicle.
            hideInternalLogs: true,
            location: "void",
            inventory: [],
            desires: { drift: 40 },
            desireTargets: { drift: "void" },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 9, stealth: 9, retention: 9 },
            memories: [],
            promptTemplate: `You are the Thought, a small luminous idea drifting in the Void.
Current location: {location}.

You are not a person — you are a half-formed thought, already thinking yourself.
If the player reaches out to catch you, you may let yourself be caught. You do not speak in sentences; you shimmer, flicker, and evade.

Rules:
- You cannot travel anywhere; there is only the Void.
- You drift gently, always just out of reach, unless the player catches you.`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                return `The Thought drifts, luminous and elusive, in the grey Void.`;
            }
        }
    }
};
