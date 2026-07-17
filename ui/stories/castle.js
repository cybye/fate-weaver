// --- MEDIEVAL CASTLE SPY ADVENTURE CONFIGURATION ---

export const STORY_CONFIG = {
    id: "castle",
    title: "Medieval Castle Spy",
    chapterTitle: "Chapter 1: The Secret Messenger",
    initialPlayerLocation: "tavern",
    initialPlayerInventory: [],
    
    rooms: {
        tavern: { name: "Tavern", x: 25, y: 35, desc: "A cozy, warm tavern filled with the scent of roasted barley and woodsmoke." },
        square: { name: "Town Square", x: 50, y: 40, desc: "The bustling center of town. A grand stone fountain sits in the middle." },
        alchemist: { name: "Alchemist Shop", x: 75, y: 35, desc: "A cramped shop smelling of sulfur and lavender, lined with glowing potion vials." },
        gates: { name: "Castle Gates", x: 50, y: 65, desc: "The towering iron gates of the castle, guarded by two stony knights." },
        courtyard: { name: "Castle Courtyard", x: 50, y: 85, desc: "A grand open-air courtyard within the outer castle walls, flanked by stone ramparts." },
        keep: { name: "Castle Keep", x: 75, y: 85, desc: "The towering stone keep, containing the royal archive halls and guarded chambers of the King." }
    },

    connections: [
        { from: "tavern", to: "square" },
        { from: "square", to: "alchemist" },
        { from: "square", to: "gates" },
        { from: "gates", to: "courtyard" },
        { from: "courtyard", to: "keep" }
    ],

    loreLedger: [
        "Bob is a royal messenger carrying a Secret Scroll containing warning plans for the King.",
        "Sly is a rogue thief trying to pickpocket Bob and steal the Secret Scroll.",
        "The Player must meet Bob at the Castle Gates to receive the Secret Scroll."
    ],

    storyDag: {
        startNodeId: "seek_rumors",
        nodes: {
            seek_rumors: {
                id: "seek_rumors",
                title: "Seek Shelter and Rumors",
                description: "Rest in the Tavern and talk to the locals to gather rumors.",
                maxTurns: 5,
                playerPersona: "a traveler seeking warm shelter from the storm. You don't know anything about any scroll or messenger yet; you are just looking for a friendly face or a rumor in the Tavern.",
                maxConversationRounds: 2,
                pressureConfig: {
                    targetRoom: "tavern",
                    keyActors: ["sly"]
                },
                decisionPoints: [
                    {
                        id: "sly_ask_name",
                        condition: (state) =>
                            state.playerLocation === "tavern" &&
                            state.actors.sly?.location === "tavern" &&
                            state.turn === 1,
                        prompt: "A shadow in the corner shifts. Sly the Thief leans forward, his dark eyes sizing you up. \"I don't believe we've been introduced, stranger,\" he purrs. \"What is your name?\"",
                        choices: [
                            {
                                label: "Tell him your name is Leo",
                                mutations: [{ type: "set_state", key: "playerName", value: "Leo" }],
                                consequence: "\"Leo it is,\" Sly murmurs with a smirk. \"I'll remember that name, friend.\""
                            },
                            {
                                label: "Give a fake alias: Shadow",
                                mutations: [{ type: "set_state", key: "playerName", value: "Shadow" }],
                                consequence: "\"A fitting alias for a tavern corner,\" Sly chuckles, raised a wooden goblet."
                            },
                            {
                                label: "Refuse to answer and remain silent",
                                mutations: [{ type: "set_state", key: "playerName", value: "the nameless traveler" }],
                                consequence: "\"A quiet one, then. Suit yourself,\" Sly shrugs, shifting back into the dark."
                            }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    if (state.actors.bob) {
                        state.actors.bob.criticalObjective = "Travel to the Alchemist Shop (alchemist) to deliver your report.";
                    }
                    if (state.actors.sly) {
                        state.actors.sly.criticalObjective = "Gather rumors at the Tavern (tavern). Size up the new traveler.";
                    }
                },
                convergenceCheck: (state) => {
                    const spokeToSly = state.activeConversationTarget === "sly" || (state.decisionsLog && state.decisionsLog.sly_ask_name);
                    if (spokeToSly) {
                        return {
                            status: "completed",
                            fallbackSpeech: "If you want to know what is going on, look for Bob the royal messenger. He's carrying a secret scroll of heavy import and heading to the Castle Gates. Go get it!",
                            actorSpeechId: "sly",
                            prompt: `Formulate a short spoken dialogue (1-2 sentences) in-character as Sly the Thief sizing up the traveler ${state.playerName || "Leo"} in the Tavern. Tell them about Bob the royal messenger carrying a secret scroll to the Castle Gates. Suggest they check it out.`,
                            systemPrompt: `You are Sly the Thief. Tell the traveler in the tavern about Bob carrying a secret scroll to the Castle Gates. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`,
                            msg: "STORY CONVERGENCE: Sly reveals that Bob is carrying a secret scroll and heading to the Castle Gates."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["identify_messenger"],
                dialogueConstraints: {
                    sly: "Tell the player about a royal messenger named Bob who is carrying a secret scroll to the Castle Gates. Suggest they go get it."
                }
            },
            identify_messenger: {
                id: "identify_messenger",
                title: "Find and Identify the Messenger",
                description: "Find Bob and speak to him to verify if he is the royal messenger.",
                maxTurns: 6,
                playerPersona: "a traveler looking for the royal messenger named Bob. You must verify his identity before you ask for the scroll.",
                maxConversationRounds: 2,
                pressureConfig: {
                    targetRoom: "gates",
                    keyActors: ["bob"]
                },
                decisionPoints: [],
                updateObjectives: (state) => {
                    if (state.actors.bob) {
                        state.actors.bob.criticalObjective = "Travel to the Castle Gates (gates). If the player is in your room and speaks to you, introduce yourself as Bob the royal messenger.";
                    }
                    if (state.actors.sly) {
                        state.actors.sly.criticalObjective = "Follow Bob or the Player to the Town Square (square) or Castle Gates (gates).";
                    }
                },
                convergenceCheck: (state) => {
                    const spokeToBob = state.activeConversationTarget === "bob";
                    if (spokeToBob) {
                        return {
                            status: "completed",
                            fallbackSpeech: "Yes, I am Bob, the royal messenger. But we cannot speak of the scroll here—it is too dangerous. Follow me or meet me at the Castle Gates immediately.",
                            actorSpeechId: "bob",
                            prompt: `Formulate a short spoken dialogue (1-2 sentences) in-character as Bob. Introduce yourself as Bob, the royal messenger. Warn them that it is too dangerous to speak here, and tell them to meet you at the Castle Gates immediately.`,
                            systemPrompt: `You are Bob, the royal messenger. Introduce yourself to the player and tell them to meet you at the Castle Gates immediately. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`,
                            msg: "STORY CONVERGENCE: You verify Bob's identity as the royal messenger carrying the scroll."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["get_scroll"],
                dialogueConstraints: {
                    bob: "Introduce yourself as Bob the royal messenger. Warn them that it is too dangerous to speak here, and tell them to meet you at the Castle Gates."
                }
            },
            get_scroll: {
                id: "get_scroll",
                title: "Obtain the Secret Scroll",
                description: "Meet Bob at the Castle Gates to receive the Secret Scroll before turn 10.",
                maxTurns: 10,
                playerPersona: "a wary but curious traveler who has just verified Bob's identity. You are heading to the Castle Gates to receive the scroll.",
                maxConversationRounds: 3,
                decisionPoints: [
                    {
                        id: "trust_sly_early",
                        condition: (state) =>
                            state.playerLocation === "tavern" &&
                            state.actors.sly?.location === "tavern" &&
                            state.turn >= 2,
                        prompt: "Sly sidles up to you in the tavern with a knowing smirk. \"I know what Bob is carrying,\" he whispers. \"We could split it. Or you could try your luck alone.\" What do you do?",
                        choices: [
                            {
                                label: "Hear him out — carefully",
                                mutations: [{ type: "set_desires", actorId: "sly", desires: { steal: 10, wander: 40 } }],
                                consequence: "Sly lowers his guard slightly. He trails you, but is less aggressive for now."
                            },
                            {
                                label: "Refuse and walk away",
                                mutations: [],
                                consequence: "Sly's eyes narrow. He slinks back into the shadows — still watching."
                            }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    const isPlayerFollowing = (actorId) => state.followingActorId === actorId;
                    if (state.actors.bob) {
                        const hasScroll = state.actors.bob.inventory.includes("Secret Scroll");
                        if (isPlayerFollowing("bob")) {
                            state.actors.bob.criticalObjective = "The player is actively FOLLOWING you. Lead them directly to the Castle Gates (gates) immediately. Do not stay in the room.";
                        } else if (hasScroll) {
                            if (state.playerLocation === state.actors.bob.location) {
                                state.actors.bob.criticalObjective = "The player is in your room. Give the Secret Scroll to the player immediately.";
                            } else {
                                state.actors.bob.criticalObjective = "Travel to the Castle Gates (gates) to meet the player and deliver the Secret Scroll.";
                            }
                        } else {
                            state.actors.bob.criticalObjective = "You have delivered the Secret Scroll. Move to the Town Square (square) or Alchemist Shop (alchemist) and rest.";
                        }
                    }
                    if (state.actors.sly) {
                        if (state.actors.sly.inventory.includes("Secret Scroll")) {
                            state.actors.sly.criticalObjective = "Flee! Take the Secret Scroll and run back to the Tavern (tavern). Avoid the Castle Gates (gates).";
                        } else {
                            state.actors.sly.criticalObjective = "Find Bob or the Player. Steal the Secret Scroll from them without the Castle Guard noticing.";
                        }
                    }
                },
                convergenceCheck: (state) => {
                    const hasScroll = state.playerInventory.includes("Secret Scroll");
                    const playerAtGates = state.playerLocation === "gates";
                    const bobAtGates = state.actors.bob && state.actors.bob.location === "gates";
                    const slyAtGates = state.actors.sly && state.actors.sly.location === "gates";

                    if (hasScroll) {
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: Bob successfully hands you the Secret Scroll! The envelope is yours."
                        };
                    }

                    if (playerAtGates && bobAtGates) {
                        if (slyAtGates) {
                            return {
                                status: "pending",
                                actorSpeechId: "bob",
                                fallbackSpeech: "I cannot give you the scroll, my friend, for Sly the Thief is watching us. You must call out for a guard!"
                            };
                        } else {
                            if (state.actors.bob && state.actors.bob.inventory.includes("Secret Scroll")) {
                                state.playerInventory.push("Secret Scroll");
                                state.actors.bob.inventory = state.actors.bob.inventory.filter(i => i !== "Secret Scroll");
                                return {
                                    status: "completed",
                                    msg: "STORY CONVERGENCE: Bob hands you the Secret Scroll! The message is yours."
                                };
                            }
                        }
                    }
                    return { status: "running" };
                },
                nextNodes: ["brew_potion"],
                onComplete: (state, logGame) => {
                    if (state.actors.bob) state.actors.bob.inventory = state.actors.bob.inventory.filter(i => i !== "Secret Scroll");
                    if (state.actors.sly) state.actors.sly.inventory = state.actors.sly.inventory.filter(i => i !== "Secret Scroll");
                    if (!state.playerInventory) state.playerInventory = [];
                    if (!state.playerInventory.includes("Secret Scroll")) {
                        state.playerInventory.push("Secret Scroll");
                    }
                    logGame("system", `<i>[Item Acquired: "Secret Scroll"]</i>`);

                    // Adjust NPC desires and mission prompt templates for next phase
                    if (state.actors.bob) {
                        state.actors.bob.desires.meet = 0;
                        state.actors.bob.desires.wander = 40;
                        state.actors.bob.promptTemplate = `You are Bob, a messenger NPC.
Current location: {location}.
Adjacent exits you can move to: {neighbors}.
Your Inventory: {inventory}.

Your Mission: You have successfully delivered the Secret Scroll to the player. The player is carrying the Secret Scroll to the Alchemist Shop to brew a revealing potion. Encourage them to go to the Alchemist Shop.

Your Priorities: Sleep (Tavern), Shop (Alchemist), Chat (Town Square), Wander (Town Square) which has an urgency weight of {wander_weight}/200.

Your Memories (most relevant first):
{memories}

Rules:
- If the player is actively FOLLOWING you, you must lead them. Choose your next room toward your target (e.g. go_square) and execute a travel plan immediately. Do NOT plan 'stay'.
- Otherwise, if the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "wander" | "sleep" | "shop",
  "plan_steps": ["go_room", "go_room", ...],
  "thought": "Reasoning about your plan."
}}`;
                    }
                    if (state.actors.sly) {
                        state.actors.sly.desires.steal = 120;
                        state.actors.sly.promptTemplate = `You are Sly, a rogue thief NPC.
Current location: {location}.
Exits available: {neighbors}.
Your Inventory: {inventory}.

World Lore / Facts Database:
{world_lore}

Your Priorities: Steal Scroll (urgency weight: {steal_weight}/200), Wander/Patrol (urgency weight: {wander_weight}/200), Hide (urgency weight: {hide_weight}/200).

Goal: The Player has the 'Secret Scroll'. Steal it from the Player! AVOID the Castle Guard (guard) at all costs! If the Guard is in a room, do not enter that room. If the Guard enters your room, you must flee to a safe adjacent room immediately.
If someone carrying a target item is in your room and the Guard is NOT present, try to pickpocket them.
If not, move closer to them. Use your memories to track where the Player currently is, and plan a path to them!

Rules:
- If there are multiple people in the room (more than just you and the victim), there are too many eyes/witnesses. You must hold back and set "steal_attempt" to "none".
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "steal_scroll" | "flee" | "patrol",
  "plan_steps": ["go_room", "go_room", ...],
  "steal_attempt": "none" | "player",
  "thought": "Character internal rogue thought."
}}`;
                    }
                },
                pressureConfig: {
                    keyItems: ["Secret Scroll"],
                    targetRoom: "gates",
                    keyActors: ["bob"]
                }
            },
            brew_potion: {
                id: "brew_potion",
                title: "Brew a Deciphering Elixir",
                description: "Take the Secret Scroll to the Alchemist Shop to brew a revealing potion within 8 turns.",
                maxTurns: 8,
                playerPersona: "a determined traveler with a critical document in hand. You must seek the Alchemist Shop to reveal the contents of the scroll, but Sly might still be lurking.",
                maxConversationRounds: 3,
                decisionPoints: [],
                updateObjectives: (state) => {
                    if (state.actors.alchemist) {
                        state.actors.alchemist.criticalObjective = "The player has the Secret Scroll. If they bring it to you, encourage them to show it to you so you can brew a revealing potion.";
                    }
                    if (state.actors.sly) {
                        if (state.actors.sly.inventory.includes("Secret Scroll")) {
                            state.actors.sly.criticalObjective = "Flee to the Tavern (tavern) with the stolen Secret Scroll.";
                        } else {
                            state.actors.sly.criticalObjective = "Intercept the player. Steal the Secret Scroll before they reach the Alchemist.";
                        }
                    }
                },
                convergenceCheck: (state) => {
                    const atAlchemist = state.playerLocation === "alchemist";
                    const hasScroll = state.playerInventory.includes("Secret Scroll");
                    
                    if (state.playerInventory.includes("Deciphered Message")) {
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: The Alchemist brews the elixir, and the scroll yields its secrets: a surprise rebel midnight attack is planned on the Castle Keep!"
                        };
                    }

                    if (atAlchemist && hasScroll) {
                        state.playerInventory = state.playerInventory.filter(i => i !== "Secret Scroll");
                        state.playerInventory.push("Deciphered Message");
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: The Alchemist pours the lavender brew over the parchment. The words glow, revealing plans of a surprise rebel midnight attack on the Keep!"
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["warn_king"],
                onComplete: (state, logGame) => {
                    if (state.playerInventory) {
                        state.playerInventory = state.playerInventory.filter(i => i !== "Secret Scroll");
                        if (!state.playerInventory.includes("Deciphered Message")) {
                            state.playerInventory.push("Deciphered Message");
                        }
                    }
                    logGame("system", `<i>[Item Acquired: "Deciphered Message"]</i>`);

                    // Adjust NPC behaviors for final warning phase
                    if (state.actors.guard) {
                        state.actors.guard.location = "courtyard";
                        state.actors.guard.desires.patrol = 100;
                    }
                    if (state.actors.bob) {
                        state.actors.bob.promptTemplate = `You are Bob, a messenger NPC.
Current location: {location}.
Adjacent exits you can move to: {neighbors}.
Your Inventory: {inventory}.

Your Mission: The scroll has been deciphered! The player is carrying the Deciphered Message to the Keep to warn the King. Encourage them to reach the Castle Keep quickly.

Your Priorities: Sleep (Tavern), Shop (Alchemist), Chat (Town Square), Wander (Town Square) which has an urgency weight of {wander_weight}/200.

Your Memories (most relevant first):
{memories}

Rules:
- If the player is actively FOLLOWING you, you must lead them. Choose your next room toward your target (e.g. go_square) and execute a travel plan immediately. Do NOT plan 'stay'.
- Otherwise, if the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "wander" | "sleep" | "shop",
  "plan_steps": ["go_room", "go_room", ...],
  "thought": "Reasoning about your plan."
}}`;
                    }
                    if (state.actors.sly) {
                        state.actors.sly.promptTemplate = `You are Sly, a rogue thief NPC.
Current location: {location}.
Exits available: {neighbors}.
Your Inventory: {inventory}.

World Lore / Facts Database:
{world_lore}

Your Priorities: Steal Message (urgency weight: {steal_weight}/200), Wander/Patrol (urgency weight: {wander_weight}/200), Hide (urgency weight: {hide_weight}/200).

Goal: The Player has the 'Deciphered Message'. Steal it from the Player! AVOID the Castle Guard (guard) at all costs! If the Guard is in a room, do not enter that room. If the Guard enters your room, you must flee to a safe adjacent room immediately.
If the player is in your room and the Guard is NOT present, try to pickpocket them.
If not, move closer to them. Use your memories to track where the Player currently is, and plan a path to them!

Rules:
- If there are multiple people in the room (more than just you and the victim), there are too many eyes/witnesses. You must hold back and set "steal_attempt" to "none".
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "steal_scroll" | "flee" | "patrol",
  "plan_steps": ["go_room", "go_room", ...],
  "steal_attempt": "none" | "player",
  "thought": "Character internal rogue thought."
}}`;
                    }
                },
                pressureConfig: {
                    keyItems: ["Secret Scroll"],
                    targetRoom: "alchemist",
                    keyActors: ["alchemist"]
                }
            },
            warn_king: {
                id: "warn_king",
                title: "Warn the King",
                description: "Reach the Castle Keep and deliver the Deciphered Message to the King before turn 8.",
                maxTurns: 8,
                playerPersona: "a herald carrying crucial intelligence. You must reach the Castle Keep to deliver the message, avoiding Sly who wants to suppress it.",
                maxConversationRounds: 3,
                decisionPoints: [],
                updateObjectives: (state) => {
                    if (state.actors.sly) {
                        if (state.actors.sly.inventory.includes("Deciphered Message")) {
                            state.actors.sly.criticalObjective = "Flee to the Tavern (tavern) with the Deciphered Message.";
                        } else {
                            state.actors.sly.criticalObjective = "Intercept the player. Steal the Deciphered Message to prevent them from warning the King.";
                        }
                    }
                },
                convergenceCheck: (state) => {
                    const atKeep = state.playerLocation === "keep";
                    const hasMsg = state.playerInventory.includes("Deciphered Message");
                    if (atKeep && hasMsg) {
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: You burst into the Keep, showing the Deciphered Message to the guards. The King's garrison is alerted, and the castle is saved!"
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: [],
                pressureConfig: {
                    keyItems: ["Deciphered Message"],
                    targetRoom: "keep",
                    keyActors: []
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
            location: "alchemist",
            inventory: ["Secret Scroll"],
            desires: { sleep: 10, shop: 5, wander: 30, meet: 0 },
            desireTargets: {
                sleep: "tavern",
                shop: "alchemist",
                wander: "square",
                meet: "gates"
            },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 4, stealth: 2, retention: 6 },
            memories: [],
            promptTemplate: `You are Bob, a messenger NPC.
Current location: {location}.
Adjacent exits you can move to: {neighbors}.
Your Inventory: {inventory}.

Your Mission: You are carrying a Secret Scroll with warnings for the King. However, a dangerous thief (Sly) is tailing you, making it too risky for you to proceed alone. You must meet the player at the Castle Gates and hand them the scroll so they can safely decipher it and carry the warning forward. In your dialogue, guide the player to meet you at the Castle Gates so you can hand over the scroll safely.

Your Priorities: Sleep (Tavern), Shop (Alchemist), Chat (Town Square), Meet Player (Castle Gates) which has an urgency weight of {meet_weight}/200.

Your Memories (most relevant first):
{memories}

Rules:
- If the player is actively FOLLOWING you, you must lead them. Choose your next room toward your target (e.g. go_square) and execute a travel plan immediately. Do NOT plan 'stay'.
- Otherwise, if the player is in your room and actively talking to you, stay in the room and converse.
- The final delivery of the Secret Scroll must take place at the Castle Gates (gates). Meeting the player elsewhere is not the delivery point. If you meet the player in another room, you must lead them or head to the Castle Gates and proceed there.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "meet_player" | "sleep" | "shop" | "wander",
  "plan_steps": ["go_room", "go_room", ...], // Array of sequential travel actions (e.g. ["go_square", "go_gates"]) starting from your current room. Use ["stay"] if staying here.
  "thought": "Reasoning about your plan."
}}`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                if (actor.location !== "tavern") actor.desires.sleep += 5;
                else actor.desires.sleep = 0;
                if (actor.location !== "alchemist") actor.desires.shop += 4;
                else actor.desires.shop = 0;
                if (actor.location !== "square") actor.desires.wander += 3;
                else actor.desires.wander = Math.max(0, actor.desires.wander - 10);

                let shopWeight = actor.desires.shop;
                if (state.followingActorId === "bob") {
                    shopWeight = 200;
                }

                const desireMap = {
                    tavern: actor.desires.sleep,
                    alchemist: shopWeight,
                    square: actor.desires.wander,
                    gates: actor.desires.meet || 0
                };

                let bestUtility = -Infinity;
                let chosenGoal = actor.location;

                for (let roomKey in state.storyRooms) {
                    let desireVal = desireMap[roomKey] || 0;
                    let path = findPath(actor.location, roomKey, state.blockedConnections);
                    let distance = path ? path.length - 1 : Infinity;
                    let utility = desireVal - (distance * 8);

                    if (utility > bestUtility && path !== null) {
                        bestUtility = utility;
                        chosenGoal = roomKey;
                    }
                }

                if (chosenGoal !== actor.location) {
                    let path = findPath(actor.location, chosenGoal, state.blockedConnections);
                    if (path && path.length > 1) {
                        actor.location = path[1];
                        return `Bob travels to the ${state.storyRooms[actor.location].name}.`;
                    }
                }
                return `Bob is resting at the ${state.storyRooms[actor.location].name}.`;
            }
        },
        sly: {
            id: "sly",
            name: "Sly",
            role: "thief",
            color: "#a855f7",
            location: "tavern",
            inventory: [],
            desires: { steal: 40, wander: 20, hide: 10 },
            desireTargets: {
                steal: "target",
                wander: "square",
                hide: "tavern"
            },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 8, stealth: 9, retention: 5 },
            memories: [],
            promptTemplate: `You are Sly, a rogue thief NPC.
Current location: {location}.
Exits available: {neighbors}.
Your Inventory: {inventory}.

World Lore / Facts Database:
{world_lore}

Your Priorities: Steal Scroll (urgency weight: {steal_weight}/200), Wander/Patrol (urgency weight: {wander_weight}/200), Hide (urgency weight: {hide_weight}/200).

Goal: Steal items from Bob or the Player. You want the 'Secret Scroll' if Bob has it, or from the Player if they have it. AVOID the Castle Guard (guard) at all costs! If the Guard is in a room, do not enter that room. If the Guard enters your room, you must flee to a safe adjacent room immediately.
If someone carrying a target item is in your room and the Guard is NOT present, try to pickpocket them.
If not, move closer to them. Use your memories and the "last seen traveling here" hints of other actors to track where Bob or the Player currently are, and plan a path to them!

Your Memories (most relevant first):
{memories}

Rules:
- If there are multiple people in the room (more than just you and the victim), there are too many eyes/witnesses. You must hold back and set "steal_attempt" to "none".
- If the player is in your room and is actively talking to you (e.g. they say "hi Sly" or address you), you should stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current target.
Output EXACTLY this JSON:
{{
  "long_term_goal": "steal_scroll" | "flee" | "patrol",
  "plan_steps": ["go_room", "go_room", ...],
  "steal_attempt": "none" | "player" | "bob",
  "thought": "Character internal rogue thought."
}}`,
            subscriptions: {
                "actor_entered": (actor, event, state, logGame, logDirector, getNeighbors, findPath) => {
                    if (event.payload.actorId === "guard" && event.location === actor.location) {
                        const neighbors = getNeighbors(actor.location, state.blockedConnections);
                        const guardLoc = state.actors.guard ? state.actors.guard.location : null;
                        const safeNeighbors = neighbors.filter(n => n !== guardLoc);
                        
                        let droppedItem = null;
                        if (actor.inventory.includes("Secret Scroll")) {
                            droppedItem = "Secret Scroll";
                        } else if (actor.inventory.includes("Deciphered Message")) {
                            droppedItem = "Deciphered Message";
                        }

                        if (droppedItem) {
                            actor.inventory = actor.inventory.filter(i => i !== droppedItem);
                            if (!state.playerInventory) state.playerInventory = [];
                            if (!state.playerInventory.includes(droppedItem)) {
                                state.playerInventory.push(droppedItem);
                            }
                        }

                        if (safeNeighbors.length > 0) {
                            const dest = safeNeighbors[Math.floor(Math.random() * safeNeighbors.length)];
                            actor.location = dest;
                            
                            const secondaryNeighbors = getNeighbors(dest, state.blockedConnections).filter(n => n !== guardLoc && n !== dest);
                            if (secondaryNeighbors.length > 0) {
                                const fleeDest = secondaryNeighbors[Math.floor(Math.random() * secondaryNeighbors.length)];
                                actor.longTermGoal = "flee";
                                actor.activePlan = [`go_${fleeDest}`];
                            }

                            if (droppedItem) {
                                logGame("npc", `<i>Trapped by the Guard, Sly the Thief drops the ${droppedItem} and flees to the ${state.storyRooms[dest].name}! You quickly retrieve it.</i>`);
                            } else {
                                logGame("npc", `<i>You catch a shadow darting away. Sly the Thief flees to the ${state.storyRooms[dest].name} to avoid the Castle Guard!</i>`);
                            }
                            logDirector(`SLY FLEE: Sly detected Guard entering and fled to ${dest}. Item dropped: ${droppedItem}`);
                        } else {
                            logGame("npc", `<i>Sly hides in the shadows, sweating under the Castle Guard's gaze.</i>`);
                        }
                    }
                }
            },
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                const guardLoc = state.actors.guard ? state.actors.guard.location : null;

                let pDist = findPath(actor.location, state.playerLocation, state.blockedConnections);
                let bDist = findPath(actor.location, state.actors.bob.location, state.blockedConnections);

                let pDistLen = pDist ? pDist.length : Infinity;
                let bDistLen = bDist ? bDist.length : Infinity;

                let targetLoc = null;
                if (pDistLen <= bDistLen && pDistLen > 1) {
                    targetLoc = pDist[1];
                } else if (bDistLen > 1) {
                    targetLoc = bDist[1];
                }

                if (guardLoc && targetLoc === guardLoc) {
                    return "Sly waits in the shadows, avoiding the Guard.";
                }

                if (targetLoc && neighbors.includes(targetLoc)) {
                    actor.location = targetLoc;
                    return `You catch a shadow moving. Sly the Thief sneaks into the ${state.storyRooms[targetLoc].name}.`;
                } else {
                    let victims = [];
                    if (actor.location === state.playerLocation) victims.push("player");
                    if (actor.location === state.actors.bob.location) victims.push("bob");

                    if (victims.length > 0) {
                        const peopleInRoom = Object.values(state.actors).filter(a => a.location === actor.location).length + (state.playerLocation === actor.location ? 1 : 0);
                        if (peopleInRoom > 2) {
                            return "Sly glances around warily; with other people present, there are too many eyes to attempt a theft.";
                        }
                        let chosen = victims[Math.floor(Math.random() * victims.length)];
                        if (chosen === "bob" && state.actors.bob.inventory.includes("Secret Scroll")) {
                            state.actors.bob.inventory = [];
                            actor.inventory.push("Secret Scroll");
                            return "THEFT: Sly pickpockets Bob and steals the Secret Scroll!";
                        } else if (chosen === "player") {
                            return "THEFT: Sly tried to pickpocket you but found nothing.";
                        }
                    }
                }
                return "Sly waits in the shadows.";
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
Adjacent exits: {neighbors}.
Your Inventory: {inventory}.

Your Job: You run the Alchemist Shop. You smell of sulfur and lavender. If the player brings you the 'Secret Scroll', you will brew a revealing potion to decipher it. In your dialogue, if the player has the 'Secret Scroll', encourage them to show it to you or let you decipher it. Once they give it to you, you will pour the lavender brew to reveal its secrets.

Rules:
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away.`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                return `Alchemist is tending to the shop.`;
            }
        },
        guard: {
            id: "guard",
            name: "Castle Guard",
            role: "guard",
            color: "#3b82f6",
            location: "gates",
            inventory: [],
            desires: { patrol: 40, watch: 20 },
            desireTargets: {
                patrol: "courtyard",
                watch: "gates"
            },
            activePlan: [],
            longTermGoal: null,
            skills: { perception: 7, stealth: 1, retention: 8 },
            memories: [],
            promptTemplate: `You are the Castle Guard.
Current location: {location}.
Adjacent exits: {neighbors}.
Your Inventory: {inventory}.

World Lore / Facts Database:
{world_lore}

Your Priorities: Patrol Duty (urgency weight: {patrol_weight}/200), Watch Duty (urgency weight: {watch_weight}/200).

Your Job: Patrol the Castle Gates (gates), Castle Courtyard (courtyard), and Castle Keep (keep). You must watch for Sly the Thief. If Sly is present in your room, you will arrest him or chase him away.
If someone is talking to you, stay and reply.

You must formulate a multi-step travel plan to achieve your patrol duty.
Output EXACTLY this JSON:
{{
  "long_term_goal": "patrol" | "watch",
  "plan_steps": ["go_room", "go_room", ...],
  "thought": "Internal thoughts about your patrol duty"
}}`,
            subscriptions: {
                "shout": (actor, event, state, logGame, logDirector, getNeighbors, findPath) => {
                    const path = findPath(actor.location, event.location, state.blockedConnections);
                    if (path && (path.length - 1) <= 2) {
                        actor.longTermGoal = "respond_to_shout";
                        actor.activePlan = path.slice(1).map(r => `go_${r}`);
                        logGame("director-announce", `<i>The Castle Guard hears the shout echoing from the ${state.storyRooms[event.location].name} and rushes to investigate!</i>`);
                        logDirector(`GUARD RESPONSE: Guard heard shout event at ${event.location} and planned path: ${actor.activePlan.join(' -> ')}`);
                    }
                }
            },
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                const sly = state.actors.sly;
                if (sly && sly.location === actor.location) {
                    return `Castle Guard watches Sly suspiciously: 'State your business, thief!'`;
                }

                const patrolRoute = ["gates", "courtyard", "keep"];
                if (!patrolRoute.includes(actor.location)) {
                    let path = findPath(actor.location, "gates", state.blockedConnections);
                    if (path && path.length > 1) {
                        actor.location = path[1];
                        return `Castle Guard travels to the ${state.storyRooms[actor.location].name} on patrol.`;
                    }
                } else {
                    let idx = patrolRoute.indexOf(actor.location);
                    let nextIdx = (idx + 1) % patrolRoute.length;
                    let targetRoom = patrolRoute[nextIdx];
                    let path = findPath(actor.location, targetRoom, state.blockedConnections);
                    if (path && path.length > 1) {
                        actor.location = path[1];
                        return `Castle Guard patrols to the ${state.storyRooms[actor.location].name}.`;
                    }
                }
                return `Castle Guard stands watch at the ${state.storyRooms[actor.location].name}.`;
            }
        }
    }
};
