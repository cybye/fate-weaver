import { callOllama } from './ollama.js';
import { WRITER_PROMPT_TEMPLATE, ROOMS } from './content.js';

/**
 * Runs the Writer layer to generate a literary storybook paragraph for the current turn.
 * @param {Object} state - The current game state.
 * @param {Array} turnLogs - The logs captured during the current turn.
 * @param {boolean} isLLMActive - Whether the Ollama service is active.
 * @returns {Promise<string>} The novelized paragraph.
 */
export async function runWriter(state, turnLogs, isLLMActive) {
    if (turnLogs.length === 0) {
        return "The chronicle remains silent, waiting for the path to unfold.";
    }

    // Prepare a clean summary of what happened this turn
    const logSummaryLines = turnLogs.map(log => {
        let cleanText = log.text.replace(/<\/?[^>]+(>|$)/g, ""); // Strip HTML tags
        // Strip turn prefix if present (e.g. "[Turn 3] ")
        cleanText = cleanText.replace(/^\[Turn \d+\]\s*/, "");
        
        if (log.type === "player") {
            return `Player action: "${cleanText}"`;
        } else if (log.type === "npc") {
            return `NPC action/dialogue: ${cleanText}`;
        } else if (log.type === "event") {
            return `Story Event: ${cleanText}`;
        } else if (log.type === "director-announce") {
            return `Fate Shift: ${cleanText}`;
        } else {
            return `System report: ${cleanText}`;
        }
    });

    const logSummary = logSummaryLines.join('\n');

    if (isLLMActive) {
        try {
            const actorsContext = Object.values(state.actors).map(actor => {
                return `- ${actor.name}: ${actor.role} (located at the ${ROOMS[actor.location]?.name || actor.location})`;
            }).join('\n');

            const historyWindow = (state.chronicleHistory || []).slice(-3);
            const historyContext = historyWindow.length > 0
                ? historyWindow.join('\n\n')
                : "(This is the beginning of the story.)";

            const prompt = `Game state context:
- Player location: ${ROOMS[state.playerLocation].name}
- Player Inventory: ${JSON.stringify(state.playerInventory)}
- Active Milestone: ${state.activeMilestoneId}

Actors and their roles in the world:
${actorsContext}

Story chronicle written so far (for continuity and style reference):
${historyContext}

Logs from this turn:
${logSummary}`;

            const result = await callOllama(prompt, WRITER_PROMPT_TEMPLATE);
            if (result && result.paragraph) {
                return result.paragraph.trim();
            }
        } catch (e) {
            console.warn("Writer LLM failed, falling back to templates.", e);
        }
    }

    // Heuristic fallback storyteller
    return generateFallbackParagraph(state, turnLogs);
}

/**
 * Robust template-based fallback storyteller that translates game logs to rich prose.
 */
function generateFallbackParagraph(state, turnLogs) {
    let playerAction = "";
    let dialogueLines = [];
    let systemDescriptions = [];
    let npcActions = [];
    let storyEvents = [];
    let fateShifts = [];

    // Parse turn logs to extract events
    turnLogs.forEach(log => {
        let text = log.text.replace(/<\/?[^>]+(>|$)/g, "").replace(/^\[Turn \d+\]\s*/, "").trim();
        
        // Skip parsed action or system facts diagnostics
        if (text.startsWith("[Parsed Action:") || text.startsWith("[System Fact Established:")) {
            return;
        }

        // Ignore technical following updates in the book prose
        if (text.startsWith("You follow ") || text.startsWith("You stop following")) {
            return;
        }

        // Ignore item acquisitions and technical story advancement milestones
        if (text.startsWith("Item Acquired:") || text.startsWith("STORY ADVANCEMENT:")) {
            return;
        }

        // Clean up STORY CONVERGENCE logs to be pure prose
        if (text.startsWith("STORY CONVERGENCE:")) {
            text = text.substring(18).trim();
            storyEvents.push(text);
            return;
        }

        // Ignore NPC technical planning logs completely
        if (text.includes("[Plan Formulation]")) {
            return;
        }

        if (log.type === "player") {
            playerAction = text;
        } else if (log.type === "npc") {
            if (text.includes("says:")) {
                dialogueLines.push(text);
            } else if (text.includes("[Plan Execution]")) {
                // Parse and beautify Plan Execution
                const match = text.match(/\[Plan Execution\]\s+(.+?)\s+moves to the\s+(.+?)\./i);
                if (match) {
                    const name = match[1];
                    const destName = match[2];
                    if (name.toLowerCase() === "bob") {
                        npcActions.push(`The messenger Bob set off toward the ${destName}.`);
                    } else if (name.toLowerCase() === "sly") {
                        npcActions.push(`Sly slunk into the shadows, tailing the path to the ${destName}.`);
                    } else if (name.toLowerCase().includes("guard")) {
                        npcActions.push(`The heavy metal footsteps of the Castle Guard echoed as they marched to the ${destName}.`);
                    } else {
                        npcActions.push(`${name} moved toward the ${destName}.`);
                    }
                }
            } else if (text.includes("Thought:")) {
                // Ignore NPC thoughts in the public book to keep it mysterious!
            } else {
                npcActions.push(text);
            }
        } else if (log.type === "event") {
            storyEvents.push(text);
        } else if (log.type === "director-announce") {
            if (text.startsWith("Fate Shift:")) {
                text = text.substring(11).trim();
            }
            fateShifts.push(text);
        } else if (log.type === "system") {
            if (text.includes("says:")) {
                dialogueLines.push(text);
            } else {
                // Clean up technical system logs (exits, character presence)
                let cleanText = text;
                if (cleanText.includes("Exits lead to:")) {
                    cleanText = cleanText.substring(0, cleanText.indexOf("Exits lead to:")).trim();
                }
                // Strip character presence sentences
                cleanText = cleanText.replace(/\b[A-Za-z]+ is standing here\./ig, "").trim();
                cleanText = cleanText.replace(/\b[A-Za-z]+ are standing here\./ig, "").trim();
                
                if (cleanText) {
                    systemDescriptions.push(cleanText);
                }
            }
        }
    });

    const locationName = ROOMS[state.playerLocation].name;
    let sentences = [];

    // 1. Novelize the player action & movement
    if (playerAction) {
        const actionLower = playerAction.toLowerCase();
        if (actionLower.startsWith("go to") || actionLower.startsWith("travel")) {
            sentences.push(`The traveler set off on foot, crossing the threshold into the ${locationName}.`);
        } else if (actionLower.startsWith("wait") || actionLower.includes("rest") || actionLower.includes("waited")) {
            sentences.push(`The traveler paused to rest in the ${locationName}, letting the hours slip away as they watched the shadows lengthen.`);
        } else if (actionLower.startsWith("examine") || actionLower.startsWith("inspect") || actionLower.startsWith("look at")) {
            const target = playerAction.substring(playerAction.indexOf("examine") + 7).trim();
            sentences.push(`With close, examining eyes, the traveler drew near to inspect the ${target || "surroundings"}.`);
        } else if (actionLower.startsWith("talk") || actionLower.startsWith("converse") || actionLower.startsWith("speak")) {
            sentences.push(`Seeking counsel, the traveler approached to converse with those nearby.`);
        } else if (actionLower.startsWith("shout") || actionLower.includes("yell")) {
            sentences.push(`A sudden, piercing shout shattered the stillness of the ${locationName}.`);
        } else {
            sentences.push(`The traveler resolved to act, choosing to ${playerAction}.`);
        }
    }

    // 2. Add local room atmosphere descriptions if logged
    if (systemDescriptions.length > 0) {
        let desc = translatePronouns(systemDescriptions[0]);
        sentences.push(desc);
    }

    // 3. Add fate shifts and environmental interruptions
    if (fateShifts.length > 0) {
        fateShifts.forEach(shift => {
            let cleanShift = translatePronouns(shift.replace(/^Fate Shift:\s*/i, ""));
            // Capitalize first character
            if (cleanShift.length > 0) {
                cleanShift = cleanShift.charAt(0).toUpperCase() + cleanShift.slice(1);
            }
            sentences.push(cleanShift);
        });
    }

    // 4. Add NPC movements or actions
    if (npcActions.length > 0) {
        npcActions.forEach(action => {
            let cleanAction = translatePronouns(action.replace(/^\[Plan Execution\]\s*/i, "").replace(/^\[Plan Aborted\]\s*/i, ""));
            sentences.push(cleanAction);
        });
    }

    // 5. Add dialogues
    if (dialogueLines.length > 0) {
        dialogueLines.forEach(line => {
            // Format: "Bob says: "..."
            const match = line.match(/^(.+?)\s+says:\s*"(.*?)"/i);
            if (match) {
                const name = match[1];
                let speech = match[2].trim();
                
                // Punctuation clean-up
                if (speech.endsWith(".")) {
                    speech = speech.slice(0, -1) + ",";
                }
                
                const hasPunctuation = /[!?]$/.test(speech);
                if (hasPunctuation || speech.endsWith(",")) {
                    sentences.push(`"${speech}" ${name} spoke, their voice carrying a quiet weight.`);
                } else {
                    sentences.push(`"${speech}," ${name} spoke, their voice carrying a quiet weight.`);
                }
            } else {
                sentences.push(line);
            }
        });
    }

    // 6. Add story events and convergences
    if (storyEvents.length > 0) {
        storyEvents.forEach(evt => {
            let cleanEvt = evt.replace(/^STORY CONVERGENCE:\s*/i, "");
            sentences.push(`In a sudden convergence of paths, ${cleanEvt}`);
        });
    }

    // 7. Add subtle narrator commentary at the end of the turn
    const commentary = getNarratorCommentary(playerAction, locationName);
    if (commentary) {
        sentences.push(commentary);
    }

    // Combine sentences into a beautiful cohesive paragraph
    let paragraph = sentences.join(" ");

    // Final fallback if empty
    if (!paragraph) {
        paragraph = `The traveler stood quietly within the ${locationName}, waiting as the gears of destiny turned silently in the background.`;
    }

    return paragraph;
}

/**
 * Typewriter effect renderer. Prints text character-by-character into the element.
 * @param {HTMLElement} element - The target container element.
 * @param {string} text - The text to print.
 * @param {number} speed - The typing speed in ms per character (default 20ms).
 * @returns {Promise<void>} Resolves when typing finishes.
 */
export function typewriteText(element, text, speed = 20) {
    return new Promise((resolve) => {
        const quill = document.getElementById("quill-icon");
        const status = document.getElementById("writer-status");

        // Set status to typing
        if (quill) quill.classList.add("writing");
        if (status) {
            status.textContent = "Scribe Writing...";
            status.classList.add("writing-mode");
        }

        // Create a new paragraph container
        const p = document.createElement("p");
        p.className = "book-paragraph";
        
        // Mark first paragraph differently (for drop cap or custom style)
        if (element.children.length === 0 || (element.children.length === 1 && element.children[0].classList.contains("book-placeholder"))) {
            p.classList.add("first-paragraph");
            
            // Generate a Drop Cap for the very first letter of the first paragraph!
            const firstChar = text.charAt(0);
            const dropCapSpan = document.createElement("span");
            dropCapSpan.className = "drop-cap";
            dropCapSpan.textContent = firstChar;
            p.appendChild(dropCapSpan);
            
            // Slice the text to remove the first char
            text = text.substring(1);
        }

        const textSpan = document.createElement("span");
        p.appendChild(textSpan);

        const cursorSpan = document.createElement("span");
        cursorSpan.className = "typewriter-cursor";
        p.appendChild(cursorSpan);

        element.appendChild(p);

        // Remove placeholder if present
        const placeholder = element.querySelector(".book-placeholder");
        if (placeholder) placeholder.remove();

        let index = 0;
        
        function typeChar() {
            if (index < text.length) {
                textSpan.textContent += text.charAt(index);
                index++;
                
                // Keep the book container scrolled to the bottom
                const bookContent = document.getElementById("book-content");
                if (bookContent) {
                    bookContent.scrollTop = bookContent.scrollHeight;
                }

                // Add slight randomness to typing speed for human feel
                const randomDelay = speed + (Math.random() * 15 - 5);
                setTimeout(typeChar, randomDelay);
            } else {
                // Done writing
                cursorSpan.remove();
                if (quill) quill.classList.remove("writing");
                if (status) {
                    status.textContent = "Scribe Idle";
                    status.classList.remove("writing-mode");
                }
                resolve();
            }
        }

        typeChar();
    });
}

/**
 * Helper to translate first/second person narrative descriptions into third-person past tense.
 */
function translatePronouns(text) {
    if (!text) return text;
    return text
        .replace(/\bYou step\b/ig, "They stepped")
        .replace(/\bYou scan\b/ig, "They scanned")
        .replace(/\bYou look closely at\b/ig, "They looked closely at")
        .replace(/\bYou look\b/ig, "They looked")
        .replace(/\bYou examine\b/ig, "They examined")
        .replace(/\bYou draw\b/ig, "They drew")
        .replace(/\bYou check\b/ig, "They checked")
        .replace(/\bYou catch\b/ig, "They caught")
        .replace(/\bYou see\b/ig, "They saw")
        .replace(/\bYou find\b/ig, "They found")
        .replace(/\bYou attempt\b/ig, "They attempted")
        .replace(/\bYou speak\b/ig, "They spoke")
        .replace(/\bYou talk\b/ig, "They talked")
        .replace(/\bYou shout\b/ig, "They shouted")
        .replace(/\byou\b/g, "they")
        .replace(/\bYour\b/g, "Their")
        .replace(/\byour\b/g, "their");
}

/**
 * Generate randomized narrator commentary reflecting on the player's choices and actions.
 */
function getNarratorCommentary(playerAction, locationName) {
    if (!playerAction) return "";
    
    const actionLower = playerAction.toLowerCase();
    
    // Waiting
    if (actionLower.startsWith("wait") || actionLower.includes("rest") || actionLower.includes("waited")) {
        const comments = [
            "Time was a luxury they did not truly possess, yet procrastination was a comforting shield.",
            "A dangerous delay, perhaps, but even heroes must catch their breath.",
            "The ticking clock of destiny seemed of little concern to the traveler in that quiet moment.",
            "They chose to linger, letting the world move on around them."
        ];
        return comments[Math.floor(Math.random() * comments.length)];
    }
    
    // Conversation
    if (actionLower.includes("talk") || actionLower.includes("converse") || actionLower.includes("speak") || actionLower.includes("hello")) {
        if (actionLower.includes("sly")) {
            const comments = [
                "Whispering secrets to a rogue in a tavern is like handing matches to a pyromaniac.",
                "Sly watched them with narrow eyes, undoubtedly calculating how much gold was in the traveler's pockets.",
                "A dangerous alliance was forming, though who was using whom remained to be seen.",
                "Seeking trust in a place of cutthroats was a risky gamble."
            ];
            return comments[Math.floor(Math.random() * comments.length)];
        }
        if (actionLower.includes("bob")) {
            const comments = [
                "Bob's weary eyes held the secret that could change the fate of the realm.",
                "Meeting the messenger was key, but getting him to talk was another matter entirely.",
                "The messenger's words were brief, carrying the tension of a hunted animal."
            ];
            return comments[Math.floor(Math.random() * comments.length)];
        }
        return "Words could be a shield, or they could be a weapon; the traveler hoped for the former.";
    }

    // Examination
    if (actionLower.includes("examine") || actionLower.includes("inspect") || actionLower.includes("look at")) {
        const comments = [
            "Every detail was a clue, and in this strange place, they could afford to miss none.",
            "Curiosity was a virtue, though sometimes a dangerous one in these shadowed halls.",
            "They searched for meaning, hoping the objects around them would speak of their forgotten past."
        ];
        return comments[Math.floor(Math.random() * comments.length)];
    }

    // Travel
    if (actionLower.includes("go to") || actionLower.includes("travel") || actionLower.includes("go_")) {
        const comments = [
            "Each new room felt like another step into an intricate maze.",
            "A shift in position, but whether it was toward safety or deeper into the trap remained unseen.",
            "The journey continued, driven by a quiet urgency they could not fully name."
        ];
        return comments[Math.floor(Math.random() * comments.length)];
    }

    // Default generic commentary
    const generalComments = [
        "A deliberate choice, though the threads of fate were growing increasingly tangled.",
        "They moved forward, blind to the strings that the Director pulled from above.",
        "A curious decision in their current predicament, but the path was theirs to walk."
    ];
    return generalComments[Math.floor(Math.random() * generalComments.length)];
}

let isNarratorEnabled = false;
try {
    isNarratorEnabled = localStorage.getItem("narrator_enabled") === "true";
} catch (e) {}

/**
 * Enable/disable TTS narration.
 */
export function toggleNarrator(enabled) {
    isNarratorEnabled = enabled;
    try {
        localStorage.setItem("narrator_enabled", enabled ? "true" : "false");
    } catch (e) {}
    if (!enabled) {
        window.speechSynthesis.cancel();
    }
}

/**
 * Check if TTS narrator is currently enabled.
 */
export function isNarratorActive() {
    return isNarratorEnabled;
}

/**
 * Converts text into spoken words using the Web Speech API with dramatic storytelling parameters.
 */
export function speakText(text) {
    if (!isNarratorEnabled) return;

    // Cancel any currently speaking speech immediately
    window.speechSynthesis.cancel();

    // Clean HTML tags and entities
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "")
                          .replace(/&quot;/g, '"')
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>');

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Get list of voices
    const voices = window.speechSynthesis.getVoices();

    // Try to find a nice narrative voice: en-GB (British storytelling) or en-US
    let chosenVoice = voices.find(v => v.lang === "en-GB" && v.name.toLowerCase().includes("male"));
    if (!chosenVoice) chosenVoice = voices.find(v => v.lang === "en-GB");
    if (!chosenVoice) chosenVoice = voices.find(v => v.lang === "en-US" && v.name.toLowerCase().includes("male") && v.name.toLowerCase().includes("natural"));
    if (!chosenVoice) chosenVoice = voices.find(v => v.lang === "en-US" && v.name.toLowerCase().includes("male"));
    if (!chosenVoice) chosenVoice = voices.find(v => v.lang.startsWith("en"));
    if (!chosenVoice) chosenVoice = voices[0];

    if (chosenVoice) {
        utterance.voice = chosenVoice;
    }

    // Set dramatic storyteller properties: slightly slower, slightly lower pitch
    utterance.rate = 0.88;
    utterance.pitch = 0.90;
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
}


