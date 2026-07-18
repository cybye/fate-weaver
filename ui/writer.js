import { callLLM } from './llm.js';
import { WRITER_PROMPT_TEMPLATE } from './content.js';

/**
 * Runs the Writer layer to generate a literary storybook paragraph for the current turn.
 * @param {Object} state - The current game state.
 * @param {Array} turnLogs - The logs captured during the current turn.
 * @param {boolean} isLLMActive - Whether the backend LLM service is active.
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

    if (!isLLMActive) {
        throw new Error("Local LLM engine is offline.");
    }

    const actorsContext = Object.values(state.actors).map(actor => {
        return `- ${actor.name}: ${actor.role} (located at the ${state.storyRooms[actor.location]?.name || actor.location})`;
    }).join('\n');

    // Continuity reference for the writer. By default we only show paragraphs from
    // the CURRENT chapter so the prose starts a fresh scene each chapter instead of
    // "transitioning" out of the previous one's atmosphere. The boundary is the last
    // recorded chapter-break CLOSER (the previous chapter's closing note index);
    // everything after it belongs to the current chapter. Persistent lore (name,
    // decisions, inventory, actors) still comes from state and is preserved across
    // chapters. The first chapter (no closers) falls back to the last 3 paragraphs.
    const fullHistory = state.chronicleHistory || [];
    let historyWindow;
    const closers = Array.isArray(state.chapterBreakClosers) ? state.chapterBreakClosers : [];
    if (closers.length > 0) {
        const startIdx = closers[closers.length - 1] + 1; // first paragraph of current chapter
        historyWindow = fullHistory.slice(Math.max(startIdx, fullHistory.length - 3));
    } else {
        historyWindow = fullHistory.slice(-3);
    }
    const historyContext = historyWindow.length > 0
        ? historyWindow.join('\n\n')
        : "(This is the beginning of the story.)";

    const choicesMade = state.decisionsLog ? JSON.stringify(state.decisionsLog) : "None";

    const prompt = `Game state context:
- Player Name: ${state.playerName || "Leo"} (You MUST use this exact name or 'the traveler' when referring to the player. Do NOT invent other names.)
- Player location: ${state.storyRooms[state.playerLocation].name}
- Player Inventory: ${JSON.stringify(state.playerInventory)}
- Active Milestone: ${state.activeMilestoneId}
- Recent choices/decisions made by player: ${choicesMade}

Actors and their roles in the world:
${actorsContext}

Story chronicle written so far (for continuity and style reference):
${historyContext}

Logs from this turn:
${logSummary}`;

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`[Writer Layer] Attempting chronicle generation (Attempt ${attempt}/${maxAttempts})...`);
            // Per-chapter writing style: each STORY_CONFIG may define a `writerStyle`
            // string that tailors the prose (e.g. dreamy for the void, terse for the
            // castle). Appended to the base template so it overrides where relevant.
            const chapterStyle = state.storyConfig && state.storyConfig.writerStyle;
            const systemInstruction = chapterStyle
                ? `${WRITER_PROMPT_TEMPLATE}\n\n-- CHAPTER-SPECIFIC STYLE --\n${chapterStyle}`
                : WRITER_PROMPT_TEMPLATE;
            const result = await callLLM(prompt, systemInstruction, "writer");
            if (result) {
                if (result.paragraph) {
                    return cleanParagraphText(result.paragraph.trim(), state);
                }
                // Fallback: scan all keys for the longest string value (useful for Chain of Thought outputs)
                let longestStr = "";
                for (const key in result) {
                    if (typeof result[key] === "string") {
                        const val = result[key];
                        const isMeta = /(?:user wants|novelizing|Story Context|Current Turn|Scene description|Constraints:)/i.test(val);
                        if (!isMeta && val.length > longestStr.length) {
                            longestStr = val;
                        }
                    }
                }
                if (longestStr.length > 50) {
                    const cleanStr = longestStr.replace(/^(?:\d+\.\s*)?(?:Refining for flow:|Final Draft:|Paragraph:|New Draft:|Draft:|Thought:)\s*/i, "");
                    return cleanParagraphText(cleanStr.trim(), state);
                }
            }
        } catch (e) {
            console.warn(`[Writer Layer] Attempt ${attempt} failed:`, e);
            if (attempt < maxAttempts) {
                const sleepTime = 1000 * attempt; // Exponential backoff: 1s, 2s, 3s...
                console.log(`[Writer Layer] Sleeping ${sleepTime}ms before retry...`);
                await sleep(sleepTime);
            } else {
                console.error("[Writer Layer] All chronicle generation attempts failed.");
                throw e; // Let tickGame handle the error and unlock UI
            }
        }
    }
    throw new Error("Chronicle generation failed to return a valid paragraph.");
}

function cleanParagraphText(text, state) {
    if (!text) return text;
    let paragraph = text;
    
    // Unescape double quotes and clean trailing backslashes from parser boundaries
    paragraph = paragraph.replace(/\\"/g, '"').replace(/\\+$/, '');
    
    // Strip trailing Chain of Thought or prompt descriptions that the LLM occasionally appends
    const instructionsIndex = paragraph.search(/(?:\b\w+ check:|\bfor dialogue if needed|\bCheck constraints|Style check:|\d+\.\s*(?:Story )?(?:Context|Turn|Scene|Novelization|Objective|Requirements|Check)|The user wants|Style Requirements:|Formatting rules:|Rules:|I need to)/i);
    if (instructionsIndex !== -1) {
        paragraph = paragraph.substring(0, instructionsIndex).trim();
    }
    
    // Reject instruction leakage / meta-text responses to trigger a retry
    const isMetaText = /(?:Story Context|Current Turn|Scene description|Novelization|user wants|novelizing a game|fantasy fiction|past tense|third person|sentences\)|sentence structure|I need to)/i.test(paragraph);
    if (isMetaText) {
        throw new Error("LLM returned prompt instructions instead of story prose.");
    }
    
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
        if (!text) {
            resolve();
            return;
        }
        const quill = document.getElementById("quill-icon");
        const status = document.getElementById("writer-status");

        if (quill) quill.classList.add("writing");
        if (status) {
            status.textContent = "Scribe Writing...";
            status.classList.add("writing-mode");
        }

        // Determine whether element is a leaf <p> (chronicle-inline) or a container
        const isLeaf = element.tagName === "P";

        let textSpan, cursorSpan;
        if (isLeaf) {
            // Type directly into the inline paragraph
            if (element.classList.contains("first-paragraph")) {
                const firstChar = text.charAt(0);
                const dropCapSpan = document.createElement("span");
                dropCapSpan.className = "drop-cap";
                dropCapSpan.textContent = firstChar;
                element.appendChild(dropCapSpan);
                text = text.substring(1);
            }
            textSpan = document.createElement("span");
            cursorSpan = document.createElement("span");
            cursorSpan.className = "typewriter-cursor";
            element.appendChild(textSpan);
            element.appendChild(cursorSpan);
        } else {
            // Legacy container mode — create a book-paragraph child
            const p = document.createElement("p");
            p.className = "book-paragraph";

            if (element.children.length === 0 || (element.children.length === 1 && element.children[0].classList.contains("book-placeholder"))) {
                p.classList.add("first-paragraph");
                const firstChar = text.charAt(0);
                const dropCapSpan = document.createElement("span");
                dropCapSpan.className = "drop-cap";
                dropCapSpan.textContent = firstChar;
                p.appendChild(dropCapSpan);
                text = text.substring(1);
            }

            textSpan = document.createElement("span");
            p.appendChild(textSpan);

            cursorSpan = document.createElement("span");
            cursorSpan.className = "typewriter-cursor";
            p.appendChild(cursorSpan);

            element.appendChild(p);

            const placeholder = element.querySelector(".book-placeholder");
            if (placeholder) placeholder.remove();
        }

        let index = 0;

        function typeChar() {
            if (index < text.length) {
                textSpan.textContent += text.charAt(index);
                index++;

                // Scroll the book-content container (works for both modes)
                const bookContent = document.getElementById("book-content");
                if (bookContent) bookContent.scrollTop = bookContent.scrollHeight;

                const randomDelay = speed + (Math.random() * 15 - 5);
                setTimeout(typeChar, randomDelay);
            } else {
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
    if (!isNarratorEnabled) {
        return Promise.resolve();
    }

    // Cancel any currently speaking speech immediately
    window.speechSynthesis.cancel();

    // Clean HTML tags and entities
    const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "")
                          .replace(/&quot;/g, '"')
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>');

    return new Promise((resolve) => {
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

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.speak(utterance);
    });
}


