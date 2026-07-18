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

// Supported providers. Unknown provider strings fail fast instead of silently
// routing to Ollama (which produced confusing runtime errors on config typos).
const SUPPORTED_PROVIDERS = new Set(['openrouter', 'ollama']);

// Cache the config and invalidate it when the file's mtime changes, so we avoid
// a synchronous disk read on every LLM call while still picking up edits live.
let _configCache = null;
let _configMtime = null;

function getLLMConfig() {
    const configPath = path.join(__dirname, 'llm_config.json');
    if (fs.existsSync(configPath)) {
        try {
            const mtime = fs.statSync(configPath).mtimeMs;
            if (_configCache && _configMtime === mtime) {
                return _configCache;
            }
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configContent);
            const provider = (config.provider || 'ollama').toLowerCase();
            if (!SUPPORTED_PROVIDERS.has(provider)) {
                throw new Error(
                    `Unsupported LLM provider "${config.provider}" in llm_config.json. ` +
                    `Supported providers: ${[...SUPPORTED_PROVIDERS].join(', ')}.`
                );
            }
            _configCache = config;
            _configMtime = mtime;
            return config;
        } catch (e) {
            if (e.message && e.message.startsWith('Unsupported LLM provider')) {
                throw e;
            }
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

// Structured-output schemas keyed by role. Adding a new LLM role is now a single
// map entry instead of a new switch case, and the shape is declared once.
const STRUCTURED_OUTPUT_SCHEMAS = {
    writer: {
        name: 'WriterOutput',
        schema: {
            type: 'object',
            properties: {
                paragraph: { type: 'string' }
            },
            required: ['paragraph'],
            additionalProperties: true
        }
    },
    director: {
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
    },
    parser: {
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
    },
    autoplayer: {
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
    },
    npc_dialogue: {
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
    },
    npc_action: {
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
    }
};

function getStructuredOutputSchema(role) {
    return STRUCTURED_OUTPUT_SCHEMAS[(role || 'default').toLowerCase()] || null;
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

// Promise-based delay used by the retry loop.
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry configuration for transient provider errors (e.g. OpenRouter 429 rate limits).
// Override via env vars if desired; sensible defaults otherwise.
const OPENROUTER_MAX_RETRIES = parseInt(process.env.OPENROUTER_MAX_RETRIES, 10) || 4;
const OPENROUTER_BASE_BACKOFF_MS = parseInt(process.env.OPENROUTER_BASE_BACKOFF_MS, 10) || 1500;

// Shared instruction appended to every LLM call so the model returns raw JSON
// (no markdown fences / conversational text). Defined once to avoid drift
// between the OpenRouter and Ollama request builders.
const JSON_INSTRUCTION = 'Respond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.';

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

        const systemMessage = systemInstruction ? `${systemInstruction}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
        
        const body = {
            model: model,
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
            ],
            response_format: structuredOutput ? structuredOutput.openRouterResponseFormat : { type: 'json_object' },
            plugins: [{ id: 'response-healing' }]
        };

        // Retry loop: transient failures (429 rate-limit, 5xx) are retried with
        // exponential backoff so the game keeps running through brief outages.
        let response = null;
        let lastErrText = '';
        for (let attempt = 0; attempt <= OPENROUTER_MAX_RETRIES; attempt++) {
            response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(90000)
            });

            if (response.ok) break;

            lastErrText = await response.text();
            const status = response.status;
            const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
            if (!isRetryable || attempt === OPENROUTER_MAX_RETRIES) {
                throw new Error(`OpenRouter returned status ${status}: ${lastErrText}`);
            }

            const backoff = OPENROUTER_BASE_BACKOFF_MS * Math.pow(2, attempt);
            console.warn(`[llmService] OpenRouter status ${status} (attempt ${attempt + 1}/${OPENROUTER_MAX_RETRIES + 1}). Retrying in ${backoff}ms...`);
            await sleep(backoff);
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
            ? `${systemInstruction}\n\n${JSON_INSTRUCTION}\n\nInput Context:\n${prompt}`
            : `${JSON_INSTRUCTION}\n\nInput Context:\n${prompt}`;

        const body = {
            model: model,
            prompt: formattedPrompt,
            stream: false,
            format: structuredOutput ? structuredOutput.format : 'json'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90000)
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
