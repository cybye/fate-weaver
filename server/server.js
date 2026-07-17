const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const OLLAMA_TARGET = 'http://localhost:11434';

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

function parseStructuredResponse(responseText) {
    if (responseText && typeof responseText === 'object') {
        return responseText;
    }

    if (typeof responseText !== 'string') {
        throw new Error('LLM response was not a string or object.');
    }

    return JSON.parse(responseText);
}

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
            return { paragraph: trimmed };
        case 'director':
            return { description: trimmed, new_assertions: [] };
        case 'npc_dialogue':
            return { dialogue: trimmed, new_assertions: [], story_shared: false };
        case 'parser':
            return { tool_name: 'wait', arguments: {} };
        case 'autoplayer':
            return { tool_name: 'wait', arguments: {}, thought: '' };
        case 'npc_action':
            return { thought: '', plan_steps: ['stay'], long_term_goal: 'wander', steal_attempt: 'none' };
        default:
            return { response: trimmed };
    }
}

// Helper to read POST body as JSON
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
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

    // 1. Check if the request is an Ollama proxy call (maintained for fallback)
    if (req.url.startsWith('/api/ollama/')) {
        // Strip "/api/ollama" to get the target path (e.g. "/api/generate" or "/api/tags")
        const targetPath = req.url.substring('/api/ollama'.length);
        const targetUrl = OLLAMA_TARGET + targetPath;

        console.log(`[Proxy] Forwarding ${req.method} ${req.url} -> ${targetUrl}`);

        const headers = { ...req.headers };
        // Delete host header so node's http client sets the correct target host
        delete headers.host;

        const proxyReq = http.request(targetUrl, {
            method: req.method,
            headers: headers
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('error', (err) => {
            console.error(`[Proxy Error] ${err.message}`);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to connect to local Ollama instance.' }));
        });

        req.pipe(proxyReq, { end: true });
        return;
    }

    // 2. Otherwise serve static files
    let requestPath = req.url.split('?')[0];
    if (requestPath === '/') {
        requestPath = '/index.html';
    }

    const filePath = path.join(__dirname, '../ui', requestPath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game server running on http://0.0.0.0:${PORT}`);
    console.log(`Proxying Ollama requests internally to ${OLLAMA_TARGET}`);
});
