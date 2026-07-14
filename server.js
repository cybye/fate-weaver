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

const server = http.createServer((req, res) => {
    // 1. Check if the request is an Ollama proxy call
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

    const filePath = path.join(__dirname, requestPath);

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
