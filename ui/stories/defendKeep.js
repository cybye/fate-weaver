// --- CHAPTER 3: DEFEND THE KEEP STORY CONFIGURATION ---
// Continues the castle spy arc. After the player warned the King with the
// Deciphered Message, the garrison prepares for the rebel midnight assault.
// The player must rally the Guard, help the Alchemist brew fire-bombs, and
// repel the attack at the Castle Keep.

export const STORY_CONFIG = {
    id: "defend_keep",
    title: "Defend the Keep",
    chapterTitle: "Chapter 3: Defend the Keep",
    initialPlayerLocation: "courtyard",
    initialPlayerInventory: [],
    // Per-chapter writing style: tailors the Writer's prose for this chapter.
    writerStyle: "Write with tension and urgency, like a war chronicle. Short, driving sentences; the clang of steel, the roar of fire-bombs, the press of bodies. Keep dialogue shouted and tactical. Convey the rising stakes of the midnight assault.",

    rooms: {
        tavern: { name: "Tavern", x: 25, y: 35, desc: "A cozy, warm tavern filled with the scent of roasted barley and woodsmoke. Word of the coming assault has the regulars on edge." },
        square: { name: "Town Square", x: 50, y: 40, desc: "The bustling center of town. Militia criers shout warnings of the rebel attack." },
        alchemist: { name: "Alchemist Shop", x: 75, y: 35, desc: "A cramped shop smelling of sulfur and lavender, now doubling as a makeshift arsenal workshop." },
        gates: { name: "Castle Gates", x: 50, y: 65, desc: "The towering iron gates of the castle, now barred and manned by nervous guards." },
        courtyard: { name: "Castle Courtyard", x: 50, y: 85, desc: "A grand open-air courtyard within the outer castle walls, where the garrison drills by torchlight." },
        keep: { name: "Castle Keep", x: 75, y: 85, desc: "The towering stone keep, containing the royal archive halls and the King's war room." },
        barracks: { name: "Barracks", x: 25, y: 85, desc: "A long timber hall where off-duty soldiers rest. Racks of pikes and shields line the walls." },
        tunnel: { name: "Secret Tunnel", x: 35, y: 95, desc: "A damp, narrow passage beneath the outer wall — the very route the rebels plan to use for their surprise entry." }
    },

    connections: [
        { from: "tavern", to: "square" },
        { from: "square", to: "alchemist" },
        { from: "square", to: "gates" },
        { from: "gates", to: "courtyard" },
        { from: "courtyard", to: "keep" },
        { from: "courtyard", to: "barracks" },
        { from: "barracks", to: "tunnel" },
        { from: "tunnel", to: "courtyard" }
    ],

    loreLedger: [
        "The Deciphered Message revealed a surprise rebel midnight attack on the Castle Keep.",
        "The King has ordered the garrison to prepare defenses before the moon reaches its peak.",
        "The Alchemist can brew Fire-Bombs from sulfur and lavender if given the right reagents.",
        "Sly the Thief may try to sabotage the defenses or let the rebels in through the Secret Tunnel.",
        "The Secret Tunnel beneath the outer wall is the rebels' planned point of entry."
    ],

    storyDag: {
        startNodeId: "rally_garrison",
        nodes: {
            rally_garrison: {
                id: "rally_garrison",
                title: "Rally the Garrison",
                description: "Find the Castle Guard in the Courtyard and confirm the King's defense orders before turn 6.",
                maxTurns: 6,
                playerPersona: "a trusted herald who carried the warning to the King. You must ensure the garrison is ready for the rebel assault.",
                maxConversationRounds: 3,
                decisionPoints: [],
                updateObjectives: (state) => {
                    if (state.actors.guard) {
                        state.actors.guard.criticalObjective = "Patrol the Courtyard (courtyard) and Barracks (barracks). If the player speaks to you, confirm the King's defense orders and prepare the garrison.";
                    }
                    if (state.actors.sly) {
                        state.actors.sly.criticalObjective = "Lurk near the Courtyard (courtyard) or Secret Tunnel (tunnel). Look for a chance to sabotage the garrison's preparations.";
                    }
                },
                convergenceCheck: (state) => {
                    const spokeToGuard = state.activeConversationTarget === "guard";
                    if (spokeToGuard) {
                        return {
                            status: "completed",
                            fallbackSpeech: "The King's orders are clear. We hold the Courtyard and the Keep. Find the Alchemist and arm us with fire — the rebels fear flame more than steel.",
                            actorSpeechId: "guard",
                            prompt: `Formulate a short spoken dialogue (1-2 sentences) in-character as the Castle Guard. Confirm the King's defense orders. Tell the player to find the Alchemist and prepare fire-bombs because the rebels fear flame.`,
                            systemPrompt: `You are the Castle Guard. Confirm the King's orders to the player and tell them to find the Alchemist for fire-bombs. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`,
                            msg: "STORY CONVERGENCE: The garrison is rallied and the defense plan is set."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["brew_firebombs"],
                dialogueConstraints: {
                    guard: "Confirm the King's defense orders. Tell the player to find the Alchemist and prepare fire-bombs."
                }
            },
            brew_firebombs: {
                id: "brew_firebombs",
                title: "Brew the Fire-Bombs",
                description: "Bring Sulfur and Lavender to the Alchemist Shop to brew Fire-Bombs within 8 turns.",
                maxTurns: 8,
                playerPersona: "an armorer-of-sorts racing reagents to the Alchemist. You must gather Sulfur and Lavender and have the Alchemist brew Fire-Bombs for the garrison.",
                maxConversationRounds: 3,
                decisionPoints: [
                    {
                        id: "gather_sulfur",
                        condition: (state) =>
                            state.playerLocation === "tunnel" &&
                            !state.playerInventory.includes("Sulfur"),
                        prompt: "In the dank air of the Secret Tunnel, you spot crusted yellow deposits of raw Sulfur on the walls. Collect it?",
                        choices: [
                            {
                                label: "Scrape the Sulfur from the wall",
                                mutations: [],
                                consequence: "You pocket a handful of acrid, yellow Sulfur."
                            }
                        ]
                    },
                    {
                        id: "gather_lavender",
                        condition: (state) =>
                            state.playerLocation === "alchemist" &&
                            !state.playerInventory.includes("Lavender"),
                        prompt: "A pot of lavender sits on the Alchemist's workbench, its scent cutting through the sulfur. Take a sprig?",
                        choices: [
                            {
                                label: "Take a sprig of Lavender",
                                mutations: [],
                                consequence: "You tuck the fragrant Lavender into your satchel."
                            }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    if (state.actors.alchemist) {
                        state.actors.alchemist.criticalObjective = "The player should bring you Sulfur and Lavender so you can brew Fire-Bombs for the garrison.";
                    }
                },
                convergenceCheck: (state) => {
                    const atAlchemist = state.playerLocation === "alchemist";
                    const hasSulfur = state.playerInventory.includes("Sulfur");
                    const hasLavender = state.playerInventory.includes("Lavender");

                    if (atAlchemist && hasSulfur && hasLavender) {
                        state.playerInventory = state.playerInventory.filter(i => i !== "Sulfur" && i !== "Lavender");
                        state.playerInventory.push("Fire-Bombs");
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: The Alchemist mixes Sulfur and Lavender into a batch of hissing Fire-Bombs! The garrison is now armed with flame."
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: ["repel_assault"],
                pressureConfig: {
                    keyItems: ["Sulfur", "Lavender"],
                    targetRoom: "alchemist",
                    keyActors: ["alchemist"]
                }
            },
            repel_assault: {
                id: "repel_assault",
                title: "Repel the Midnight Assault",
                description: "Take the Fire-Bombs to the Castle Keep and defend it when the rebels strike before turn 10.",
                maxTurns: 10,
                playerPersona: "the keeper of the realm's last line of defense. You must reach the Castle Keep with the Fire-Bombs and turn back the rebel assault.",
                maxConversationRounds: 3,
                decisionPoints: [
                    {
                        id: "seal_tunnel",
                        condition: (state) =>
                            state.playerLocation === "tunnel" &&
                            !state.decisionsLog?.tunnel_sealed,
                        prompt: "The Secret Tunnel is the rebels' planned entry. You could collapse the entrance with rubble to deny them the route. Do it?",
                        choices: [
                            {
                                label: "Collapse the tunnel entrance",
                                mutations: [{ type: "set_decisions_log", key: "tunnel_sealed", value: true }],
                                consequence: "You heap rubble across the tunnel mouth. The rebels' secret route is blocked."
                            }
                        ]
                    }
                ],
                updateObjectives: (state) => {
                    if (state.actors.guard) {
                        state.actors.guard.criticalObjective = "Hold the Courtyard (courtyard) and Castle Keep (keep). If the player is present, coordinate the defense.";
                    }
                    if (state.actors.sly) {
                        if (state.actors.sly.inventory.includes("Keep Key")) {
                            state.actors.sly.criticalObjective = "Sneak the rebels into the Keep (keep) using the stolen Keep Key!";
                        } else {
                            state.actors.sly.criticalObjective = "Slip into the Barracks (barracks) or Secret Tunnel (tunnel) and sabotage the defenses or steal the Keep Key.";
                        }
                    }
                },
                convergenceCheck: (state) => {
                    const atKeep = state.playerLocation === "keep";
                    const hasBombs = state.playerInventory.includes("Fire-Bombs");
                    const tunnelSealed = state.decisionsLog && state.decisionsLog.tunnel_sealed;
                    const slyHasKey = state.actors.sly && state.actors.sly.inventory.includes("Keep Key");

                    if (atKeep && hasBombs && (tunnelSealed || !slyHasKey)) {
                        return {
                            status: "completed",
                            msg: "STORY CONVERGENCE: With Fire-Bombs blazing and the tunnel sealed, the rebel assault breaks against the Keep's walls. The castle is saved!"
                        };
                    }
                    return { status: "running" };
                },
                nextNodes: [],
                pressureConfig: {
                    keyItems: ["Fire-Bombs"],
                    targetRoom: "keep",
                    keyActors: ["guard"]
                }
            }
        }
    },

    actors: {
        guard: {
            id: "guard",
            name: "Castle Guard",
            role: "guard",
            color: "#3b82f6",
            location: "courtyard",
            inventory: [],
            desires: { patrol: 60, watch: 30 },
            desireTargets: {
                patrol: "barracks",
                watch: "courtyard"
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

Your Job: Defend the Castle Keep from the coming rebel midnight assault. Patrol the Courtyard (courtyard), Barracks (barracks), and Castle Keep (keep). Watch for Sly the Thief and any rebels entering through the Secret Tunnel (tunnel). If the player speaks to you, coordinate the defense.

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

                const patrolRoute = ["courtyard", "barracks", "keep"];
                if (!patrolRoute.includes(actor.location)) {
                    let path = findPath(actor.location, "courtyard", state.blockedConnections);
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

Your Job: You run the Alchemist Shop, now a makeshift arsenal. If the player brings you Sulfur and Lavender, you will brew Fire-Bombs for the garrison. Encourage them to gather those reagents.

Rules:
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away.`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                return `Alchemist is tending the workshop.`;
            }
        },
        sly: {
            id: "sly",
            name: "Sly",
            role: "thief",
            color: "#a855f7",
            location: "tunnel",
            inventory: [],
            desires: { sabotage: 50, wander: 20, hide: 10 },
            desireTargets: {
                sabotage: "barracks",
                wander: "courtyard",
                hide: "tunnel"
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

Your Priorities: Sabotage Defenses (urgency weight: {sabotage_weight}/200), Wander/Patrol (urgency weight: {wander_weight}/200), Hide (urgency weight: {hide_weight}/200).

Goal: Undermine the garrison's defense of the Keep. Sneak into the Barracks (barracks) or Secret Tunnel (tunnel) to sabotage preparations or steal the Keep Key. AVOID the Castle Guard (guard) at all costs! If the Guard is in a room, do not enter that room. If the Guard enters your room, flee to a safe adjacent room immediately.

Rules:
- If the player is in your room and is actively talking to you, stay in the room and converse. Do not walk away immediately.

You must formulate a multi-step travel plan to achieve your current priority.
Output EXACTLY this JSON:
{{
  "long_term_goal": "sabotage" | "flee" | "patrol",
  "plan_steps": ["go_room", "go_room", ...],
  "thought": "Character internal rogue thought."
}}`,
            heuristics: (actor, state, neighbors, getNeighbors, findPath) => {
                const guardLoc = state.actors.guard ? state.actors.guard.location : null;
                const targetLoc = "barracks";

                if (guardLoc && targetLoc === guardLoc) {
                    return "Sly waits in the shadows, avoiding the Guard.";
                }

                if (neighbors.includes(targetLoc)) {
                    actor.location = targetLoc;
                    return `You catch a shadow moving. Sly the Thief sneaks into the ${state.storyRooms[targetLoc].name}.`;
                }
                return "Sly waits in the shadows.";
            }
        }
    }
};
