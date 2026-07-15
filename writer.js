import { callOllama } from './ollama.js';
import { WRITER_PROMPT_TEMPLATE } from './content.js';

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

    // Helper to sleep/wait
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Prepare a clean summary of what happened this turn
    const logSummaryLines = turnLogs.map(log => {
        let cleanText = log.text.replace(/<\/?[^>]+(>|$)/g, ""); // Strip HTML tags
        cleanText = cleanText.replace(/^\[Turn \d+\]\s*/, "");
        
        if (log.type === "player") {
            return `Player action: "${cleanText}"`;
        } else if (log.type === "npc") {
            return `NPC action/dialogue: ${cleanText}`;
        } else if (log.type === "event") {
            return `Story Event: ${cleanText}`;
        } else if (log.type === "narrator") {
            return `Omniscient Narrator observation (the player is unaware, but this should be woven into the chronicle prose): ${cleanText}`;
        } else if (log.type === "director-announce") {
            return `Fate Shift: ${cleanText}`;
        } else {
            return `System report: ${cleanText}`;
        }
    });

    const logSummary = logSummaryLines.join('\n');

    if (isLLMActive) {
        const actorsContext = Object.values(state.actors).map(actor => {
            return `- ${actor.name}: ${actor.role} (located at the ${state.storyRooms[actor.location]?.name || actor.location})`;
        }).join('\n');

        const historyWindow = (state.chronicleHistory || []).slice(-3);
        const historyContext = historyWindow.length > 0
            ? historyWindow.join('\n\n')
            : "(This is the beginning of the story.)";

        const prompt = `Game state context:
- Player location: ${state.storyRooms[state.playerLocation].name}
- Player Inventory: ${JSON.stringify(state.playerInventory)}
- Active Milestone: ${state.activeMilestoneId}

Actors and their roles in the world:
${actorsContext}

Story chronicle written so far (for continuity and style reference):
${historyContext}

Logs from this turn:
${logSummary}`;

        // Attempt 1
        try {
            const result = await callOllama(prompt, WRITER_PROMPT_TEMPLATE);
            if (result && result.paragraph) {
                return cleanParagraphText(result.paragraph.trim(), state);
            }
        } catch (e) {
            console.warn("[Writer Layer] Primary LLM attempt failed, sleeping 300ms before retry...", e);
            await sleep(300);
            
            // Attempt 2 (Retry)
            try {
                const result = await callOllama(prompt, WRITER_PROMPT_TEMPLATE);
                if (result && result.paragraph) {
                    return cleanParagraphText(result.paragraph.trim(), state);
                }
            } catch (retryError) {
                console.error("[Writer Layer] LLM retry attempt failed. Falling back to dynamic chronicle summary.", retryError);
            }
        }
    }

    // Pure generic atmospheric fallback prose (no technical diagnostics)
    const pName = state.playerName || "the traveler";
    const capName = pName.charAt(0).toUpperCase() + pName.slice(1);
    const locationName = state.storyRooms[state.playerLocation].name;
    const turnIdx = state.turn || 0;

    const genericAtmosphereList = [
        `A heavy silence lingered over the ${locationName} as the paths of fate shifted.`,
        `Shadows lengthened across the ${locationName}, marking the steady passage of another quiet hour.`,
        `A cool breeze swept through the ${locationName} while the next choice remained hanging in the air.`,
        `The stone walls of the ${locationName} kept their ancient secrets close as time marched onward.`
    ];

    // Scan turn logs for interesting actions to build a dynamic narrative fallback
    let convergences = [];
    let actions = [];
    let dialogs = [];

    turnLogs.forEach(log => {
        const cleanText = log.text.replace(/<\/?[^>]+(>|$)/g, "").trim();
        if (log.type === "system" && (cleanText.includes("STORY CONVERGENCE") || cleanText.includes("STORY ADVANCEMENT"))) {
            convergences.push(cleanText.replace("STORY CONVERGENCE: ", "").replace("STORY ADVANCEMENT: ", ""));
        } else if (log.type === "player" || log.type === "event") {
            actions.push(cleanText);
        } else if (log.type === "npc" && cleanText.includes("says:")) {
            dialogs.push(cleanText);
        }
    });

    let fallbackParagraph = "";
    if (convergences.length > 0) {
        fallbackParagraph += `${convergences.join(". ")} `;
    }
    if (dialogs.length > 0) {
        fallbackParagraph += `During the encounter, ${dialogs.join(". ")} `;
    }
    if (actions.length > 0) {
        fallbackParagraph += `Meanwhile, the traveler resolved to ${actions.join(", then ")}. `;
    }

    if (!fallbackParagraph) {
        const idx = (turnIdx + locationName.length) % genericAtmosphereList.length;
        fallbackParagraph = genericAtmosphereList[idx];
    } else {
        fallbackParagraph += `A heavy silence lingered over the ${locationName} as the paths of fate shifted.`;
    }

    return fallbackParagraph;
}

function cleanParagraphText(text, state) {
    if (!text) return text;
    let paragraph = text;
    if (state && state.playerName) {
        const name = state.playerName;
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
        paragraph = paragraph
            .replace(/\bThe traveler\b/g, capitalizedName)
            .replace(/\bthe traveler\b/g, name);
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


