import { TOOL_CALLING_PROMPT_TEMPLATE, GM_PROMPT_TEMPLATE, NPC_DIALOGUE_PROMPT_TEMPLATE } from './content.js';
import { ENGINE_CONFIG } from './config.js';
import { findPath, getNeighbors, setConnections } from './pathfinding.js';
import { callOllama, testOllamaConnection } from './ollama.js';
import { updateActor, broadcastEvent, getFormattedMemories } from './actors.js';
import { runDirector } from './director.js';
import { runWriter, typewriteText, toggleNarrator, isNarratorActive, speakText } from './writer.js';
import { runAutoPlayer, checkDecisionPoints } from './autoplayer.js';
import { loadStory, STORY_REGISTRY, restoreStoryFunctions } from './storyManager.js';

// --- WRITER LOG QUEUE ---
let currentTurnLogs = [];


// --- GAME STATE ---
let state = createInitialState();

function createInitialState() {
    const initialState = {
        turn: 1,
        playerLocation: "tavern",
        actors: {},
        blockedConnections: [],
        history: [],
        directorMode: "Passive Monitor",
        nudges: [],
        storyState: "pending",
        isLLMActive: false,
        playerLastActionText: "",
        activeConversationTarget: null,
        loreDb: [],
        activeMilestoneId: "",
        milestoneStartTurn: 1,
        playerInventory: [],
        bobToldStory: false,
        isWriting: false,
        chronicleHistory: [],
        // --- AutoPlay ---
        autoPlayEnabled: false,
        autoPlayIntervalMs: 4000,
        pendingDecision: null,
        decisionsLog: {},
        _autoPlayerConversedThisPause: false,
        _autoPlayerLastLocation: null,
        _autoConversationTarget: null,
        _autoConversationRounds: 0,
        _autoPlayTimeoutId: null,
        activeStoryId: "castle",
        storyRooms: {},
        storyConnections: [],
        storyDag: { nodes: {} }
    };
    loadStory("castle", initialState);
    return initialState;
}

// --- LOGGING ---
function logGame(type, text) {
    const output = document.getElementById("terminal-output");
    const p = document.createElement("p");
    p.className = `log-${type}`;
    
    let formattedText = text;
    if (type !== 'system') {
        formattedText = `[Turn ${state.turn}] ${text}`;
    }
    p.innerHTML = formattedText;
    
    output.appendChild(p);
    output.scrollTop = output.scrollHeight;

    // Store in historical state logs
    if (state.history) {
        state.history.push({ type, text: formattedText });
    }

    // Capture for the writer chronicle
    const isTechnicalSystemLog = type === 'system' && (
        text.includes('[Parsed Action:') || 
        text.includes('[System Fact Established:') ||
        text.includes('--- SIMULATION INITIALIZED ---') ||
        text.startsWith('Goal: ')
    );
    if (!isTechnicalSystemLog) {
        currentTurnLogs.push({ type, text });
    }
}

function logDirector(text) {
    state.nudges.unshift(`[Turn ${state.turn}] ${text}`);
    if (state.nudges.length > ENGINE_CONFIG.maxNudgesInHistory) state.nudges.pop();
    
    const container = document.getElementById("nudges-log");
    container.innerHTML = state.nudges.map(n => `<div class="nudge-entry">${n}</div>`).join('');
}

export function publishEvent(state, event, logGame, logDirector) {
    if (!state.actors) return;
    for (let actorId in state.actors) {
        const actor = state.actors[actorId];
        if (actor.subscriptions && typeof actor.subscriptions[event.topic] === 'function') {
            actor.subscriptions[event.topic](actor, event, state, logGame, logDirector, getNeighbors, findPath);
        }
    }
}

// --- DYNAMIC TOOL-CALLING PARSER LLM ---
async function runToolCallingParserLLM(playerInput) {
    const neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
    const presentActors = Object.values(state.actors).filter(a => a.location === state.playerLocation);
    
    // Construct dynamic tool definitions based on player location context
    let tools = [
        {
            name: "travel",
            description: "Move the player to an adjacent room.",
            arguments: {
                destination: {
                    type: "string",
                    description: "The room to move to.",
                    options: neighbors
                }
            }
        },
        {
            name: "look",
            description: "Look around the current room to inspect exits and present characters."
        },
        {
            name: "wait",
            description: "Rest, pass the turn, or perform an arbitrary flavor action that doesn't change room."
        },
        {
            name: "examine",
            description: "Examine a specific item in your inventory, or a character/object present in your current room, to get a detailed description.",
            arguments: {
                target: {
                    type: "string",
                    description: "The name of the item, character, or object to examine (e.g. 'scroll', 'Bob', 'fountain')."
                }
            }
        },
        {
            name: "shout",
            description: "Shout a message loudly to catch the attention of characters or guards up to two rooms away.",
            arguments: {
                message: {
                    type: "string",
                    description: "The message you are shouting (e.g. 'Guard! Help!')"
                }
            }
        }
    ];
    
    // Dynamically add converse and follow options ONLY if NPCs are physically in the same room
    if (presentActors.length > 0) {
        tools.push({
            name: "converse",
            description: "Talk to a character in the room.",
            arguments: {
                character_id: {
                    type: "string",
                    description: "The ID of the character to speak with.",
                    options: presentActors.map(a => a.id)
                }
            }
        });
        tools.push({
            name: "follow",
            description: "Follow a character present in your current room so you automatically travel with them wherever they go.",
            arguments: {
                character_id: {
                    type: "string",
                    description: "The ID of the character to follow.",
                    options: presentActors.map(a => a.id)
                }
            }
        });
    }

    tools.push({
        name: "unfollow",
        description: "Stop following the character you are currently following."
    });

    const targetText = state.activeConversationTarget 
        ? `${state.actors[state.activeConversationTarget].name} (${state.activeConversationTarget})` 
        : "None";

    const system = TOOL_CALLING_PROMPT_TEMPLATE
        .replace("{current_room}", `${state.storyRooms[state.playerLocation].name} (${state.playerLocation})`)
        .replace("{active_conversation_target}", targetText)
        .replace("{tools_schema}", JSON.stringify(tools, null, 2))
        .replace("{player_input}", playerInput);

    const prompt = `Select tool for input: "${playerInput}"`;

    try {
        const res = await callOllama(prompt, system);
        if (res.tool_name) {
            return res;
        }
    } catch (e) {
        console.warn("Tool-calling parser failed.", e);
    }
    return { tool_name: "wait", arguments: {} }; // Fallback to wait
}

function getLocalDescription(state) {
    let desc = state.storyRooms[state.playerLocation].desc;
    
    let neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
    let exitsDesc = neighbors.map(n => state.storyRooms[n].name).join(", ");
    desc += `<br><br>Exits lead to: ${exitsDesc || "nowhere (blocked)"}.`;

    let present = Object.values(state.actors).filter(a => a.location === state.playerLocation);
    if (present.length > 0) {
        desc += `<br><br>${present.map(a => `${a.name} is standing here.`).join(' ')}`;
    }
    
    return desc;
}

// --- NPC DYNAMIC DIALOGUE GENERATOR ---
async function generateNPCDialogueLLM(actor, playerSpeech) {
    const memoriesDesc = getFormattedMemories(actor, state.turn);
    const worldLore = state.loreDb.join('\n');
    
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    let storyDialogueConstraint = "";
    if (activeMilestone && activeMilestone.dialogueConstraints && activeMilestone.dialogueConstraints[actor.id]) {
        storyDialogueConstraint = `Story Mission Constraint:\n${activeMilestone.dialogueConstraints[actor.id]}`;
    }

    const system = NPC_DIALOGUE_PROMPT_TEMPLATE
        .replace("{name}", actor.name)
        .replace("{role_desc}", actor.role)
        .replace("{location}", state.storyRooms[actor.location].name)
        .replace("{inventory}", JSON.stringify(actor.inventory))
        .replace("{memories}", memoriesDesc)
        .replace("{world_lore}", worldLore)
        .replace("{player_speech}", playerSpeech)
        .replace("{story_dialogue_constraint}", storyDialogueConstraint);

    const prompt = `Formulate in-character reply to player: "${playerSpeech}"`;

    try {
        const res = await callOllama(prompt, system);
        console.log("NPC Dialogue raw output:", res);
        
        // Capture and validate new lore assertions
        if (res.new_assertions && Array.isArray(res.new_assertions)) {
            res.new_assertions.forEach(assertion => {
                const cleanAssert = assertion.trim();
                if (cleanAssert && cleanAssert.length > 5) {
                    const isDuplicate = state.loreDb.some(l => l.toLowerCase() === cleanAssert.toLowerCase());
                    if (!isDuplicate) {
                        state.loreDb.push(cleanAssert);
                        logGame("system", `<i>[System Fact Established: "${cleanAssert}"]</i>`);
                    }
                }
            });
        }

        if (actor.id === "bob" && res.story_shared === true) {
            state.bobToldStory = true;
            logDirector("STORY PROGRESSION: Bob has shared the background story with the player.");
        }

        if (res.dialogue) {
            return res.dialogue;
        }
    } catch (e) {
        console.warn(`Failed to generate dynamic dialogue for ${actor.name}`, e);
    }
    // Heuristic fallbacks
    if (actor.id === "bob") return "Keep moving toward the gates!";
    if (actor.id === "sly") return "Watch your pockets, traveler.";
    return "I have nothing to say.";
}

// --- GAME MASTER LLM ---
async function runGameMasterLLM(playerAction) {
    const actorPresenceList = Object.values(state.actors).map(actor => {
        const isPresent = actor.location === state.playerLocation ? "Yes" : "No";
        return `- ${actor.name} is in the room: ${isPresent}`;
    }).join('\n');

    const activeNudge = state.nudges[0] || "None";
    const worldLore = state.loreDb.join('\n');
    const system = GM_PROMPT_TEMPLATE
        .replace("{world_lore}", worldLore)
        .replace("{room_name}", state.storyRooms[state.playerLocation].name)
        .replace("{room_desc}", state.storyRooms[state.playerLocation].desc)
        .replace("{actor_presence_list}", actorPresenceList)
        .replace("{nudge}", activeNudge);

    const prompt = `Action performed: "${playerAction}"`;

    try {
        const res = await callOllama(prompt, system);
        console.log("GM Parser raw output:", res);
        if (res.description) {
            logGame("system", res.description);
        } else {
            logGame("system", getLocalDescription(state));
        }
    } catch (err) {
        logGame("system", getLocalDescription(state));
    }
}

// --- FINALIZE ACTION & RUN WRITER ---
async function finalizeAction() {
    const bookPages = document.getElementById("book-pages");
    const status = document.getElementById("writer-status");
    const quill = document.getElementById("quill-icon");
    if (status) {
        status.textContent = "Scribe thinking...";
        status.classList.add("writing-mode");
    }
    if (quill) quill.classList.add("writing");

    if (bookPages) {
        try {
            if (state.isLLMActive) {
                logGame("system", "<i>[Scribe is drafting the chronicle chapter...]</i>");
            }
            const paragraph = await runWriter(state, currentTurnLogs, state.isLLMActive);
            if (state.chronicleHistory) {
                state.chronicleHistory.push(paragraph);
            }
            await typewriteText(bookPages, paragraph);
            speakText(paragraph);
        } catch (err) {
            console.error("Writer error:", err);
        }
    }
    state.isWriting = false;
    updateUI(); // Re-enables UI!

    // Auto-tick scheduler: fires after EVERY action (ticking and non-ticking alike),
    // so AutoPlay continues correctly even after converse / look / examine turns.
    // Cancel any existing pending tick first to prevent double-loop race conditions.
    if (state.autoPlayEnabled && !state.pendingDecision && (state.storyState === 'pending' || state.storyState === 'running')) {
        if (state._autoPlayTimeoutId !== null) {
            clearTimeout(state._autoPlayTimeoutId);
        }
        state._autoPlayTimeoutId = setTimeout(() => {
            state._autoPlayTimeoutId = null;
            tickGame(null);
        }, state.autoPlayIntervalMs);
    }
}

// --- GAME TICK ENGINE ---
async function tickGame(playerInput) {
    console.log("[TRACE] tickGame called with input:", playerInput, "state.storyState:", state.storyState, "state.isWriting:", state.isWriting);
    if ((state.storyState !== "pending" && state.storyState !== "running") || state.isWriting) {
        console.warn("[TRACE] tickGame exited early. Blocked by state condition.");
        return;
    }

    // --- AutoPlay: detect whether this is a human turn or an auto-tick ---
    const isAutoTick = (playerInput === null);

    // Smart-pause: converse/examine from a human always hard-pauses AutoPlay
    if (!isAutoTick && state.autoPlayEnabled) {
        const isEngagingAction = /^(converse|examine|talk|speak|say|ask|tell|hi|hello)/i.test(playerInput || '');
        if (isEngagingAction) {
            state.autoPlayEnabled = false;
            updateAutoPlayButton();
            logGame('system', '<i>[AutoPlay paused — you took control of the conversation.]</i>');
        }
        // travel/look = soft override — AutoPlay continues after this turn
    }

    // If auto-tick, generate player action from AutoPlayer
    let resolvedInput = playerInput;
    if (isAutoTick) {
        const toolCall = await runAutoPlayer(state, state.isLLMActive);
        // Synthesise a text representation so the rest of the pipeline works unchanged
        if (toolCall.tool_name === 'travel') {
            resolvedInput = `go_${toolCall.arguments.destination}`;
        } else if (toolCall.tool_name === 'converse') {
            resolvedInput = `talk to ${state.actors[toolCall.arguments.character_id]?.name || toolCall.arguments.character_id}`;
        } else if (toolCall.tool_name === 'examine') {
            resolvedInput = `examine ${toolCall.arguments.target || 'surroundings'}`;
        } else {
            resolvedInput = 'wait';
        }
        logGame('system', `<i>[AutoPlay ▶ ${resolvedInput}]</i>`);
    }

    // --- Decision Point Gate: check before executing any action ---
    const decision = checkDecisionPoints(state);
    if (decision) {
        state.pendingDecision = decision;
        renderDecisionModal(decision);
        return; // Halt tick until player chooses
    }

    // From here on, use resolvedInput everywhere playerAction was used
    const playerAction = resolvedInput;
    state.isWriting = true;
    updateUI(); // Disables UI inputs immediately to prevent concurrent actions!

    currentTurnLogs = [];

    // Log the player action
    let playerLogText = playerAction;
    if (playerAction.startsWith("go_")) {
        const dest = playerAction.split("_")[1];
        playerLogText = `go to ${state.storyRooms[dest]?.name || dest}`;
    } else if (playerAction === "wait") {
        playerLogText = "wait";
    }
    logGame("player", playerLogText);

    state.playerLastActionText = playerAction; // Save player input context for NPCs

    try {
        // Verify Ollama connection
        const isOnline = await testOllamaConnection();
        state.isLLMActive = isOnline;
        
        const badge = document.getElementById("target-state-badge");
        badge.textContent = state.isLLMActive ? "Ollama Active" : "Local Engine";
        badge.className = `stat-value ${state.isLLMActive ? 'success' : 'warning'}`;

        let toolCall = { tool_name: "wait", arguments: {} };
        let actualActionText = playerAction;

    // A. Parse natural language inputs using the Tool Calling LLM
    if (playerAction.startsWith("go_")) {
        let dest = playerAction.split("_")[1];
        toolCall = { tool_name: "travel", arguments: { destination: dest } };
    } else if (playerAction === "wait") {
        toolCall = { tool_name: "wait", arguments: {} };
    } else {
        if (state.isLLMActive) {
            logGame("system", "<i>[Consulting local LLM parser...]</i>");
            toolCall = await runToolCallingParserLLM(playerAction);
        } else {
            // Local regex checks fallback
            const input = playerAction.toLowerCase().trim();
            if (input.includes("wait") || input.includes("rest") || input.includes("sleep")) {
                toolCall = { tool_name: "wait", arguments: {} };
            } else if (input.includes("look") || input.includes("inspect")) {
                toolCall = { tool_name: "look", arguments: {} };
            } else if (input.includes("unfollow") || input.includes("stop following")) {
                toolCall = { tool_name: "unfollow", arguments: {} };
            } else if (input.startsWith("follow")) {
                const namePart = input.substring(6).trim();
                let targetId = null;
                // Dynamically resolve target from active characters
                Object.values(state.actors).forEach(a => {
                    if (namePart.includes(a.name.toLowerCase())) targetId = a.id;
                });
                
                if (targetId) {
                    toolCall = { tool_name: "follow", arguments: { character_id: targetId } };
                } else {
                    let activeNpcs = Object.values(state.actors).filter(a => a.location === state.playerLocation);
                    if (activeNpcs.length > 0) {
                        toolCall = { tool_name: "follow", arguments: { character_id: activeNpcs[0].id } };
                    } else {
                        toolCall = { tool_name: "wait", arguments: {} };
                    }
                }
            } else if (input.includes("talk") || input.includes("speak") || input.includes("say")) {
                let activeNpcs = Object.values(state.actors).filter(a => a.location === state.playerLocation);
                if (activeNpcs.length > 0) {
                    toolCall = { tool_name: "converse", arguments: { character_id: activeNpcs[0].id } };
                } else {
                    toolCall = { tool_name: "wait", arguments: {} };
                }
            } else {
                let target = null;
                Object.keys(state.storyRooms).forEach(r => { if (input.includes(r)) target = r; });
                if (target) {
                    toolCall = { tool_name: "travel", arguments: { destination: target } };
                } else {
                    toolCall = { tool_name: "wait", arguments: {} };
                }
            }
        }
    }

    // 1. Physics Layer Override: If player typed a relative exit ("leave", "exit", "go outside") 
    // and the parsed destination is invalid or equals the current room, and there is exactly ONE exit,
    // automatically correct it to that unique exit.
    if (toolCall.tool_name === "travel") {
        let dest = toolCall.arguments.destination;
        let neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
        const isRelativeLeave = /\b(leave|exit|outside|escape|out)\b/i.test(playerAction);
        
        if (isRelativeLeave && (!dest || dest === state.playerLocation || !neighbors.includes(dest))) {
            if (neighbors.length === 1) {
                toolCall.arguments.destination = neighbors[0];
            }
        }
    }

    // 2. Conversational State Override: If we are actively speaking to someone present in the room,
    // and the parsed action resulted in "wait" (due to model classification confusion on short inputs),
    // but the player typed a non-wait text, automatically force it to be a conversation with the active target.
    if (state.activeConversationTarget && toolCall.tool_name === "wait") {
        const targetActor = state.actors[state.activeConversationTarget];
        if (targetActor && targetActor.location === state.playerLocation) {
            const isWaitCommand = /\b(wait|rest|sleep|stand|sit|chill|stay|pass|idle|nothing|pause|hang)\b/i.test(playerAction);
            if (!isWaitCommand) {
                toolCall = { 
                    tool_name: "converse", 
                    arguments: { character_id: state.activeConversationTarget } 
                };
            }
        }
    }

    // Diagnostic log to see final parser results
    const parserMode = state.isLLMActive && !playerAction.startsWith("go_") && playerAction !== "wait" ? "LLM Parser" : "Local Rules";
    logGame("system", `<i>[Parsed Action: ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments)}) via ${parserMode}]</i>`);

    // B. Execute Tool Call against the Physics / Rules Engine
    if (toolCall.tool_name === "follow") {
        let targetId = toolCall.arguments.character_id;
        let actor = state.actors[targetId];
        if (actor && actor.location === state.playerLocation) {
            state.followingActorId = targetId;
            logGame("system", `You are now following ${actor.name}. Wherever they go, you will follow.`);
            actualActionText = `started following ${actor.name}`;
            
            broadcastEvent(state, {
                type: "follow",
                description: `Player started following ${actor.name}.`,
                location: state.playerLocation,
                importance: 4,
                originActorId: "player",
                targetActorId: actor.id
            }, logGame);
        } else {
            logGame("system", "There is nobody here by that name to follow.");
            await finalizeAction();
            return; // Non-ticking turn
        }
    }

    if (toolCall.tool_name === "unfollow") {
        if (state.followingActorId) {
            const name = state.actors[state.followingActorId].name;
            state.followingActorId = null;
            logGame("system", `You stop following ${name}.`);
            actualActionText = `stopped following ${name}`;
        } else {
            logGame("system", "You are not following anyone.");
        }
        await finalizeAction();
        return; // Non-ticking turn
    }

    if (toolCall.tool_name === "look") {
        if (state.isLLMActive) {
            await runGameMasterLLM("looked around the room");
        } else {
            logGame("system", state.storyRooms[state.playerLocation].desc);
        }
        await finalizeAction();
        return; // Non-ticking turn
    }

    if (toolCall.tool_name === "converse") {
        let targetId = toolCall.arguments.character_id;
        let actor = state.actors[targetId];
        if (actor && actor.location === state.playerLocation) {
            let spokenReply = "";
            if (state.isLLMActive) {
                spokenReply = await generateNPCDialogueLLM(actor, playerAction);
            } else {
                spokenReply = actor.fallbackReply || "I have nothing to say.";
            }

            logGame("system", `<b>${actor.name} says:</b> "${spokenReply}"`);
            state.activeConversationTarget = targetId; // Set active target!

            // Broadcast dialogue event (Importance 6)
            broadcastEvent(state, {
                type: "dialogue",
                description: `Player said: "${playerAction}". ${actor.name} replied: "${spokenReply}"`,
                location: state.playerLocation,
                importance: 6,
                originActorId: "player",
                targetActorId: actor.id
            }, logGame);
        } else {
            logGame("system", "There is nobody here by that name.");
        }
        await finalizeAction();
        return; // Non-ticking turn
    }

    if (toolCall.tool_name === "examine") {
        let target = toolCall.arguments.target;
        if (!target) {
            logGame("system", "Please specify what you would like to examine.");
            await finalizeAction();
            return;
        }

        logGame("system", `<i>You examine the ${target}...</i>`);
        actualActionText = `examined ${target}`;
        
        let desc = "";
        if (state.isLLMActive) {
            try {
                const worldLore = state.loreDb.join('\n');
                const prompt = `Describe the '${target}' present in the current room (${state.storyRooms[state.playerLocation].name}) or in the player's inventory. Use the World Lore facts to make the description rich and consistent with established canon. Use 2-3 descriptive sentences.`;
                const systemPrompt = `You are the Game Master with full world knowledge.
Established World Lore:
${worldLore}

Current Room: ${state.storyRooms[state.playerLocation].name}
Player Inventory: ${JSON.stringify(state.playerInventory)}
Present characters: ${Object.values(state.actors).filter(a => a.location === state.playerLocation).map(a => a.name).join(', ')}

Describe the specified target. Output EXACTLY this JSON: { "description": "Your detailed description here" }`;
                
                const res = await callOllama(prompt, systemPrompt);
                if (res && res.description) {
                    desc = res.description;
                }
            } catch (e) {
                console.warn("Failed to generate dynamic examine description", e);
            }
        }
        
        if (!desc) {
            // Fallback map
            const targetLower = target.toLowerCase().trim();
            if (targetLower === "scroll" || targetLower === "secret scroll") {
                desc = "The Secret Scroll is sealed with royal wax, its parchment containing faint, invisible runes that require a revealing potion to decipher.";
            } else if (targetLower === "message" || targetLower === "deciphered message") {
                desc = "The deciphered message clearly warns of a surprise midnight attack on the castle keep.";
            } else if (targetLower === "bob") {
                desc = "Bob the royal messenger looks tired but relieved to have delivered his message safely.";
            } else if (targetLower === "sly") {
                desc = "Sly the Thief stands alert, watching the shadows with a calculating gaze.";
            } else if (targetLower === "guard" || targetLower === "castle guard") {
                desc = "The Castle Guard stands tall in blue-plated steel armor, patrolling the grounds.";
            } else if (targetLower === "fountain") {
                desc = "A grand stone fountain with clear water splashing into a wide basin.";
            } else {
                desc = `You look closely at the ${target}, but see nothing out of the ordinary.`;
            }
        }
        
        logGame("system", desc);
        await finalizeAction();
        return; // Non-ticking turn
    }

    if (toolCall.tool_name === "shout") {
        let msg = toolCall.arguments.message;
        logGame("system", `You shout loudly: "${msg}"`);
        actualActionText = `shout: "${msg}"`;
        
        publishEvent(state, {
            topic: "shout",
            location: state.playerLocation,
            payload: { message: msg }
        }, logGame, logDirector);
    }

    // Ticking actions (Movement or Wait)
    if (toolCall.tool_name === "travel") {
        let dest = toolCall.arguments.destination;
        let neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
        
        if (state.playerLocation === dest) {
            logGame("system", `You look around; you are already at the ${state.storyRooms[dest].name}.`);
            await finalizeAction();
            return;
        } else if (neighbors.includes(dest)) {
            if (state.followingActorId) {
                const name = state.actors[state.followingActorId].name;
                state.followingActorId = null;
                logGame("system", `You stop following ${name} as you go elsewhere.`);
            }
            const oldLoc = state.playerLocation;
            state.playerLocation = dest;
            actualActionText = `travel to ${state.storyRooms[dest].name}`;
            state.activeConversationTarget = null; // Reset target on player movement

            // Broadcast travel event (Importance 4)
            broadcastEvent(state, {
                type: "travel",
                description: `Player traveled to the ${state.storyRooms[dest].name}.`,
                location: "global",
                importance: 4,
                originActorId: "player"
            }, logGame);

            // Publish actor_entered event for Pub/Sub
            publishEvent(state, {
                topic: "actor_entered",
                location: dest,
                payload: { actorId: "player" }
            }, logGame, logDirector);
        } else {
            let directConnection = state.storyConnections.some(conn => 
                (conn.from === state.playerLocation && conn.to === dest) ||
                (conn.to === state.playerLocation && conn.from === dest)
            );
            if (directConnection) {
                logGame("system", `You attempt to head to the ${state.storyRooms[dest].name}, but that path is currently blocked.`);
            } else {
                logGame("system", `You can't get to the ${state.storyRooms[dest].name} directly from here.`);
            }
            await finalizeAction();
            return;
        }
    } else {
        actualActionText = `waited in the ${state.storyRooms[state.playerLocation].name}`;

        // Broadcast wait event (Importance 2)
        broadcastEvent(state, {
            type: "wait",
            description: `Player waited in the ${state.storyRooms[state.playerLocation].name}.`,
            location: state.playerLocation,
            importance: 2,
            originActorId: "player"
        }, logGame);
    }

    // 2. Run Director (using resolved state)
    await runDirector(state, actualActionText, logGame, logDirector, state.isLLMActive);

    // 3. Update NPCs
    for (let actorId of Object.keys(state.actors)) {
        await updateActor(actorId, state, logGame, logDirector, state.isLLMActive);
    }

    // Reset active conversation target if the target actor has moved to a different room
    if (state.activeConversationTarget) {
        const targetActor = state.actors[state.activeConversationTarget];
        if (!targetActor || targetActor.location !== state.playerLocation) {
            state.activeConversationTarget = null;
        }
    }

    // Global post-tick following sync safety net (handles teleports/heuristics/mutations)
    if (state.followingActorId) {
        const followedActor = state.actors[state.followingActorId];
        if (followedActor && state.playerLocation !== followedActor.location) {
            const dest = followedActor.location;
            state.playerLocation = dest;
            logGame("system", `<i>You follow ${followedActor.name} to the ${state.storyRooms[dest].name}.</i>`);
        }
    }

    // 4. Run Game Master Narrative (describes the finalized post-tick state)
    if (state.isLLMActive) {
        await runGameMasterLLM(actualActionText);
    } else {
        logGame("system", getLocalDescription(state));
    }

    // 5. Assert Narrative Convergence Goal (defined in active story config)
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    const convergenceCheck = activeMilestone ? activeMilestone.convergenceCheck(state) : null;
    
    if (convergenceCheck) {
        if (convergenceCheck.status === "completed") {
            // Voice convergence with actor speech if available
            if (convergenceCheck.actorSpeechId) {
                const actorId = convergenceCheck.actorSpeechId;
                const actor = state.actors[actorId];
                if (actor) {
                    let spoken = convergenceCheck.fallbackSpeech;
                    if (state.isLLMActive) {
                        try {
                            const itemName = (activeMilestone.pressureConfig && activeMilestone.pressureConfig.keyItems && activeMilestone.pressureConfig.keyItems[0]) || "the item";
                            let prompt = "";
                            let systemPrompt = "";
                            
                            if (actor.id === "bob") {
                                if (!state.bobToldStory) {
                                    prompt = `Formulate a short spoken dialogue (1-2 sentences) in-character where you (${actor.name}) hand over the ${itemName} to the Player at the Castle Gates. You MUST explain the background story: that the scroll warns of a surprise midnight attack on the Castle Keep by rebel forces, and they must take it to the Alchemist Shop to brew a revealing potion. Do NOT mention that they 'requested' or 'asked' for it.`;
                                    systemPrompt = `You are ${actor.name}, the ${actor.role}. You are at the Castle Gates with the player. Hand them the ${itemName} and explain that it contains plans of a surprise midnight attack on the Keep by rebel forces, and they must take it to the Alchemist to brew a revealing potion. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`;
                                } else {
                                    prompt = `Formulate a short spoken dialogue (1-2 sentences) in-character where you (${actor.name}) hand over the ${itemName} to the Player for safekeeping, reminding them to take it to the Alchemist Shop. Mention that you've reached the Castle Gates. Do NOT mention that they 'requested' or 'asked' for it.`;
                                    systemPrompt = `You are ${actor.name}, the ${actor.role}. You are at the Castle Gates with the player and are handing them the ${itemName} for safekeeping. Remind them to take it to the Alchemist. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`;
                                }
                                state.bobToldStory = true; // Mark as told upon handoff
                            } else {
                                prompt = `Formulate a short spoken dialogue (1-2 sentences) in-character where you (${actor.name}) hand over the ${itemName} to the Player. Mention that you've reached the Castle Gates.`;
                                systemPrompt = `You are ${actor.name}, the ${actor.role}. You are at the Castle Gates with the player and are handing them the ${itemName}. Output EXACTLY this JSON: { "dialogue": "Your spoken dialogue here" }`;
                            }
                            const res = await callOllama(prompt, systemPrompt);
                            if (res && res.dialogue) {
                                spoken = res.dialogue;
                            }
                        } catch (e) {
                            console.warn("Failed to generate dynamic handoff speech.", e);
                        }
                    }
                    logGame("npc", `<b>${actor.name} says:</b> "${spoken}"`);
                    broadcastEvent(state, {
                        type: "dialogue",
                        description: `${actor.name} said: "${spoken}"`,
                        location: actor.location,
                        importance: 6,
                        originActorId: actor.id,
                        targetActorId: "player"
                    }, logGame);
                }
            }

            // Trigger onComplete hook if it exists
            if (activeMilestone.onComplete) {
                activeMilestone.onComplete(state, logGame);
            }

            if (activeMilestone.nextNodes && activeMilestone.nextNodes.length > 0) {
                // Transition to the next milestone in the DAG
                state.activeMilestoneId = activeMilestone.nextNodes[0];
                state.milestoneStartTurn = state.turn;
                const nextMilestone = state.storyDag.nodes[state.activeMilestoneId];
                logGame("event", convergenceCheck.msg);
                logGame("director-announce", `<b>STORY ADVANCEMENT:</b> New Objective: ${nextMilestone.description}`);
                logDirector(`STORY ADVANCEMENT: Active objective is now: ${nextMilestone.title}`);
            } else {
                state.storyState = "completed";
                document.getElementById("target-state-badge").textContent = "Completed";
                document.getElementById("target-state-badge").className = "stat-value success";
                logGame("event", convergenceCheck.msg);
                logGame("event", "<b>STORY COMPLETE:</b> You have successfully completed the chapter!");
                logDirector("SUCCESS: Story DAG fully traversed.");
            }
        } else if (convergenceCheck.status === "pending") {
            // Voice the pending actor speech warning the player about Sly
            if (convergenceCheck.actorSpeechId) {
                const actorId = convergenceCheck.actorSpeechId;
                const actor = state.actors[actorId];
                if (actor) {
                    let spoken = convergenceCheck.fallbackSpeech;
                    if (state.isLLMActive) {
                        try {
                            const itemName = (activeMilestone.pressureConfig && activeMilestone.pressureConfig.keyItems && activeMilestone.pressureConfig.keyItems[0]) || "the item";
                            const prompt = `Formulate a short spoken dialogue (1-2 sentences) in-character where you (${actor.name}) refuse to hand over the ${itemName} because Sly the Thief is present in the room. Ask the player to shout for a guard.`;
                            const systemPrompt = `You are ${actor.name}, the ${actor.role}. You are at the Castle Gates with the player but Sly the Thief is also here. Output EXACTLY this JSON: { "dialogue": "Your spoken warning dialogue here" }`;
                            const res = await callOllama(prompt, systemPrompt);
                            if (res && res.dialogue) {
                                spoken = res.dialogue;
                            }
                        } catch (e) {
                            console.warn("Failed to generate dynamic handoff warning speech.", e);
                        }
                    }
                    logGame("npc", `<b>${actor.name} says:</b> "${spoken}"`);
                    broadcastEvent(state, {
                        type: "dialogue",
                        description: `${actor.name} said: "${spoken}"`,
                        location: actor.location,
                        importance: 6,
                        originActorId: actor.id,
                        targetActorId: "player"
                    }, logGame);
                    
                    // Spontaneously publish shout event for Bob calling the guard!
                    publishEvent(state, {
                        topic: "shout",
                        location: actor.location,
                        payload: { message: "Guard! Help! Sly the Thief is here!" }
                    }, logGame, logDirector);
                }
            }
        }
    } 
    // Max turns for current milestone exceeded
    else {
        const elapsedTurns = state.turn - state.milestoneStartTurn;
        if (elapsedTurns >= activeMilestone.maxTurns) {
            state.storyState = "failed";
            document.getElementById("target-state-badge").textContent = "Failed";
            document.getElementById("target-state-badge").className = "stat-value error";
            logGame("director-announce", `<b>STORY FAILED:</b> Milestone '${activeMilestone.title}' failed. Turn limit (${activeMilestone.maxTurns} turns) exceeded.`);
            logDirector(`FAILED: Milestone time limit exceeded.`);
        }
    }

    state.turn++;
    document.getElementById("turn-counter").textContent = state.turn;

    // Calculate dynamic stats
    if (activeMilestone && activeMilestone.pressureConfig && activeMilestone.pressureConfig.targetRoom) {
        const targetRoom = activeMilestone.pressureConfig.targetRoom;
        let path = findPath(state.playerLocation, targetRoom, state.blockedConnections);
        let distance = path ? path.length - 1 : ENGINE_CONFIG.actorDistanceAlert;
        document.getElementById("actor-distance").textContent = `${distance} Room(s) to ${state.storyRooms[targetRoom].name}`;
    } else {
        document.getElementById("actor-distance").textContent = "N/A";
    }

    updateUI();

    // Generate and typewrite the chronicle paragraph
    await finalizeAction();


    } catch (err) {
        console.error("Error during tickGame execution:", err);
        state.isWriting = false;
        updateUI(); // Unlock UI on error!
    }
}

// --- UI SYNC ---
function initMap() {
    const connectionsContainer = document.getElementById("map-connections");
    connectionsContainer.innerHTML = "";

    state.storyConnections.forEach(conn => {
        const fromNode = state.storyRooms[conn.from];
        const toNode = state.storyRooms[conn.to];

        const line = document.createElement("div");
        line.className = "connection-line";
        line.id = `line-${conn.from}-${conn.to}`;

        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        line.style.width = `${distance}%`;
        line.style.left = `${fromNode.x}%`;
        line.style.top = `${fromNode.y}%`;
        line.style.transform = `rotate(${angle}deg)`;

        connectionsContainer.appendChild(line);
    });

    const nodesContainer = document.getElementById("map-nodes");
    nodesContainer.innerHTML = "";

    for (let key in state.storyRooms) {
        const room = state.storyRooms[key];
        const node = document.createElement("div");
        node.className = "room-node";
        node.id = `node-${key}`;
        node.style.left = `${room.x}%`;
        node.style.top = `${room.y}%`;

        node.onclick = () => {
            if (getNeighbors(state.playerLocation, state.blockedConnections).includes(key)) {
                tickGame(`go_${key}`);
            }
        };

        const name = document.createElement("span");
        name.className = "room-name";
        name.textContent = room.name;
        node.appendChild(name);

        const actorDots = document.createElement("div");
        actorDots.className = "actor-dots";
        actorDots.id = `dots-${key}`;
        node.appendChild(actorDots);

        nodesContainer.appendChild(node);
    }
}

// --- LOCAL STORAGE PERSISTENCE ---
function saveState() {
    try {
        localStorage.setItem("simulation_state", JSON.stringify(state));
    } catch (err) {
        console.error("Failed to save state to localStorage:", err);
    }
}

function restoreActorFunctions(actors) {
    const config = STORY_REGISTRY[state.activeStoryId] || STORY_REGISTRY.castle;
    for (let id in actors) {
        if (config.actors[id]) {
            actors[id].heuristics = config.actors[id].heuristics;
            actors[id].subscriptions = config.actors[id].subscriptions;
        }
    }
}

function updateUI() {
    for (let key in state.storyRooms) {
        const node = document.getElementById(`node-${key}`);
        if (node) {
            node.className = "room-node";
            if (state.playerLocation === key) {
                node.classList.add("active-room");
            }
        }
    }

    // Sync Director Dashboard metrics
    if (document.getElementById("director-mode")) {
        document.getElementById("director-mode").textContent = state.directorMode;
    }

    // Sync active milestone details
    const activeMilestone = state.storyDag.nodes[state.activeMilestoneId];
    if (activeMilestone && document.getElementById("active-milestone-title")) {
        document.getElementById("active-milestone-title").textContent = activeMilestone.title;
        document.getElementById("active-milestone-desc").textContent = activeMilestone.description;
    }

    // Sync player inventory
    if (document.getElementById("player-inventory")) {
        const inv = state.playerInventory && state.playerInventory.length > 0 ? state.playerInventory.join(", ") : "None";
        document.getElementById("player-inventory").textContent = inv;
    }

    // Sync milestone list
    if (document.getElementById("story-milestones-list")) {
        const completedMilestones = [];
        let curr = state.storyDag.startNodeId;
        while (curr && curr !== state.activeMilestoneId) {
            completedMilestones.push(curr);
            const node = state.storyDag.nodes[curr];
            if (!node) break;
            curr = node.nextNodes && node.nextNodes[0];
        }

        document.getElementById("story-milestones-list").innerHTML = Object.values(state.storyDag.nodes).map(m => {
            let statusClass = "locked";
            let statusLabel = "Locked";
            if (state.activeMilestoneId === m.id) {
                statusClass = "active";
                statusLabel = "Active";
            } else if (completedMilestones.includes(m.id) || state.storyState === "completed") {
                statusClass = "completed";
                statusLabel = "Completed";
            }
            return `
                <div class="milestone-item ${statusClass}">
                    <span class="milestone-dot"></span>
                    <div class="milestone-info">
                        <span class="milestone-title">${m.title}</span>
                        <span class="milestone-status">${statusLabel}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Sync dynamic NPC utilities
    const utilitiesContainer = document.getElementById("actor-utilities-list");
    if (utilitiesContainer) {
        utilitiesContainer.innerHTML = Object.values(state.actors).map(actor => {
            const desiresText = Object.entries(actor.desires).map(([key, val]) => {
                const pct = Math.round((val / 200) * 100);
                return `
                    <div class="utility-row">
                        <span class="utility-label">${key}:</span>
                        <span class="utility-val">${pct}%</span>
                    </div>
                `;
            }).join('');
            const invText = actor.inventory && actor.inventory.length > 0 ? actor.inventory.join(', ') : 'Empty';
            const objectiveText = actor.criticalObjective
                ? `<div class="actor-utility-objective" style="font-size: 0.72rem; color: #a7f3d0; margin-top: 6px; font-style: italic; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 4px; line-height: 1.2;"><strong>Objective:</strong> ${actor.criticalObjective}</div>`
                : '';
            return `
                <div class="actor-utility-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span class="actor-utility-name" style="color: ${actor.color}; text-shadow: 0 0 4px ${actor.color}44; margin-bottom: 0;">${actor.name}</span>
                        <span class="actor-utility-inventory" style="font-size: 0.65rem; color: #fbbf24; font-family: 'Fira Code', monospace;">[${invText}]</span>
                    </div>
                    <div class="utility-rows-container">${desiresText}</div>
                    ${objectiveText}
                </div>
            `;
        }).join('');
    }

    state.storyConnections.forEach(conn => {
        const line = document.getElementById(`line-${conn.from}-${conn.to}`);
        if (line) {
            const isBlocked = state.blockedConnections.includes(`${conn.from}-${conn.to}`) || 
                              state.blockedConnections.includes(`${conn.to}-${conn.from}`);
            if (isBlocked) {
                line.classList.add("blocked");
            } else {
                line.classList.remove("blocked");
            }
        }
    });

    // Render dots dynamically for ALL actors configured in state
    for (let key in state.storyRooms) {
        const dotsContainer = document.getElementById(`dots-${key}`);
        if (dotsContainer) {
            dotsContainer.innerHTML = "";

            if (state.playerLocation === key) {
                const playerDot = document.createElement("div");
                playerDot.className = "dot player-dot";
                playerDot.setAttribute("data-tooltip", "You");
                dotsContainer.appendChild(playerDot);
            }

            Object.values(state.actors).forEach(actor => {
                if (actor.location === key) {
                    const npcDot = document.createElement("div");
                    npcDot.className = "dot";
                    npcDot.style.backgroundColor = actor.color;
                    npcDot.style.boxShadow = `0 0 8px ${actor.color}`;
                    const invText = actor.inventory && actor.inventory.length > 0 ? ` [Inv: ${actor.inventory.join(', ')}]` : '';
                    npcDot.setAttribute("data-tooltip", `${actor.name} (${actor.role})${invText}`);
                    dotsContainer.appendChild(npcDot);
                }
            });
        }
    }

    const buttonsContainer = document.getElementById("action-buttons");
    buttonsContainer.innerHTML = "";

    const inputEl = document.getElementById("command-input");
    if (inputEl) {
        inputEl.disabled = state.isWriting;
    }

    if (state.storyState === "pending" || state.storyState === "running") {
        let neighbors = getNeighbors(state.playerLocation, state.blockedConnections);
        neighbors.forEach(neighbor => {
            const btn = document.createElement("button");
            btn.className = "btn";
            btn.textContent = `Go to ${state.storyRooms[neighbor].name}`;
            btn.disabled = state.isWriting;
            btn.onclick = () => tickGame(`go_${neighbor}`);
            buttonsContainer.appendChild(btn);
        });

        const waitBtn = document.createElement("button");
        waitBtn.className = "btn";
        waitBtn.textContent = "Wait / Rest (Pass Turn)";
        waitBtn.disabled = state.isWriting;
        waitBtn.onclick = () => tickGame("wait");
        buttonsContainer.appendChild(waitBtn);
    } else {
        const resetBtn = document.createElement("button");
        resetBtn.className = "btn";
        resetBtn.textContent = "Restart Simulation";
        resetBtn.disabled = state.isWriting;
        resetBtn.onclick = () => restartGame();
        buttonsContainer.appendChild(resetBtn);
    }
    saveState();
}

async function restartGame() {
    try {
        localStorage.removeItem("simulation_state");
    } catch (err) {
        console.warn("Failed to clear localStorage:", err);
    }
    const selectedStoryId = document.getElementById("story-select")?.value || state.activeStoryId || "castle";
    const oldPlayerName = state.playerName;
    state = createInitialState();
    state.playerName = oldPlayerName; // Preserve name across resets/story swaps!
    loadStory(selectedStoryId, state);
    state.isWriting = true; // Block inputs during intro writing!

    try {
        document.getElementById("turn-counter").textContent = state.turn;
        document.getElementById("target-state-badge").textContent = "Pending";
        document.getElementById("target-state-badge").className = "stat-value warning";
        document.getElementById("terminal-output").innerHTML = "";
        document.getElementById("nudges-log").innerHTML = "";

        // Clear the book panel pages
        const bookPages = document.getElementById("book-pages");
        if (bookPages) {
            bookPages.innerHTML = '<p class="book-placeholder">The pages are blank. Begin the journey to write the chronicle...</p>';
        }

        currentTurnLogs = [];

        logGame("system", "<b>--- SIMULATION INITIALIZED ---</b>");
        logGame("system", `Goal: ${state.storyDag.nodes[state.activeMilestoneId].description}`);
        logGame("system", state.storyRooms[state.playerLocation].desc);
        
        initMap();
        updateUI();
        updateAutoPlayButton();
        
        try {
            await testConnection();
        } catch (connErr) {
            console.warn("Failed to test connection:", connErr);
        }

        // Scribe write opening chronicle paragraph
        const status = document.getElementById("writer-status");
        const quill = document.getElementById("quill-icon");
        if (status) {
            status.textContent = "Scribe thinking...";
            status.classList.add("writing-mode");
        }
        if (quill) quill.classList.add("writing");

        if (bookPages) {
            runWriter(state, currentTurnLogs, state.isLLMActive).then(paragraph => {
                if (state.chronicleHistory) {
                    state.chronicleHistory.push(paragraph);
                }
                typewriteText(bookPages, paragraph).then(() => {
                    logGame("event", `<b>Narrative:</b> <i>${paragraph}</i>`);
                    speakText(paragraph);
                    state.isWriting = false;
                    updateUI(); // Unlock controls!
                });
            }).catch(err => {
                console.error("Intro writer error:", err);
                state.isWriting = false;
                updateUI();
            });
        } else {
            state.isWriting = false;
            updateUI();
        }
    } catch (initErr) {
        console.error("Critical error during restartGame initialization:", initErr);
        state.isWriting = false;
        updateUI();
    }
}

async function testConnection() {
    const isOnline = await testOllamaConnection();
    state.isLLMActive = isOnline;
    const badge = document.getElementById("target-state-badge");
    badge.textContent = state.isLLMActive ? "Ollama Active" : "Local Engine";
    badge.className = `stat-value ${state.isLLMActive ? 'success' : 'warning'}`;
}

// --- NATURAL LANGUAGE INTENT PARSER ---
function handleCommandInput(event) {
    event.preventDefault();
    console.log("[TRACE] Form submit event caught.");
    const inputEl = document.getElementById("command-input");
    const rawInput = inputEl.value.trim();
    console.log("[TRACE] Raw command input:", rawInput);
    if (!rawInput) {
        console.log("[TRACE] Empty command. Exiting submit handler.");
        return;
    }
    
    inputEl.value = "";

    console.log("[TRACE] current state.storyState:", state.storyState);
    if (state.storyState !== "pending" && state.storyState !== "running") {
        console.warn("[TRACE] Command blocked: story state indicates simulation has ended.");
        logGame("system", "The simulation has ended. Click 'Restart Simulation' to try again.");
        return;
    }

    console.log("[TRACE] Forwarding command to tickGame...");
    tickGame(rawInput);
}

// Collapsible panels init (Accordion behavior)
function initCollapsiblePanels() {
    const panelsConfig = [
        { panelClass: 'map-panel' },
        { panelClass: 'director-panel' },
        { panelClass: 'book-panel' }
    ];

    panelsConfig.forEach(conf => {
        const panelEl = document.querySelector(`.${conf.panelClass}`);
        const headerEl = panelEl ? panelEl.querySelector('.panel-header') : null;
        if (panelEl && headerEl) {
            const titleEl = headerEl.querySelector('h2');
            if (titleEl) {
                const arrow = document.createElement('span');
                arrow.className = 'fold-arrow';
                arrow.textContent = '▼';
                titleEl.appendChild(arrow);
            }

            headerEl.addEventListener('click', () => {
                const wasCollapsed = panelEl.classList.contains('collapsed');
                
                // Collapse all panels first
                panelsConfig.forEach(c => {
                    const p = document.querySelector(`.${c.panelClass}`);
                    if (p) p.classList.add('collapsed');
                });

                // If this clicked panel was collapsed, expand it
                if (wasCollapsed) {
                    panelEl.classList.remove('collapsed');
                }
            });
        }
    });
}

// Narrator voice control init
function initNarratorToggle() {
    const btn = document.getElementById("tts-toggle");
    if (btn) {
        const active = isNarratorActive();
        if (active) {
            btn.classList.add("active");
            btn.textContent = "🔊";
        } else {
            btn.classList.remove("active");
            btn.textContent = "🔇";
        }

        btn.addEventListener("click", () => {
            const nowActive = !isNarratorActive();
            toggleNarrator(nowActive);
            
            if (nowActive) {
                btn.classList.add("active");
                btn.textContent = "🔊";
                // Narrate last written paragraph as feedback
                if (state.chronicleHistory && state.chronicleHistory.length > 0) {
                    speakText(state.chronicleHistory[state.chronicleHistory.length - 1]);
                }
            } else {
                btn.classList.remove("active");
                btn.textContent = "🔇";
            }
        });
    }
}

// Start
window.onload = () => {
    const saved = localStorage.getItem("simulation_state");
    if (saved) {
        try {
            state = JSON.parse(saved);
            state.isWriting = false; // Always unlock inputs on refresh!
            setConnections(state.storyConnections);
            
            // Migrate old serialized prompt templates in active localStorage
            if (state.actors && state.actors.bob && state.actors.bob.promptTemplate) {
                if (state.actors.bob.promptTemplate.includes("stay in the room and converse. Do not walk away immediately.")) {
                    state.actors.bob.promptTemplate = state.actors.bob.promptTemplate.replace(
                        "stay in the room and converse. Do not walk away immediately.",
                        "stay in the room and converse, UNLESS they are actively FOLLOWING you or telling you to lead. If they are following you, you must execute a travel plan toward your target destination immediately. Do NOT stay in the room."
                    );
                }
            }
            if (state.actors && state.actors.sly && state.actors.sly.promptTemplate) {
                if (state.actors.sly.promptTemplate.includes("stay in the room and converse. Do not walk away immediately.")) {
                    state.actors.sly.promptTemplate = state.actors.sly.promptTemplate.replace(
                        "stay in the room and converse. Do not walk away immediately.",
                        "stay in the room and converse, UNLESS they are actively FOLLOWING you or telling you to lead. If they are following you, you must execute a travel plan toward your target destination immediately. Do NOT stay in the room."
                    );
                }
            }
            
            restoreStoryFunctions(state);
            
            // Rebuild terminal DOM history
            const output = document.getElementById("terminal-output");
            if (output) {
                output.innerHTML = "";
                state.history.forEach(log => {
                    const p = document.createElement("p");
                    p.className = `log-${log.type}`;
                    p.innerHTML = log.text;
                    output.appendChild(p);
                });
                output.scrollTop = output.scrollHeight;
            }

            // Rebuild chronicle DOM history
            const bookPages = document.getElementById("book-pages");
            if (bookPages) {
                bookPages.innerHTML = "";
                state.chronicleHistory.forEach((para, idx) => {
                    const p = document.createElement("p");
                    p.className = "book-paragraph animate-fade-in";
                    if (idx === 0) {
                        const firstLetter = para.charAt(0);
                        const restText = para.slice(1);
                        p.innerHTML = `<span class="drop-cap">${firstLetter}</span>${restText}`;
                    } else {
                        p.textContent = para;
                    }
                    bookPages.appendChild(p);
                });
                const bookContent = document.getElementById("book-content");
                if (bookContent) {
                    bookContent.scrollTop = bookContent.scrollHeight;
                }
            }

            // Sync Nudges DOM history
            const nudgesContainer = document.getElementById("nudges-log");
            if (nudgesContainer) {
                nudgesContainer.innerHTML = state.nudges.map(n => `<div class="nudge-entry">${n}</div>`).join('');
            }

            const storySelect = document.getElementById("story-select");
            if (storySelect) {
                storySelect.value = state.activeStoryId || "castle";
            }

            document.getElementById("turn-counter").textContent = state.turn;
            initMap();
            updateUI();
            updateAutoPlayButton();
            testConnection();
        } catch (err) {
            console.error("Failed to parse saved state, starting new game:", err);
            restartGame();
        }
    } else {
        restartGame();
    }
    
    const storySelect = document.getElementById("story-select");
    if (storySelect) {
        storySelect.addEventListener("change", () => {
            restartGame();
        });
    }

    document.getElementById("command-form").addEventListener("submit", handleCommandInput);
    initCollapsiblePanels();
    initNarratorToggle();
    initAutoPlayControls();
    window.restartGame = restartGame;
};

// --- AUTOPLAY UI ---

function updateAutoPlayButton() {
    const btn = document.getElementById('autoplay-toggle');
    if (!btn) return;
    if (state.autoPlayEnabled) {
        btn.textContent = '⏸ Pause';
        btn.classList.add('active');
    } else {
        btn.textContent = '▶ AutoPlay';
        btn.classList.remove('active');
    }
}

function initAutoPlayControls() {
    const btn = document.getElementById('autoplay-toggle');
    const slider = document.getElementById('autoplay-speed');
    const speedLabel = document.getElementById('autoplay-speed-label');

    if (btn) {
        btn.addEventListener('click', () => {
            // Cancel any pending tick before toggling state
            if (state._autoPlayTimeoutId !== null) {
                clearTimeout(state._autoPlayTimeoutId);
                state._autoPlayTimeoutId = null;
            }
            state.autoPlayEnabled = !state.autoPlayEnabled;
            updateAutoPlayButton();
            if (state.autoPlayEnabled && !state.isWriting && (state.storyState === 'pending' || state.storyState === 'running')) {
                logGame('system', '<i>[AutoPlay started — the story will advance automatically. Type anything to intervene.]</i>');
                state._autoPlayTimeoutId = setTimeout(() => {
                    state._autoPlayTimeoutId = null;
                    tickGame(null);
                }, 500); // Short delay so button feedback renders first
            } else if (!state.autoPlayEnabled) {
                logGame('system', '<i>[AutoPlay paused.]</i>');
            }
        });
    }

    if (slider && speedLabel) {
        slider.addEventListener('input', () => {
            state.autoPlayIntervalMs = parseInt(slider.value, 10);
            speedLabel.textContent = `${(state.autoPlayIntervalMs / 1000).toFixed(1)}s`;
        });
    }
}

function renderDecisionModal(decision) {
    // Remove any existing modal
    const existing = document.getElementById('decision-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'decision-modal';
    overlay.className = 'decision-overlay';

    const box = document.createElement('div');
    box.className = 'decision-box';

    const promptEl = document.createElement('p');
    promptEl.className = 'decision-prompt';
    promptEl.textContent = decision.prompt;
    box.appendChild(promptEl);

    const choicesEl = document.createElement('div');
    choicesEl.className = 'decision-choices';

    decision.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.className = 'btn decision-btn';
        btn.id = `decision-choice-${idx}`;
        btn.textContent = choice.label;
        btn.addEventListener('click', () => resolveDecision(decision, choice));
        choicesEl.appendChild(btn);
    });

    box.appendChild(choicesEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Trigger fade-in
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function resolveDecision(decision, choice) {
    // Record decision
    if (!state.decisionsLog) state.decisionsLog = {};
    state.decisionsLog[decision.id] = choice.label;
    state.pendingDecision = null;

    // Apply choice mutations via the director's executeMutations (re-export not needed — inline)
    if (choice.mutations && choice.mutations.length > 0) {
        choice.mutations.forEach(mut => {
            if (mut.type === 'set_desires') {
                const actor = state.actors[mut.actorId];
                if (actor && mut.desires) {
                    for (const key in mut.desires) actor.desires[key] = mut.desires[key];
                }
            } else if (mut.type === 'set_state') {
                state[mut.key] = mut.value;
            }
            // Other mutation types can be added here as needed
        });
    }

    // Log the consequence to the game terminal
    logGame('event', `<b>[Your Choice: "${choice.label}"]</b> ${choice.consequence}`);

    // Remove modal
    const overlay = document.getElementById('decision-modal');
    if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 400);
    }

    // Resume AutoPlay if it was on
    if (state.autoPlayEnabled && (state.storyState === 'pending' || state.storyState === 'running')) {
        setTimeout(() => tickGame(null), state.autoPlayIntervalMs);
    }
}
