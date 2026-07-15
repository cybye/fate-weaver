import { ENGINE_CONFIG } from './config.js';

// Ollama HTTP client wrapper
export async function callOllama(prompt, systemInstruction = "") {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/generate";
    const model = ENGINE_CONFIG.defaultOllamaModel;

    // Inject format expectation in prompt
    const formattedPrompt = `${systemInstruction}\n\nRespond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.\n\nInput Context:\n${prompt}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: model,
                prompt: formattedPrompt,
                stream: false,
                format: "json",
                options: {
                    temperature: 0.6
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
        const data = await response.json();
        
        let rawText = data.response.trim();
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            rawText = rawText.substring(start, end + 1);
        }
        
        try {
            return JSON.parse(rawText);
        } catch (parseError) {
            console.warn("[Ollama Client] JSON parsing failed, attempting regex extraction fallback:", parseError);
            
            const paragraphMatch = rawText.match(/"paragraph"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
            if (paragraphMatch) {
                return { paragraph: paragraphMatch[1].trim() };
            }
            
            const dialogueMatch = rawText.match(/"dialogue"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
            if (dialogueMatch) {
                return { dialogue: dialogueMatch[1].trim() };
            }
            
            if (rawText.length > 20 && !rawText.includes("{")) {
                return { paragraph: rawText };
            }
            
            throw parseError;
        }
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

export async function testOllamaConnection() {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/tags";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        clearTimeout(timeoutId);
        return false;
    }
}
