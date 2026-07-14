import { ENGINE_CONFIG } from './config.js';

// Ollama HTTP client wrapper
export async function callOllama(prompt, systemInstruction = "") {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/generate";
    const model = ENGINE_CONFIG.defaultOllamaModel;

    // Inject format expectation in prompt
    const formattedPrompt = `${systemInstruction}\n\nRespond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.\n\nInput Context:\n${prompt}`;

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
        })
    });

    if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
    const data = await response.json();
    
    let rawText = data.response.trim();
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        rawText = rawText.substring(start, end + 1);
    }
    
    return JSON.parse(rawText);
}

export async function testOllamaConnection() {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/tags";
    try {
        const res = await fetch(url);
        return res.ok;
    } catch (e) {
        return false;
    }
}
