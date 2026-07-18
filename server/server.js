const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB cap on request bodies (DoS guard)

// Absolute path to the UI root; all static requests are confined beneath it.
const UI_ROOT = path.resolve(__dirname, '../ui');

// Helper to determine Content-Type
function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html';
        case '.js': return 'application/javascript';
        case '.css': return 'text/css';
        case '.json': return 'application/json';
        case '.png': return 'image/png';
        case '.jpg': return 'image/jpeg';
        case '.ico': return 'image/x-icon';
        default: return 'application/octet-stream';
    }
}

const llmService = require('./llmService');

function normalizeLLMResponse(responseText, role) {
    const normalizedRole = (role || 'default').toLowerCase();

    if (responseText && typeof responseText === 'object') {
        return responseText;
    }

    if (typeof responseText !== 'string') {
        throw new Error('LLM response was not a string or object.');
    }

    const trimmed = responseText.trim();
    if (!trimmed) {
        throw new Error('LLM response was empty.');
    }

    const candidates = [
        trimmed,
        trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    ];

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch (e) {
            const start = candidate.indexOf('{');
            const end = candidate.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                try {
                    return JSON.parse(candidate.slice(start, end + 1));
                } catch (innerError) {
                    // Keep trying role-based fallbacks below.
                }
            }
        }
    }

    switch (normalizedRole) {
        case 'writer':
            return { _fallback: true, paragraph: trimmed };
        case 'director':
            return { _fallback: true, description: trimmed, new_assertions: [] };
        case 'npc_dialogue':
            return { _fallback: true, dialogue: trimmed, new_assertions: [], story_shared: false };
        case 'parser':
            return { _fallback: true, tool_name: 'wait', arguments: {} };
        case 'autoplayer':
            return { _fallback: true, tool_name: 'wait', arguments: {}, thought: '' };
        case 'npc_action':
            return { _fallback: true, thought: '', plan_steps: ['stay'], long_term_goal: 'wander', steal_attempt: 'none' };
        default:
            return { _fallback: true, response: trimmed };
    }
}

// Helper to read POST body as JSON, with a hard size cap to prevent unbounded buffering.
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let exceeded = false;
        req.on('data', chunk => {
            if (exceeded) return;
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
                exceeded = true;
                reject(new Error('Request body exceeds size limit.'));
            }
        });
        req.on('end', () => {
            if (exceeded) return;
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    const parsedUrl = req.url.split('?')[0];
    const cleanUrl = parsedUrl.endsWith('/') && parsedUrl.length > 1 ? parsedUrl.slice(0, -1) : parsedUrl;

    const isGenerate = cleanUrl.endsWith('/api/llm/generate') || cleanUrl.endsWith('/llm/generate');
    const isStatus = cleanUrl.endsWith('/api/llm/status') || cleanUrl.endsWith('/llm/status');

    // Intercept original generate endpoint
    if (isGenerate && req.method === 'POST') {
        try {
            const body = await readJsonBody(req);
            const { prompt, systemInstruction, role } = body;
            const result = await llmService.generate(prompt, systemInstruction, role || 'default');
            const parsedResponse = normalizeLLMResponse(result.response, role || 'default');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...result, response: parsedResponse }));
        } catch (err) {
            console.error('[Server Error] LLM generation failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Intercept original tags/status endpoint
    if (isStatus && req.method === 'GET') {
        try {
            const status = await llmService.testConnection();
            if (status.ok) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models: [] })); // mock Ollama models list response
            } else {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: status.error || 'LLM provider connection failed' }));
            }
        } catch (err) {
            console.error('[Server Error] LLM status check failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
    }

    // 1. Otherwise serve static files
    let requestPath = req.url.split('?')[0];
    if (requestPath === '/') {
        requestPath = '/index.html';
    }

    // Resolve and confine the path to the UI root to prevent path traversal
    // (e.g. GET /../server/.env must not escape the ui/ directory).
    const filePath = path.normalize(path.join(UI_ROOT, requestPath));
    if (filePath !== UI_ROOT && !filePath.startsWith(UI_ROOT + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': getContentType(filePath),
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game server running on http://0.0.0.0:${PORT}`);
});
