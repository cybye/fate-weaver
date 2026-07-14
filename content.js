// --- GAME WORLD DATA AND NARRATIVE SPECIFICATION ---

export const ROOMS = {
    tavern: { name: "Tavern", x: 25, y: 35, desc: "A cozy, warm tavern filled with the scent of roasted barley and woodsmoke." },
    square: { name: "Town Square", x: 50, y: 40, desc: "The bustling center of town. A grand stone fountain sits in the middle." },
    alchemist: { name: "Alchemist Shop", x: 75, y: 35, desc: "A cramped shop smelling of sulfur and lavender, lined with glowing potion vials." },
    gates: { name: "Castle Gates", x: 50, y: 65, desc: "The towering iron gates of the castle, guarded by two stony knights." },
    courtyard: { name: "Castle Courtyard", x: 50, y: 85, desc: "A grand open-air courtyard within the outer castle walls, flanked by stone ramparts." },
    keep: { name: "Castle Keep", x: 75, y: 85, desc: "The towering stone keep, containing the royal archive halls and guarded chambers of the King." }
};

export const CONNECTIONS = [
    { from: "tavern", to: "square" },
    { from: "square", to: "alchemist" },
    { from: "square", to: "gates" },
    { from: "gates", to: "courtyard" },
    { from: "courtyard", to: "keep" }
];

export const LORE_LEDGER = [
    "Bob is a royal messenger carrying a Secret Scroll containing warning plans for the King.",
    "Sly is a rogue thief trying to pickpocket Bob and steal the Secret Scroll.",
    "The Player must meet Bob at the Castle Gates to receive the Secret Scroll."
];

export const INITIAL_ACTORS = {
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
            // Sleep
            if (actor.location !== "tavern") actor.desires.sleep += 5;
            else actor.desires.sleep = 0;
            // Shop
            if (actor.location !== "alchemist") actor.desires.shop += 4;
            else actor.desires.shop = 0;
            // Wander
            if (actor.location !== "square") actor.desires.wander += 3;
            else actor.desires.wander = Math.max(0, actor.desires.wander - 10);

            let shopWeight = actor.desires.shop;
            if (state.followingActorId === "bob") {
                shopWeight = 200; // Prioritize leading player to the alchemist shop
            }

            const desireMap = {
                tavern: actor.desires.sleep,
                alchemist: shopWeight,
                square: actor.desires.wander,
                gates: actor.desires.meet || 0
            };

            let bestUtility = -Infinity;
            let chosenGoal = actor.location;

            for (let roomKey in ROOMS) {
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
                    return `Bob travels to the ${ROOMS[actor.location].name}.`;
                }
            }
            return `Bob is resting at the ${ROOMS[actor.location].name}.`;
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
{
  "long_term_goal": "steal_scroll" | "flee" | "patrol",
  "plan_steps": ["go_room", "go_room", ...], // Array of sequential travel actions starting from your current room (e.g., ["go_square", "go_gates"]). Use ["stay"] if staying here.
  "steal_attempt": "none" | "player" | "bob",
  "thought": "Character internal rogue thought."
}`,
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
                        
                        // Plan to flee even further on the next turn!
                        const secondaryNeighbors = getNeighbors(dest, state.blockedConnections).filter(n => n !== guardLoc && n !== dest);
                        if (secondaryNeighbors.length > 0) {
                            const fleeDest = secondaryNeighbors[Math.floor(Math.random() * secondaryNeighbors.length)];
                            actor.longTermGoal = "flee";
                            actor.activePlan = [`go_${fleeDest}`];
                        }

                        if (droppedItem) {
                            logGame("npc", `<i>Trapped by the Guard, Sly the Thief drops the ${droppedItem} and flees to the ${ROOMS[dest].name}! You quickly retrieve it.</i>`);
                        } else {
                            logGame("npc", `<i>You catch a shadow darting away. Sly the Thief flees to the ${ROOMS[dest].name} to avoid the Castle Guard!</i>`);
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
                return `You catch a shadow moving. Sly the Thief sneaks into the ${ROOMS[targetLoc].name}.`;
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
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away.`
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
{
  "long_term_goal": "patrol" | "watch",
  "plan_steps": ["go_room", "go_room", ...], // Array of sequential travel actions starting from your current room (e.g., ["go_courtyard", "go_keep"]). Use ["stay"] if staying here.
  "thought": "Internal thoughts about your patrol duty"
}`,
        subscriptions: {
            "shout": (actor, event, state, logGame, logDirector, getNeighbors, findPath) => {
                const path = findPath(actor.location, event.location, state.blockedConnections);
                if (path && (path.length - 1) <= 2) {
                    actor.longTermGoal = "respond_to_shout";
                    actor.activePlan = path.slice(1).map(r => `go_${r}`);
                    logGame("director-announce", `<i>The Castle Guard hears the shout echoing from the ${ROOMS[event.location].name} and rushes to investigate!</i>`);
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
                    return `Castle Guard travels to the ${ROOMS[actor.location].name} on patrol.`;
                }
            } else {
                let idx = patrolRoute.indexOf(actor.location);
                let nextIdx = (idx + 1) % patrolRoute.length;
                let targetRoom = patrolRoute[nextIdx];
                let path = findPath(actor.location, targetRoom, state.blockedConnections);
                if (path && path.length > 1) {
                    actor.location = path[1];
                    return `Castle Guard patrols to the ${ROOMS[actor.location].name}.`;
                }
            }
            return `Castle Guard stands watch at the ${ROOMS[actor.location].name}.`;
        }
    }
};

// --- NARRATIVE STORY DAG SPECIFICATION ---
export const STORY_DAG = {
    startNode: "deliver_scroll",
    nodes: {
        deliver_scroll: {
            id: "deliver_scroll",
            title: "The Scroll's Delivery",
            description: "Meet Bob at the Castle Gates to receive the Secret Scroll before turn 10.",
            maxTurns: 10,
            // AutoPlayer persona for this milestone chapter
            playerPersona: "a wary but curious traveler who has just arrived in town and is eager to find out what's going on. You ask questions before acting, and trust your instincts about people.",
            // How many back-and-forth rounds AutoPlay will hold a conversation before closing it
            maxConversationRounds: 3,
            // Decision points: content-defined gates that pause AutoPlay and ask the real player to choose
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
                        state.actors.bob.criticalObjective = "Find the Secret Scroll or help the player recover it from Sly.";
                    }
                }
                if (state.actors.sly) {
                    const hasScroll = state.actors.sly.inventory.includes("Secret Scroll");
                    const bobHasScroll = state.actors.bob && state.actors.bob.inventory.includes("Secret Scroll");
                    if (isPlayerFollowing("sly")) {
                        state.actors.sly.criticalObjective = "The player is actively FOLLOWING you. Lead them away from the Castle Guard, or lure them into a quiet area like the Keep to pickpocket them.";
                    } else if (hasScroll) {
                        state.actors.sly.criticalObjective = "You have the Secret Scroll! Escape from the Castle Guard and carry it to safety (avoid the gates/guard).";
                    } else if (bobHasScroll) {
                        state.actors.sly.criticalObjective = "Tee up an opportunity to steal the Secret Scroll from Bob. Find Bob and pickpocket him.";
                    } else {
                        state.actors.sly.criticalObjective = "Locate the Secret Scroll and steal it.";
                    }
                }
                if (state.actors.guard) {
                    const guard = state.actors.guard;
                    const slyLocation = state.actors.sly ? state.actors.sly.location : null;
                    if (isPlayerFollowing("guard")) {
                        guard.criticalObjective = "The player is actively FOLLOWING you. Lead them along your patrol route (gates -> courtyard -> keep) to ensure safety, while looking out for Sly.";
                    } else if (slyLocation === guard.location) {
                        guard.criticalObjective = "Arrest Sly the Thief immediately and secure the area.";
                    } else {
                        guard.criticalObjective = "Patrol the Castle Gates, Courtyard, and Keep, and arrest Sly the Thief if you spot him.";
                    }
                }
            },
            pressureConfig: {
                targetRoom: "gates",
                keyActors: ["bob"],
                keyItems: ["Secret Scroll"]
            },
            checkConvergence: (state) => {
                const pLoc = state.playerLocation;
                const bLoc = state.actors.bob.location;
                const sLoc = state.actors.sly.location;

                // Case 0: Player already acquired it!
                if (state.playerInventory && state.playerInventory.includes("Secret Scroll")) {
                    return {
                        status: "completed",
                        actorSpeechId: "bob",
                        fallbackSpeech: "I'm glad you recovered the scroll from that thief!",
                        msg: "<b>STORY CONVERGENCE:</b> You have recovered the Secret Scroll!"
                    };
                }

                if (pLoc === "gates" && bLoc === "gates" && state.actors.bob.inventory.includes("Secret Scroll")) {
                    // Check if Sly is also at the Gates!
                    if (sLoc === "gates") {
                        return {
                            status: "pending",
                            actorSpeechId: "bob",
                            fallbackSpeech: "I can't hand you the scroll while that thief Sly is lurking nearby! Call for a guard!",
                            msg: null
                        };
                    }
                    return {
                        status: "completed",
                        actorSpeechId: "bob",
                        fallbackSpeech: "Here is the Secret Scroll! Finally, I've slipped past the thief. Take it and decipher it quickly!",
                        msg: "<b>STORY CONVERGENCE:</b> Bob hands you the Secret Scroll! The message is yours."
                    };
                }

                if (pLoc === "gates" && sLoc === "gates" && state.actors.sly.inventory.includes("Secret Scroll")) {
                    // Require Guard to be at the Gates to trap Sly!
                    const guardLoc = state.actors.guard ? state.actors.guard.location : null;
                    if (guardLoc !== "gates") {
                        return {
                            status: "pending",
                            actorSpeechId: "bob",
                            fallbackSpeech: "Oh no! My pockets are empty... Sly has stolen the Secret Scroll! Stop him, call the Guard!",
                            msg: null
                        };
                    }
                    return {
                        status: "completed",
                        actorSpeechId: "sly",
                        fallbackSpeech: "Alright, alright, you caught me! Here's your scroll, just let me go!",
                        msg: "<b>STORY CONVERGENCE:</b> You corner Sly the Thief at the Castle Gates! Sly drops the scroll and flees."
                    };
                }

                return null;
            },
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
- Otherwise, if the player is in your room and actively talking to you, stay in the room and converse.

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
            heuristics: (state, logGame, logDirector) => {
                let turn = state.turn;
                let pLoc = state.playerLocation;

                // Tavern Eviction (Turn 4)
                if (pLoc === "tavern" && turn >= 4) {
                    state.playerLocation = "square";
                    if (!state.blockedConnections.includes("tavern-square") && !state.blockedConnections.includes("square-tavern")) {
                        state.blockedConnections.push("tavern-square");
                    }
                    logDirector("Milestone Heuristics: Evicted player from Tavern (Turn >= 4)");
                    logGame("director-announce", "<i>The tavern keeper bellows: 'Last call! Everyone out!' and locks the doors, ushering you into the Town Square.</i>");
                    pLoc = "square";
                }

                // Hard Convergence nudge (Turn 9)
                if (turn === 9) {
                    if (state.actors.bob && state.actors.bob.location !== "gates") {
                        state.actors.bob.location = "gates";
                        logDirector("Milestone Heuristics: Teleported Bob to Gates (Turn 9)");
                    }
                    if (state.actors.sly && state.actors.sly.inventory.includes("Secret Scroll")) {
                        state.actors.sly.inventory = [];
                        if (state.actors.bob) state.actors.bob.inventory = ["Secret Scroll"];
                        logDirector("Milestone Heuristics: Restored scroll to Bob off-screen (Turn 9)");
                        logGame("director-announce", "<i>The town guard arrested Sly and returned the stolen items to Bob near the gates.</i>");
                    }
                    if (pLoc !== "gates") {
                        logGame("director-announce", "<i>Guards usher citizens: 'Move towards the Castle Gates immediately!'</i>");
                    }
                }
            },
            nextNodes: ["decipher_scroll"]
        },
        decipher_scroll: {
            id: "decipher_scroll",
            title: "Brewing the Reveal Potion",
            description: "Take the Secret Scroll to the Alchemist Shop to brew a revealing potion within 8 turns.",
            maxTurns: 8,
            // AutoPlayer persona shifts — player now has the scroll and knows the stakes
            playerPersona: "a traveler who has just received an urgent mission. You move with purpose toward the Alchemist Shop, but you remain alert for the thief Sly who is shadowing you.",
            maxConversationRounds: 2,
            decisionPoints: [
                {
                    id: "confront_sly_alchemist",
                    condition: (state) =>
                        state.actors.sly?.location === state.playerLocation &&
                        state.playerInventory?.includes("Secret Scroll") &&
                        state.playerLocation !== "gates",
                    prompt: "Sly steps directly into your path, blocking the way. \"Hand over the scroll and I'll let you pass. Make a scene, and everyone loses.\" Your move.",
                    choices: [
                        {
                            label: "Shout for the Guard!",
                            mutations: [],
                            consequence: "Your shout echoes through the street. Sly flinches — and bolts."
                        },
                        {
                            label: "Try to bluff past him",
                            mutations: [],
                            consequence: "You keep walking, heart hammering. Sly lets you by — for now."
                        }
                    ]
                }
            ],
            updateObjectives: (state) => {
                const isPlayerFollowing = (actorId) => state.followingActorId === actorId;
                if (state.actors.bob) {
                    if (isPlayerFollowing("bob")) {
                        state.actors.bob.criticalObjective = "The player is actively FOLLOWING you. Lead them directly to the Alchemist Shop (alchemist) to brew the revealing potion. Do not stay in the room.";
                    } else {
                        state.actors.bob.criticalObjective = "You have delivered the scroll. Encourage the player to go to the Alchemist Shop to decipher it.";
                    }
                }
                if (state.actors.sly) {
                    if (isPlayerFollowing("sly")) {
                        state.actors.sly.criticalObjective = "The player is actively FOLLOWING you. Lead them away from the Castle Guard, or lure them into a quiet area like the Keep or Alchemist Shop to pickpocket them.";
                    } else {
                        state.actors.sly.criticalObjective = "The player has the Secret Scroll. Follow the player and steal it from them.";
                    }
                }
                if (state.actors.guard) {
                    const guard = state.actors.guard;
                    const slyLocation = state.actors.sly ? state.actors.sly.location : null;
                    if (isPlayerFollowing("guard")) {
                        guard.criticalObjective = "The player is actively FOLLOWING you. Lead them along your patrol route (gates -> courtyard -> keep) to ensure safety, while looking out for Sly.";
                    } else if (slyLocation === guard.location) {
                        guard.criticalObjective = "Arrest Sly the Thief immediately and secure the area.";
                    } else {
                        guard.criticalObjective = "Patrol the Castle Gates, Courtyard, and Keep, and arrest Sly the Thief if you spot him.";
                    }
                }
                if (state.actors.alchemist) {
                    if (state.playerLocation === "alchemist") {
                        state.actors.alchemist.criticalObjective = "The player is in your shop carrying the Secret Scroll. Guide them to decipher it and brew the potion immediately.";
                    } else {
                        state.actors.alchemist.criticalObjective = "Tend to your potion shop, keeping reagents fresh for potential customers.";
                    }
                }
            },
            pressureConfig: {
                targetRoom: "alchemist",
                keyActors: [],
                keyItems: []
            },
            checkConvergence: (state) => {
                const pLoc = state.playerLocation;
                const hasScroll = state.playerInventory && state.playerInventory.includes("Secret Scroll");
                if (pLoc === "alchemist" && hasScroll) {
                    return {
                        status: "completed",
                        msg: "<b>STORY CONVERGENCE:</b> The Alchemist pours a glowing lavender liquid over the scroll. The invisible letters react, glowing bright gold: 'The keep will be attacked at midnight!'"
                    };
                }
                return null;
            },
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
                    // Guard moves to keep or patrols courtyard to block player
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
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

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
            heuristics: (state, logGame, logDirector) => {
                const turnRemaining = 8 - (state.turn - state.milestoneStartTurn);
                // Turn warning nudges
                if (turnRemaining === 2) {
                    logGame("director-announce", "<i>You hear the Alchemist muttering: 'Hurry... the shop closes soon, and these reagents won't stay fresh!'</i>");
                }
            },
            nextNodes: ["warn_king"]
        },
        warn_king: {
            id: "warn_king",
            title: "Warning the King",
            description: "Deliver the deciphered message to the Castle Keep within 8 turns to warn the King of the impending attack.",
            maxTurns: 8,
            updateObjectives: (state) => {
                const isPlayerFollowing = (actorId) => state.followingActorId === actorId;
                if (state.actors.bob) {
                    if (isPlayerFollowing("bob")) {
                        state.actors.bob.criticalObjective = "The player is actively FOLLOWING you. Lead them directly to the Castle Keep (keep) to warn the King immediately. Do not stay in the room.";
                    } else {
                        state.actors.bob.criticalObjective = "Encourage the player to deliver the deciphered message to the Castle Keep to warn the King.";
                    }
                }
                if (state.actors.sly) {
                    if (isPlayerFollowing("sly")) {
                        state.actors.sly.criticalObjective = "The player is actively FOLLOWING you. Lead them away from the Castle Guard, or lure them into a quiet area like the Keep to pickpocket them.";
                    } else {
                        state.actors.sly.criticalObjective = "The player has the Deciphered Message. Follow the player and steal it from them to stop the warning.";
                    }
                }
                if (state.actors.guard) {
                    const guard = state.actors.guard;
                    const slyLocation = state.actors.sly ? state.actors.sly.location : null;
                    if (isPlayerFollowing("guard")) {
                        guard.criticalObjective = "The player is actively FOLLOWING you. Lead them along your patrol route to ensure safety, while looking out for Sly.";
                    } else if (slyLocation === guard.location) {
                        guard.criticalObjective = "Arrest Sly the Thief immediately and secure the area.";
                    } else if (state.turn >= 8) {
                        guard.criticalObjective = "Midnight is approaching. Secure the Castle Gates and Keep against potential rebel attacks.";
                    } else {
                        guard.criticalObjective = "Patrol the Castle Gates, Courtyard, and Keep, and arrest Sly the Thief if you spot him.";
                    }
                }
            },
            pressureConfig: {
                targetRoom: "keep",
                keyActors: [],
                keyItems: []
            },
            checkConvergence: (state) => {
                const pLoc = state.playerLocation;
                const hasMessage = state.playerInventory && state.playerInventory.includes("Deciphered Message");
                if (pLoc === "keep" && hasMessage) {
                    return {
                        status: "completed",
                        msg: "<b>STORY CONVERGENCE:</b> You present the Deciphered Message to the King in the Keep. He gasps, reading the warning, and immediately alerts the royal guards. The castle is saved!"
                    };
                }
                return null;
            },
            onComplete: (state, logGame) => {
                // Final win log
            },
            heuristics: (state, logGame, logDirector) => {
                const turnRemaining = 8 - (state.turn - state.milestoneStartTurn);
                if (turnRemaining === 2) {
                    logGame("director-announce", "<i>The church bells begin to toll. Midnight approaches... warning the King is of critical urgency!</i>");
                }
            },
            nextNodes: []
        }
    }
};

export const TOOL_CALLING_PROMPT_TEMPLATE = `You are the action router for a text adventure game.
Your task is to analyze the player's natural language input and select the most appropriate action from the set of active tool definitions.

Current Location: {current_room}
Active Conversation Target (currently speaking with): {active_conversation_target}

Active Tool Definitions:
{tools_schema}

Examples of resolving player intents to tool calls:
- If Current Location is "Tavern (tavern)", allowed travel destinations are ["square"], and Input is "exit the tavern" or "leave tavern" or "step outside":
  You must call tool: {"tool_name": "travel", "arguments": {"destination": "square"}} (since square is the exit leading out of tavern).
- If Current Location is "Town Square (square)", allowed travel destinations are ["tavern", "alchemist", "gates"], and Input is "go to alchemist shop" or "enter alchemist":
  You must call tool: {"tool_name": "travel", "arguments": {"destination": "alchemist"}}.
- If Input is "look around" or "examine room" or "look":
  You must call tool: {"tool_name": "look", "arguments": {}}
- If Input is "look at the scroll" or "examine scroll" or "inspect fountain":
  You must call tool: {"tool_name": "examine", "arguments": {"target": "scroll"}} or {"tool_name": "examine", "arguments": {"target": "fountain"}}.
- If Input is "talk to bob" or "say hello to Bob":
  You must call tool: {"tool_name": "converse", "arguments": {"character_id": "bob"}} (only if Bob is present).
- If Active Conversation Target is "Bob (bob)", and Input is a conversational reply or short follow-up (e.g. "for me?", "yes", "tell me more"):
  You must call tool: {"tool_name": "converse", "arguments": {"character_id": "bob"}}.
- If Active Conversation Target is "Sly (sly)", and Input is a conversational reply or short follow-up (e.g. "Who are you?", "No, I'm just arrived"):
  You must call tool: {"tool_name": "converse", "arguments": {"character_id": "sly"}}.
- If Input is a question asked verbally (e.g. "What is this place?", "Where are we?", "Who is Bob?") and any character is present, route it to "converse" targeting the present character so they can speak the answer, rather than using the "look" tool.
- If Input is "help!" or "guard!" or "shout for help" or "yell help":
  You must call tool: {"tool_name": "shout", "arguments": {"message": "Guard! Help!"}}

Rules:
- If there is an Active Conversation Target (not "None") present in the room, and the player asks a question or makes a conversational statement (e.g. "What is this place?", "I just arrived"), you MUST default to calling the "converse" tool targeting that active character, unless the player explicitly names another character or performs a physical movement/look action.

Input: "{player_input}"

Decide which tool to invoke and provide the corresponding arguments. Ensure the selected argument values match one of the allowed options in the active tool definitions.

Output EXACTLY this JSON:
{{
  "tool_name": "travel" | "converse" | "wait" | "look" | "shout" | "examine",
  "arguments": {{
     // include arguments required by the tool, or keep empty if none
  }}
}}`;

export const GM_PROMPT_TEMPLATE = `You are the Game Master describing a turn-based adventure.
You must describe the atmosphere and the state of the room the player is CURRENTLY in, aligned perfectly with the actual game state. Do not invent movements or change locations.

Established World Lore & Facts:
{world_lore}

Current Room state:
- Name: {room_name}
- Description: {room_desc}

Actor Presence:
- Bob is in the room: {is_bob_here}
- Sly is in the room: {is_sly_here}
- Castle Guard is in the room: {is_guard_here}

Active environmental events or nudges: {nudge}

Examples of descriptions:
- If Current Room is "Tavern", Bob is present ("Yes"), Sly is present ("No"), and player action is "looked around the room":
  {"description": "You scan the cozy, wood-paneled tavern. The hearth fire crackles warmly. Bob is standing near the counter, clutching a package, while the rest of the tavern goes about their business."}
- If Current Room is "Town Square", Bob is present ("No"), Sly is present ("Yes"), and player action is "travel to Town Square":
  {"description": "You step into the bustling Town Square, where water splashes from the stone fountain. You catch a glimpse of Sly lurking near the alleyways, watching you closely."}

Write a descriptive paragraph (2-3 sentences) detailing the results of the player's action and the current atmosphere of their room, referencing the present characters.

Output EXACTLY this JSON:
{{
  "description": "Engaging description text"
}}`;

export const NPC_DIALOGUE_PROMPT_TEMPLATE = `You are {name}, a character in a text adventure game.
Your Role/Nature: {role_desc}
Your current location: {location}
Your Inventory: {inventory}

World Lore / Facts Database:
{world_lore}

Your Memories:
{memories}

The player is in your current room and says to you: "{player_speech}"

Write a brief, in-character spoken dialogue response (1-2 sentences) reacting to what the player said.
You may expand the lore of the world or introduce flavor details, but you must NOT contradict the Established World Lore in the database.
If the player asks a question about details not in the World Lore or your memories, stay in-character but politely explain that you do not know (e.g. "I am not privy to the King's private thoughts, traveler..."), rather than deflecting with unrelated statements or fabricating facts.

Story Mission Constraint (For Bob):
- If you are Bob, and the player asks about your mission, the scroll, or how they can help, you MUST explain the background story of the scroll: that it contains warning plans of a surprise midnight attack on the Castle Keep by rebel forces, and that they must take it to the Alchemist Shop to brew a revealing potion to read it. If you share this background story in this turn, set "story_shared" to true.

If your dialogue response was just a greeting or general chatter and didn't introduce any new world-building details, the "new_assertions" list must be empty: [].

Output EXACTLY this JSON:
{{
  "dialogue": "Your spoken reply here.",
  "new_assertions": ["Factual details you introduced in this dialogue response. Leave empty if you didn't invent any new details."],
  "story_shared": true | false
}}`;

export const WRITER_PROMPT_TEMPLATE = `You are a master fantasy novelist writing a chronicle.
Your task is to take the events of a single game turn and novelize them into a single, cohesive, dramatic literary paragraph (3-4 sentences).

Rules:
- Write in a rich, descriptive fantasy novelist style (past tense, third person).
- Focus on atmosphere, action, and dialogue.
- Do NOT refer to game mechanics, turn numbers, JSON, UI buttons, or rules. Translate them into narrative events (e.g., instead of 'Parsed Action: travel to Gates', write 'The traveler set off toward the towering iron gates of the castle').
- Respect the roles of the characters: Sly is a rogue thief lurking in the shadows (never a barkeep, keeper, or merchant), Bob is a royal messenger, and the Castle Guard is a patrol guard. If the player addresses a "keeper" or "barkeep" and Sly responds, write it as Sly intercepting the offer or stepping in, rather than Sly being the barkeep.
- Maintain narrative and stylistic continuity with the provided "Story chronicle written so far". Do not repeat identical descriptions, phrasing, or vocabulary, and ensure the new paragraph transitions smoothly from the previous ones.
- Add subtle, characterful narrator commentary, reflection, or mild irony about the traveler's decisions, choices, or current predicament (e.g., commenting on their amnesia, their willingness to trust strangers, or their caution).
- Combine the player's action, any NPC dialogue, the environment description, and system events of this turn into a single unified paragraph.
- Ensure the tone is immersive, dramatic, and elegant.
- Output EXACTLY this JSON:
{{
  "paragraph": "Your novelized paragraph here."
}}`;
export const AUTOPLAYER_PROMPT_TEMPLATE = `You are a player character in a text adventure game.
Your personality: {player_persona}

Current location: {location}
Your inventory: {inventory}
Story objective: {objective}
Characters present in your room: {present_npcs}
Adjacent exits you can move to: {neighbors}
Recommended next step toward objective: {next_step_hint}

IMPORTANT RULES — follow these strictly:
- You have ONE action this turn. Choose wisely.
- TRAVEL is your primary tool for story progress. Follow the recommended next step unless there is a strong narrative reason to stay (e.g. a key story character is present and you haven't spoken to them yet).
- You may talk (converse) to a character at most ONCE per room visit. If you already spoke to someone here, choose travel instead.
- You may examine something at most ONCE per room visit. Never examine the same thing twice.
- Do NOT keep talking to the same character repeatedly. Move on after one conversation.
- The character_id for converse MUST be exactly the id shown in the NPCs list (e.g. "bob", "sly").
- The destination for travel MUST be one of the exact room keys listed in the exits.

Output EXACTLY this JSON (no extra text):
{{
  "tool_name": "travel" | "converse" | "wait" | "examine",
  "arguments": {{
    // For travel: {{ "destination": "room_key" }}
    // For converse: {{ "character_id": "npc_id" }}
    // For examine: {{ "target": "item or character name" }}
    // For wait: {{}}
  }},
  "thought": "One sentence of in-character reasoning."
}}`;


