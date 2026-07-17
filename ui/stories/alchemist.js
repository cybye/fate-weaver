// --- THE ALCHEMIST'S ELIXIR STORY CONFIGURATION ---

export const STORY_CONFIG = {
    id: "alchemist_elixir",
    title: "The Alchemist's Elixir",
    chapterTitle: "Chapter 2: The Fire-Resistance Potion",
    initialPlayerLocation: "square",
    initialPlayerInventory: [],
    
    rooms: {
        tavern: { name: "Tavern", x: 25, y: 35, desc: "A cozy, warm tavern filled with the scent of roasted barley and woodsmoke." },
        square: { name: "Town Square", x: 50, y: 40, desc: "The bustling center of town. A grand stone fountain sits in the middle." },
        alchemist: { name: "Alchemist Shop", x: 75, y: 35, desc: "A cramped shop smelling of sulfur and lavender, lined with glowing potion vials." },
        gates: { name: "Castle Gates", x: 50, y: 65, desc: "The towering iron gates of the castle, guarded by two stony knights." },
        courtyard: { name: "Castle Courtyard", x: 50, y: 85, desc: "A grand open-air courtyard within the outer castle walls, flanked by stone ramparts." }
    },

    connections: [
        { from: "tavern", to: "square" },
        { from: "square", to: "alchemist" },
        { from: "square", to: "gates" },
        { from: "gates", to: "courtyard" }
    ],

    loreLedger: [
        "A trapped miner needs a Fire-Resistance Elixir to escape a burning shaft.",
        "The Alchemist needs a rare Shadow Leaf and a Glow Mushroom to brew the potion.",
        "Bob has a Shadow Leaf that he is willing to give away in the Tavern.",
        "Glow Mushrooms grow in the damp corners of the Castle Courtyard."
    ],

    storyDag: {
        startNodeId: "collect_ingredients",
        nodes: {
            collect_ingredients: {
                id: "collect_ingredients",
                title: "Collect the Reagents",
                description: "Gather the Shadow Leaf and the Glow Mushroom before turn 12.",
                maxTurns: 12,
                playerPersona: "an aspiring herbalist seeking ingredients to help a trapped miner. You are looking for a Shadow Leaf and a Glow Mushroom.",
                maxConversationRounds: 3,
                decisionPoints: [
                    {
                        id: "mushroom_harvest",
                        condition: (state) =>
                            state.playerLocation === "courtyard" &&
                            !state.playerInventory.includes("Glow Mushroom"),
                        prompt: "In a dark, mossy corner of the courtyard, you spot a cluster of glowing, azure mushrooms. Harvest them?",
                        choices: [
                            {
                                label: "Harvest the Glow Mushroom carefully",
                                mutations: [],
                                consequence: "You carefully pluck the bioluminescent cap and place it in your satchel."
                            }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    const hasMushroom = state.playerInventory.includes("Glow Mushroom") || (state.decisionsLog && state.decisionsLog.mushroom_harvest);
                    if (hasMushroom && !state.playerInventory.includes("Glow Mushroom")) {
                        state.playerInventory.push("Glow Mushroom");
                    }
                    if (state.actors.bob) {
                        const hasLeaf = state.actors.bob.inventory.includes("Shadow Leaf");
                        if (hasLeaf) {
                            if (state.playerLocation === state.actors.bob.location) {
                                state.actors.bob.criticalObjective = "The player is here. Give them the Shadow Leaf so they can help the Alchemist.";
                            } else {
                                state.actors.bob.criticalObjective = "Wait in the Tavern (tavern) for the player to arrive and ask for the ingredient.";
                            }
                        } else {
                            state.actors.bob.criticalObjective = "You have given the Shadow Leaf. Rest here.";
                        }
                    }
                },
                convergenceCheck: (state) => {
                    const hasLeaf = state.playerInventory.includes("Shadow Leaf");
                    const hasMushroom = state.playerInventory.includes("Glow Mushroom");
                    
                    // Allow Bob to hand over leaf in tavern conversation
                    if (state.playerLocation === "tavern" && state.actors.bob && state.actors.bob.location === "tavern" && state.actors.bob.inventory.includes("Shadow Leaf")) {
                        state.playerInventory.push("Shadow Leaf");
                        state.actors.bob.inventory = state.actors.bob.inventory.filter(i => i !== "Shadow Leaf");
                        logGame("system", "<i>[Item Acquired: \"Shadow Leaf\"]</i>");
                    }

                    if (hasLeaf && hasMushroom) {
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: You have gathered both rare ingredients! Now, bring them to the Alchemist Shop."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["brew_elixir"],
                pressureConfig: {
                    keyItems: ["Shadow Leaf", "Glow Mushroom"],
                    targetRoom: "alchemist",
                    keyActors: ["bob"]
                }
            },
            brew_elixir: {
                id: "brew_elixir",
                title: "Brew the Potion",
                description: "Deliver both ingredients to the Alchemist Shop within 6 turns.",
                maxTurns: 6,
                playerPersona: "a savior rushing reagents to the laboratory. You must bring the Shadow Leaf and Glow Mushroom to the Alchemist Shop.",
                maxConversationRounds: 3,
                decisionPoints: [],
                updateObjectives: (state) => {
                    if (state.actors.alchemist) {
                        state.actors.alchemist.criticalObjective = "The player has both ingredients. Encourage them to give them to you so you can brew the Elixir.";
                    }
                },
                convergenceCheck: (state) => {
                    const atAlchemist = state.playerLocation === "alchemist";
                    const hasLeaf = state.playerInventory.includes("Shadow Leaf");
                    const hasMushroom = state.playerInventory.includes("Glow Mushroom");

                    if (atAlchemist && hasLeaf && hasMushroom) {
                        state.playerInventory = [];
                        state.playerInventory.push("Fire-Resistance Elixir");
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: You give the ingredients to the Alchemist. In a flash of sulfur and steam, the Fire-Resistance Elixir is brewed!"
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: [],
                pressureConfig: {
                    keyItems: ["Shadow Leaf", "Glow Mushroom"],
                    targetRoom: "alchemist",
                    keyActors: ["alchemist"]
                }
            }
        }
    },

    actors: {
        bob: {
            id: "bob",
            name: "Bob",
            role: "messenger",
            color: "#f59e0b",
            location: "tavern",
            inventory: ["Shadow Leaf"],
            desires: { sleep: 40, wander: 10 },
            desireTargets: {
                sleep: "tavern",
                wander: "square"
            },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 4, stealth: 2, retention: 6 },
            memories: [],
            promptTemplate: `You are Bob.
Current location: {location}.
Your Inventory: {inventory}.

Your Job: You have a rare Shadow Leaf in your inventory. You are resting at the Tavern. If the player asks you for ingredients, give them the Shadow Leaf.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "sleep" | "wander",
  "plan_steps": ["go_room", ...],
  "thought": "Reasoning about your plan."
}}`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                return `Bob is resting in the Tavern.`;
            }
        },
        alchemist: {
            id: "alchemist",
            name: "Alchemist",
            role: "alchemist",
            color: "#10b981",
            location: "alchemist",
            inventory: [],
            desires: { watch: 10 },
            desireTargets: { watch: "alchemist" },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 8, stealth: 1, retention: 9 },
            memories: [],
            promptTemplate: `You are the Alchemist.
Current location: {location}.
Your Inventory: {inventory}.

Your Job: Brew a Fire-Resistance Elixir. If the player brings you a Shadow Leaf and a Glow Mushroom, encourage them to give them to you so you can brew the Elixir.`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                return `Alchemist is tending to the shop.`;
            }
        }
    }
};
