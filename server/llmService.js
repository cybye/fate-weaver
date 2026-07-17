const fs = require('fs');
const path = require('path');

// Safe parsing of .env files to populate process.env without external dotenv dependency
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            envContent.split(/\r?\n/).forEach(line => {
                // Ignore comments and empty lines
                if (line.trim().startsWith('#') || !line.includes('=')) return;
                const parts = line.split('=');
                const key = parts[0].trim();
                let value = parts.slice(1).join('=').trim();
                // Strip surrounding quotes
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                process.env[key] = value;
            });
            console.log('[llmService] Environment variables loaded from .env');
        } catch (e) {
            console.error('[llmService] Failed to read .env file:', e);
        }
    }
}

// Load environment variables immediately on load
loadEnv();

function getLLMConfig() {
    const configPath = path.join(__dirname, 'llm_config.json');
    if (fs.existsSync(configPath)) {
        try {
            const configContent = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configContent);
        } catch (e) {
            console.error('[llmService] Failed to parse llm_config.json. Falling back to default.', e);
        }
    }
    // Default fallback
    return {
        provider: 'ollama',
        ollama_url: 'http://localhost:11434',
        roles: {
            default: 'gemma4'
        }
    };
}

function getStructuredOutputSchema(role) {
    switch ((role || 'default').toLowerCase()) {
        case 'writer':
            return {
                name: 'WriterOutput',
                schema: {
                    type: 'object',
                    properties: {
                        paragraph: { type: 'string' }
                    },
                    required: ['paragraph'],
                    additionalProperties: true
                }
            };

        case 'director':
            return {
                name: 'DirectorOutput',
                schema: {
                    type: 'object',
                    properties: {
                        description: { type: 'string' },
                        new_assertions: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    },
                    required: ['description', 'new_assertions'],
                    additionalProperties: true
                }
            };

        case 'parser':
            return {
                name: 'ToolCallOutput',
                schema: {
                    type: 'object',
                    properties: {
                        tool_name: { type: 'string' },
                        arguments: {
                            type: 'object',
                            additionalProperties: true
                        }
                    },
                    required: ['tool_name', 'arguments'],
                    additionalProperties: true
                }
            };

        case 'autoplayer':
            return {
                name: 'AutoplayerOutput',
                schema: {
                    type: 'object',
                    properties: {
                        tool_name: { type: 'string' },
                        arguments: {
                            type: 'object',
                            additionalProperties: true
                        },
                        thought: { type: 'string' }
                    },
                    required: ['tool_name', 'arguments', 'thought'],
                    additionalProperties: true
                }
            };

        case 'npc_dialogue':
            return {
                name: 'NpcDialogueOutput',
                schema: {
                    type: 'object',
                    properties: {
                        dialogue: { type: 'string' },
                        new_assertions: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        story_shared: { type: 'boolean' }
                    },
                    required: ['dialogue', 'new_assertions', 'story_shared'],
                    additionalProperties: true
                }
            };

        case 'npc_action':
            return {
                name: 'NpcActionOutput',
                schema: {
                    type: 'object',
                    properties: {
                        thought: { type: 'string' },
                        plan_steps: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        long_term_goal: { type: 'string' },
                        steal_attempt: { type: 'string' }
                    },
                    required: ['thought', 'plan_steps', 'long_term_goal'],
                    additionalProperties: true
                }
            };

        default:
            return null;
    }
}

function buildStructuredOutputConfig(role) {
    const structured = getStructuredOutputSchema(role);
    if (!structured) return null;

    return {
        format: structured.schema,
        openRouterResponseFormat: {
            type: 'json_schema',
            json_schema: structured
        }
    };
}

async function generate(prompt, systemInstruction = '', role = 'default') {
    const config = getLLMConfig();
    const provider = (config.provider || 'ollama').toLowerCase();
    
    // Resolve model based on role, fallback to default
    const roles = config.roles || {};
    const model = roles[role] || roles['default'] || 'gemma4';
    const structuredOutput = buildStructuredOutputConfig(role);

    console.log(`[llmService] Route request using role: "${role}", provider: "${provider}", model: "${model}"`);

    if (provider === 'openrouter') {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY environment variable is not set. Please check your .env file.');
        }

        const url = 'https://openrouter.ai/api/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:8080',
            'X-Title': 'Fate Weaver'
        };

        const systemMessage = systemInstruction ? `${systemInstruction}\n\nRespond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.` : 'Respond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.';
        
        const body = {
            model: model,
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
            ],
            response_format: structuredOutput ? structuredOutput.openRouterResponseFormat : { type: 'json_object' },
            plugins: [{ id: 'response-healing' }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter returned status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
            throw new Error('OpenRouter response contains no completions.');
        }

        const rawText = data.choices[0].message.content;
        return { response: rawText };

    } else {
        // Default to local Ollama
        const ollamaHost = config.ollama_url || 'http://localhost:11434';
        const url = `${ollamaHost}/api/generate`;
        
        // Inject format expectation in prompt similar to original client
        const formattedPrompt = systemInstruction 
            ? `${systemInstruction}\n\nRespond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.\n\nInput Context:\n${prompt}`
            : `Respond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.\n\nInput Context:\n${prompt}`;

        const body = {
            model: model,
            prompt: formattedPrompt,
            stream: false,
            format: structuredOutput ? structuredOutput.format : 'json'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama returned status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        return { response: data.response };
    }
}

async function testConnection() {
    const config = getLLMConfig();
    const provider = (config.provider || 'ollama').toLowerCase();

    if (provider === 'openrouter') {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            return { ok: false, error: 'OPENROUTER_API_KEY is not set' };
        }
        // Check OpenRouter API with a list models call
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            return { ok: response.ok, provider: 'openrouter' };
        } catch (e) {
            return { ok: false, provider: 'openrouter', error: e.message };
        }
    } else {
        const ollamaHost = config.ollama_url || 'http://localhost:11434';
        try {
            const response = await fetch(`${ollamaHost}/api/tags`, {
                method: 'GET'
            });
            return { ok: response.ok, provider: 'ollama' };
        } catch (e) {
            return { ok: false, provider: 'ollama', error: e.message };
        }
    }
}

module.exports = {
    generate,
    testConnection
};
