const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();

// Use Render's PORT or fallback
const PORT = process.env.PORT || 10000;

// Your external file server
const REMOTE_ROOT = 'https://najuzi.com';

// Enable CORS
app.use(cors());

// Health check
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Root route
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ Najuzi PDF & Video Proxy Server</h1>
    <p>Now serving files from: <strong>${REMOTE_ROOT}/webapp/MobileApp</strong></p>
    <p>Use: <code>/file?path=/webapp/MobileApp/AGRICULTURE/NOTES/topic.pdf</code></p>
  `);
});

// ========= Dynamic Folder Tree =========
app.get('/folder-tree', async (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.status(400).send('Missing folder name');

  try {
    const url = `${REMOTE_ROOT}/webapp/MobileApp/${folder}/`;
    const response = await fetch(url);
    if (!response.ok) return res.status(404).send('Folder not found');

    const text = await response.text();
    const items = parseDirectoryListing(text, url);
    res.json(items);
  } catch (err) {
    console.error('Error fetching folder:', err.message);
    res.status(500).send('Failed to load folder');
  }
});

// Simple HTML parser for autoindex
function parseDirectoryListing(html, baseUrl) {
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
  const matches = [...html.matchAll(regex)];
  const items = [];

  for (const m of matches) {
    const href = m[1];
    const name = m[2].trim();

    if (name === 'Parent Directory') continue;

    const isFolder = href.endsWith('/');
    const itemUrl = new URL(href, baseUrl).href;

    if (isFolder) {
      items.push({ type: 'folder', name, path: itemUrl });
    } else if (name.endsWith('.pdf') || name.endsWith('.mp4')) {
      items.push({ type: 'file', name, path: itemUrl, url: itemUrl });
    }
  }

  return items;
}

// ========= Proxy File Requests =========
app.get('/file', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing path parameter');

  try {
    // Construct full remote URL
    const remoteUrl = `${REMOTE_ROOT}${filePath}`;

    // Validate it starts with allowed root
    if (!remoteUrl.startsWith(REMOTE_ROOT)) {
      return res.status(403).send('Access denied');
    }

    // Fetch file from remote server
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      return res.status(404).send('File not found');
    }

    // Stream file directly
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const filename = path.basename(filePath);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Pipe response directly (no buffering)
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      start(controller) {
        function push() {
          reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
            push();
          });
        }
        push();
      }
    });

    stream.pipeTo(ResReadable.from(res));
  } catch (err) {
    console.error('File proxy error:', err.message);
    res.status(500).send('Error loading file');
  }
});

// Polyfill for streaming (Node.js Readable)
const { Readable } = require('stream');
function ResReadable() {}
ResReadable.from = (res) => {
  const writable = new Readable({ read() {} });
  writable.pipe(res);
  return writable;
};

// Fallback: Use node-fetch if available, otherwise warn
let fetch;
try {
  fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
} catch {
  console.warn('node-fetch not installed. Folder listing will fail.');
  fetch = () => Promise.resolve({ ok: false });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Test: https://webserver-zpgc.onrender.com/file?path=/webapp/MobileApp/AGRICULTURE/NOTES/example.pdf`);
});
