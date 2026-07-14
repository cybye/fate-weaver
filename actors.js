import { ROOMS, LORE_LEDGER } from './content.js';
import { findPath, getNeighbors } from './pathfinding.js';
import { callOllama } from './ollama.js';
import { publishEvent } from './game.js';

// --- SYSTEM EVENT BROADCASTER & PERCEPTION FILTER ---

export function broadcastEvent(state, event, logGame) {
    if (!state.actors) return;

    // 1. Check Player perception if event is in player's room
    let playerObserved = false;
    if (event.location === "global" || event.location === state.playerLocation) {
        if (event.isStealth) {
            const originActor = state.actors[event.originActorId];
            const stealthVal = originActor ? (originActor.skills ? originActor.skills.stealth : 5) : 5;
            const playerPerception = 5; // Default Player perception level
            
            const playerRoll = playerPerception + Math.floor(Math.random() * 6) + 1;
            const stealthRoll = stealthVal + Math.floor(Math.random() * 6) + 1;
            
            if (playerRoll >= stealthRoll) {
                playerObserved = true;
                if (event.playerMessage) {
                    logGame("event", `<b>[Perception Check: SUCCESS]</b> ${event.playerMessage}`);
                }
            } else {
                const targetName = state.actors[event.targetActorId] ? state.actors[event.targetActorId].name : "someone";
                logGame("event", `<b>[Perception Check: FAILED]</b> <i>You catch a subtle rustle of clothing and a shadow brushing past ${targetName}...</i>`);
                console.log(`Player failed to perceive stealth event in room: ${event.description}`);
            }
        } else {
            playerObserved = true;
            // Non-stealth events are described by standard narrative logs or GM
        }
    }

    // 2. Check NPC perceptions
    for (let actorId in state.actors) {
        const actor = state.actors[actorId];
        if (actorId === event.originActorId) continue; // Don't log own actions as memories

        let npcObserved = false;
        if (event.location === "global" || event.location === actor.location) {
            if (event.isStealth) {
                const originActor = state.actors[event.originActorId];
                const stealthVal = originActor ? (originActor.skills ? originActor.skills.stealth : 5) : 5;
                const perceptionVal = actor.skills ? actor.skills.perception : 5;

                const npcRoll = perceptionVal + Math.floor(Math.random() * 6) + 1;
                const stealthRoll = stealthVal + Math.floor(Math.random() * 6) + 1;

                if (npcRoll >= stealthRoll) {
                    npcObserved = true;
                } else {
                    console.log(`${actor.name} failed to perceive stealth event: ${event.description}`);
                }
            } else {
                npcObserved = true;
            }
        }

        if (npcObserved) {
            addActorMemory(actor, event.description, event.importance, state.turn);
        }
    }
}

export function addActorMemory(actor, eventDesc, importance, turn) {
    if (!actor.memories) actor.memories = [];
    if (actor.memories.some(m => m.eventDesc === eventDesc && m.turn === turn)) return;
    
    actor.memories.push({
        eventDesc,
        turn,
        importance,
        strength: 1.0
    });
}

export function tickActorMemories(actor) {
    if (!actor.memories) actor.memories = [];
    actor.memories.forEach(m => {
        if (m.importance < 9) {
            const retention = actor.skills ? actor.skills.retention : 5;
            const decay = (11 - retention) / m.importance / 10;
            m.strength -= decay;
        }
    });
    actor.memories = actor.memories.filter(m => m.strength > 0);
}

export function getFormattedMemories(actor, turn) {
    if (!actor.memories || actor.memories.length === 0) {
        return "No memories of recent events.";
    }
    
    const scored = actor.memories.map(m => {
        const recency = 1 / (turn - m.turn + 1);
        const weight = m.strength * m.importance * recency;
        return { memory: m, weight };
    });
    
    scored.sort((a, b) => b.weight - a.weight);
    
    const topMemories = scored.slice(0, 5).map(s => s.memory);
    return topMemories.map(m => {
        const percent = Math.round(m.strength * 100);
        return `- [Turn ${m.turn}] ${m.eventDesc} (${percent}% recall)`;
    }).join('\n');
}

// --- GENERIC ACTOR UPDATE ORCHESTRATION ---

export async function updateActor(actorId, state, logGame, logDirector, isLLMActive) {
    const actorDef = state.actors[actorId];
    if (!actorDef) return;

    // Tick memory decay every turn
    tickActorMemories(actorDef);

    // Initialize plan properties if they don't exist
    if (!actorDef.activePlan) actorDef.activePlan = [];
    if (!actorDef.longTermGoal) actorDef.longTermGoal = null;

    // A. Plan Verification & Execution Phase (Local/Deterministic)
    let isPlanValid = false;
    const neighbors = getNeighbors(actorDef.location, state.blockedConnections);

    if (actorDef.activePlan.length > 0) {
        const nextStep = actorDef.activePlan[0];
        
        // 1. Connectivity Check: Is the next step connected and unblocked?
        let isConnected = false;
        let destRoom = null;
        if (nextStep.startsWith("go_")) {
            destRoom = nextStep.split("_")[1];
            isConnected = neighbors.includes(destRoom);
        } else if (nextStep === "stay") {
            isConnected = true;
        }

        // 2. Guard Proximity Scan (for Sly): Avoid rooms with the Guard
        let isGuardBlocking = false;
        if (actorDef.id === "sly" && destRoom) {
            const guardLoc = state.actors.guard ? state.actors.guard.location : null;
            if (guardLoc && (destRoom === guardLoc || actorDef.location === guardLoc)) {
                isGuardBlocking = true;
            }
        }

        // 3. Target Drift Check: If goal is meet_player, verify player's observed location
        let isTargetOutdated = false;
        if (actorDef.longTermGoal === "meet_player" && destRoom) {
            const actorPerception = actorDef.skills ? actorDef.skills.perception : 5;
            const isPlayerAdjacent = neighbors.includes(state.playerLocation);
            const isPlayerHere = state.playerLocation === actorDef.location;
            
            let visiblePlayerLoc = "Unknown";
            if (isPlayerHere) {
                visiblePlayerLoc = state.playerLocation;
            } else if (isPlayerAdjacent && actorPerception >= 3) {
                visiblePlayerLoc = state.playerLocation;
            }
            
            if (visiblePlayerLoc !== "Unknown") {
                const lastStep = actorDef.activePlan[actorDef.activePlan.length - 1];
                const planTargetRoom = lastStep.startsWith("go_") ? lastStep.split("_")[1] : actorDef.location;
                if (planTargetRoom !== visiblePlayerLoc) {
                    isTargetOutdated = true;
                }
            }
        }

        if (isConnected && !isGuardBlocking && !isTargetOutdated) {
            isPlanValid = true;
        }
    }

    if (isPlanValid) {
        const nextAction = actorDef.activePlan.shift();
        if (actorDef.activePlan.length === 0) {
            actorDef.longTermGoal = null; // Goal achieved
        }

        if (nextAction.startsWith("go_")) {
            const dest = nextAction.split("_")[1];
            actorDef.location = dest;
            
            if (state.followingActorId === actorId) {
                state.playerLocation = dest;
                logGame("system", `You follow ${actorDef.name} to the ${ROOMS[dest].name}.`);
            }
            
            broadcastEvent(state, {
                type: "travel",
                description: `${actorDef.name} traveled to the ${ROOMS[dest].name}.`,
                location: "global",
                importance: 4,
                originActorId: actorDef.id
            }, logGame);
            logGame("npc", `<i>[Plan Execution] ${actorDef.name} moves to the ${ROOMS[dest].name}. (Remaining steps: ${actorDef.activePlan.join(" -> ") || "None"})</i>`);
            
            // Publish actor_entered event for Pub/Sub
            publishEvent(state, {
                topic: "actor_entered",
                location: dest,
                payload: { actorId: actorDef.id }
            }, logGame, logDirector);
        } else {
            logGame("npc", `<i>[Plan Execution] ${actorDef.name} stays at the ${ROOMS[actorDef.location].name}.</i>`);
        }
        return;
    } else {
        // Plan was invalid or empty, clear it
        if (actorDef.activePlan.length > 0) {
            logGame("npc", `<i>[Plan Aborted] ${actorDef.name}'s plan was aborted because the environment changed. Re-planning...</i>`);
            actorDef.activePlan = [];
            actorDef.longTermGoal = null;
        }
    }

    // B. Plan Formulation Phase (LLM or Heuristic Fallback)
    if (isLLMActive && actorDef.promptTemplate) {
        try {
            await runActorLLM(actorId, state, logGame, logDirector);
            return;
        } catch (e) {
            console.warn(`LLM failed for actor ${actorId}, falling back to heuristics.`, e);
        }
    }
    
    // Heuristic Fallback
    if (typeof actorDef.heuristics === 'function') {
        const neighbors = getNeighbors(actorDef.location, state.blockedConnections);
        
        // Save current location to check if they moved
        const oldLoc = actorDef.location;

        const resultText = actorDef.heuristics(
            actorDef, 
            state, 
            neighbors, 
            (room) => getNeighbors(room, state.blockedConnections), 
            (start, goal) => findPath(start, goal, state.blockedConnections)
        );

        // Capture movement event in fallback mode
        if (actorDef.location !== oldLoc) {
            broadcastEvent(state, {
                type: "travel",
                description: `${actorDef.name} traveled to the ${ROOMS[actorDef.location].name}.`,
                location: "global",
                importance: 4,
                originActorId: actorDef.id
            }, logGame);

            // Publish actor_entered event for Pub/Sub
            publishEvent(state, {
                topic: "actor_entered",
                location: actorDef.location,
                payload: { actorId: actorDef.id }
            }, logGame, logDirector);
        }

        // Capture theft events from Sly's heuristics in fallback mode
        if (actorDef.id === "sly" && resultText && resultText.includes("THEFT EVENT")) {
            let targetId = "bob";
            if (resultText.includes("you")) targetId = "player";
            
            broadcastEvent(state, {
                type: "theft",
                description: `Sly stole the Secret Scroll from ${targetId === "player" ? "the Player" : "Bob"}.`,
                location: oldLoc,
                importance: 10,
                originActorId: "sly",
                targetActorId: targetId,
                isStealth: true,
                playerMessage: `Sly pickpockets ${targetId === "player" ? "you" : "Bob"} and steals the Secret Scroll!`
            }, logGame);
        } else if (resultText) {
            logGame("npc", resultText);
        }
    }
}

// --- GENERIC LLM PROMPTING ---

async function runActorLLM(actorId, state, logGame, logDirector) {
    const actor = state.actors[actorId];
    const neighbors = getNeighbors(actor.location, state.blockedConnections);

    // Format prompt template with dynamic context including formatted memories
    const worldLore = LORE_LEDGER.concat(state.loreDb || []).join('\n');
    
    // Replace all desire weights dynamically in prompt template
    let systemPrompt = actor.promptTemplate;
    const isPlayerFollowing = state.followingActorId === actorId;
    if (actor.desires) {
        for (let key in actor.desires) {
            let weight = actor.desires[key];
            if (actorId === "bob" && key === "shop" && isPlayerFollowing) {
                weight = 150; // Lead player to alchemist shop!
            }
            systemPrompt = systemPrompt.replace(`{${key}_weight}`, weight);
        }
    }
    systemPrompt = systemPrompt
        .replace("{location}", actor.location)
        .replace("{neighbors}", neighbors.join(', '))
        .replace("{inventory}", JSON.stringify(actor.inventory))
        .replace("{memories}", getFormattedMemories(actor, state.turn))
        .replace("{world_lore}", worldLore);

    if (actor.criticalObjective) {
        systemPrompt += `\n\nCRITICAL OBJECTIVE: ${actor.criticalObjective}\nYou must prioritize this objective above all standard desires and follow it immediately.`;
    }

    const isPlayerHere = state.playerLocation === actor.location;
    const isPlayerAdjacent = neighbors.includes(state.playerLocation);
    const actorPerception = actor.skills ? actor.skills.perception : 5;
    
    // Determine player visibility (Perception >= Player Stealth of 3)
    let visiblePlayerLoc = "Unknown";
    if (isPlayerHere) {
        visiblePlayerLoc = ROOMS[state.playerLocation].name;
    } else if (isPlayerAdjacent && actorPerception >= 3) {
        visiblePlayerLoc = ROOMS[state.playerLocation].name;
    }

    const playerText = isPlayerHere 
        ? `The player is in your current room${isPlayerFollowing ? ' (they are actively FOLLOWING you)' : ''} and just performed this action: "${state.playerLastActionText || 'None'}"` 
        : (visiblePlayerLoc !== "Unknown" ? `The player is adjacent in the ${visiblePlayerLoc}.` : "The player is not in your room and their whereabouts are unknown.");

    // Deduce last known locations of other actors from memories
    const lastKnownLocations = {};
    if (actor.memories) {
        // Sort memories chronologically to find the latest travel events for each actor
        const travelMemories = [...actor.memories]
            .filter(m => m.eventDesc.includes("traveled to"))
            .sort((a, b) => a.turn - b.turn);
        
        travelMemories.forEach(m => {
            // Memory desc format: "Bob traveled to the Town Square."
            const match = m.eventDesc.match(/^(.+?) traveled to the (.+?)\.$/);
            if (match) {
                const actorName = match[1];
                const roomName = match[2];
                // Resolve roomName back to roomKey
                for (let key in ROOMS) {
                    if (ROOMS[key].name === roomName) {
                        lastKnownLocations[actorName] = ROOMS[key].name;
                        break;
                    }
                }
            }
        });
    }

    // Determine other actor visibility (Perception >= Target Stealth)
    const otherActorsStatus = Object.values(state.actors)
        .filter(a => a.id !== actorId)
        .map(a => {
            const isHere = a.location === actor.location;
            const isAdj = neighbors.includes(a.location);
            const targetStealth = a.skills ? a.skills.stealth : 3;
            
            let visibleLoc = "Unknown";
            if (isHere) {
                visibleLoc = ROOMS[a.location].name;
            } else if (isAdj && actorPerception >= targetStealth) {
                visibleLoc = ROOMS[a.location].name;
            } else if (lastKnownLocations[a.name] && actorPerception >= Math.max(1, targetStealth - 2)) {
                visibleLoc = `${lastKnownLocations[a.name]} (last seen traveling here)`;
            }
            
            return `- ${a.name}: ${visibleLoc !== "Unknown" ? `at the ${visibleLoc}` : "Location Unknown"}`;
        })
        .join('\n');

    const prompt = `Current world state:
Player location: ${visiblePlayerLoc}
${playerText}

Other actors in the world:
${otherActorsStatus}

Adjacent exits you can move to: ${neighbors.join(', ')}.

Decide your action.`;

    const res = await callOllama(prompt, systemPrompt);
    
    if (res.thought) {
        logGame("npc", `<i>${actor.name}'s Thought: "${res.thought}"</i>`);
    }

    // Process Theft actions generically
    if (res.steal_attempt && res.steal_attempt !== "none") {
        const targetId = res.steal_attempt;
        if (targetId === "player" && actor.location === state.playerLocation) {
            const hasScroll = state.playerInventory && state.playerInventory.includes("Secret Scroll");
            const hasMessage = state.playerInventory && state.playerInventory.includes("Deciphered Message");
            
            if (hasScroll || hasMessage) {
                const stolenItem = hasScroll ? "Secret Scroll" : "Deciphered Message";
                state.playerInventory = state.playerInventory.filter(i => i !== stolenItem);
                actor.inventory.push(stolenItem);
                
                broadcastEvent(state, {
                    type: "theft",
                    description: `${actor.name} stole the ${stolenItem} from the Player.`,
                    location: actor.location,
                    importance: 10,
                    originActorId: actor.id,
                    targetActorId: "player",
                    isStealth: true,
                    playerMessage: `${actor.name} bumps into you! You check your pockets and gasp... your ${stolenItem} is gone!`
                }, logGame);
            } else {
                broadcastEvent(state, {
                    type: "theft",
                    description: `${actor.name} tried to pickpocket the Player.`,
                    location: actor.location,
                    importance: 8,
                    originActorId: actor.id,
                    targetActorId: "player",
                    isStealth: true,
                    playerMessage: `${actor.name} bumps into you! You check your pockets, but nothing was taken.`
                }, logGame);
            }
        } else if (state.actors[targetId] && actor.location === state.actors[targetId].location) {
            const targetActor = state.actors[targetId];
            if (targetActor.inventory.includes("Secret Scroll")) {
                targetActor.inventory = targetActor.inventory.filter(i => i !== "Secret Scroll");
                actor.inventory.push("Secret Scroll");
                
                broadcastEvent(state, {
                    type: "theft",
                    description: `${actor.name} stole the Secret Scroll from ${targetActor.name}.`,
                    location: actor.location,
                    importance: 10,
                    originActorId: actor.id,
                    targetActorId: targetActor.id,
                    isStealth: true,
                    playerMessage: `${actor.name} pickpockets ${targetActor.name} and steals the Secret Scroll!`
                }, logGame);
            } else {
                broadcastEvent(state, {
                    type: "theft",
                    description: `${actor.name} tried to pickpocket ${targetActor.name}.`,
                    location: actor.location,
                    importance: 7,
                    originActorId: actor.id,
                    targetActorId: targetActor.id,
                    isStealth: true,
                    playerMessage: `${actor.name} attempts to pick ${targetActor.name}'s pockets, but finds nothing.`
                }, logGame);
            }
        }
    }

    // Process Plan Formulation
    let rawSteps = res.plan_steps || [];
    if (typeof rawSteps === "string") {
        try {
            rawSteps = JSON.parse(rawSteps);
        } catch(e) {
            rawSteps = [rawSteps];
        }
    }

    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
        rawSteps = ["stay"];
    }

    // Engine-side Safety Net: If player is following the NPC, force them to travel instead of staying
    if (state.followingActorId === actorId && (rawSteps.includes("stay") || rawSteps.length === 0)) {
        if (actorId === "bob") {
            const playerHasMessage = state.playerInventory && state.playerInventory.includes("Deciphered Message");
            if (playerHasMessage) {
                rawSteps = ["go_keep"];
            } else {
                rawSteps = ["go_alchemist"];
            }
        } else if (actorId === "guard" || actorId.includes("guard")) {
            rawSteps = ["go_courtyard"];
        } else if (actorId === "sly") {
            rawSteps = ["go_keep"];
        }
    }

    // Validate path connectivity
    let current = actor.location;
    let isPathValid = true;
    for (let step of rawSteps) {
        if (typeof step !== "string") {
            isPathValid = false;
            break;
        }
        if (step.startsWith("go_")) {
            let dest = step.split("_")[1];
            let nextNeighbors = getNeighbors(current, state.blockedConnections);
            if (nextNeighbors.includes(dest)) {
                current = dest;
            } else {
                isPathValid = false;
                break;
            }
        } else if (step === "stay") {
            // Stay is always valid
        } else {
            isPathValid = false;
            break;
        }
    }

    let finalPlan = [];
    if (isPathValid) {
        finalPlan = rawSteps;
    } else {
        // Path was invalid (non-adjacent jumps). Perform engine-side path healing.
        const lastStep = rawSteps[rawSteps.length - 1];
        let endTarget = actor.location;
        if (typeof lastStep === "string" && lastStep.startsWith("go_")) {
            endTarget = lastStep.split("_")[1];
        }
        
        // Ensure endTarget is valid room key
        if (!ROOMS[endTarget]) {
            endTarget = actor.location;
        }

        const path = findPath(actor.location, endTarget, state.blockedConnections);
        if (path && path.length > 1) {
            finalPlan = path.slice(1).map(r => `go_${r}`);
            console.log(`[Plan Self-Healing] Corrected plan steps for ${actor.name} from ${JSON.stringify(rawSteps)} to ${JSON.stringify(finalPlan)}`);
        } else {
            finalPlan = ["stay"];
        }
    }

    // Save plan and longTermGoal
    actor.activePlan = finalPlan;
    actor.longTermGoal = res.long_term_goal || "wander";

    logGame("npc", `<i>[Plan Formulation] ${actor.name} established long-term goal: "${actor.longTermGoal}" with plan: ${actor.activePlan.join(" -> ") || "None"}</i>`);

    // Execute first step of newly formulated plan immediately
    if (actor.activePlan.length > 0) {
        const nextAction = actor.activePlan.shift();
        if (actor.activePlan.length === 0) {
            actor.longTermGoal = null;
        }

        if (nextAction.startsWith("go_")) {
            const dest = nextAction.split("_")[1];
            if (neighbors.includes(dest)) {
                actor.location = dest;
                
                if (state.followingActorId === actor.id) {
                    state.playerLocation = dest;
                    logGame("system", `You follow ${actor.name} to the ${ROOMS[dest].name}.`);
                }
                broadcastEvent(state, {
                    type: "travel",
                    description: `${actor.name} traveled to the ${ROOMS[dest].name}.`,
                    location: "global",
                    importance: 4,
                    originActorId: actor.id
                }, logGame);
                logGame("npc", `<i>[Plan Execution] ${actor.name} moves to the ${ROOMS[dest].name}. (Remaining steps: ${actor.activePlan.join(" -> ") || "None"})</i>`);
                
                // Publish actor_entered event for Pub/Sub
                publishEvent(state, {
                    topic: "actor_entered",
                    location: dest,
                    payload: { actorId: actor.id }
                }, logGame, logDirector);
            } else {
                logGame("npc", `${actor.name} wanted to go to ${dest} but got lost and stayed.`);
            }
        } else {
            logGame("npc", `<i>[Plan Execution] ${actor.name} stays at the ${ROOMS[actor.location].name}.</i>`);
        }
    } else {
        logGame("npc", `${actor.name} resides at the ${ROOMS[actor.location].name}.`);
    }
}
