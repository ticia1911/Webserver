const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Hosted directory.json on Namecheap
const DIRECTORY_JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';

// Encryption config
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-cbc',
  key: crypto.createHash('sha256').update('najuzi0702518998').digest(),
  iv: Buffer.alloc(16, 0),
};

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));

// Root route
app.get('/', (req, res) => {
  res.send('<h2>Server running. Use /list to fetch folders/files.</h2>');
});

// Health check
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Safe fetch wrapper with logging
async function safeFetchJSON(url) {
  try {
    console.log(`[FETCH] Getting: ${url}`);
    const res = await fetch(url, { redirect: 'follow' });
    console.log(`[FETCH] Status: ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log(`[FETCH] JSON keys: ${Object.keys(json)}`);
    return json;
  } catch (err) {
    console.error(`[ERROR] Fetching JSON failed: ${err.message}`);
    return {};
  }
}

// Read directory.json from Namecheap
async function readDirectoryJSON() {
  return await safeFetchJSON(DIRECTORY_JSON_URL);
}

// Recursive lookup
function getNodeAtPath(tree, relativePath) {
  if (!relativePath) return tree;
  const parts = relativePath.split('/');
  let node = tree;
  for (const part of parts) {
    if (!node[part]) return null;
    node = node[part];
  }
  return node;
}

// List folders/files
app.get('/list', async (req, res) => {
  const pathParam = req.query.path || '';
  console.log(`[LIST] Request path: "${pathParam}"`);

  const tree = await readDirectoryJSON();

  if (!tree || Object.keys(tree).length === 0) {
    console.error('[LIST] directory.json is empty or could not be loaded.');
    return res.status(500).json({ error: 'Failed to load directory.json' });
  }

  console.log(`[LIST] Root keys: ${Object.keys(tree)}`);

  const node = getNodeAtPath(tree, pathParam);
  if (!node) {
    console.error(`[LIST] Path not found: "${pathParam}"`);
    return res.status(404).json({ error: 'Path not found' });
  }

  console.log(`[LIST] Node type: ${Array.isArray(node) ? 'Array' : typeof node}`);
  console.log(`[LIST] Node keys: ${Object.keys(node)}`);

  const items = [];
  for (const key in node) {
    if (key === 'files') {
      for (const file of node.files) {
        items.push({
          name: file,
          isFolder: false,
          path: pathParam ? `${pathParam}/${file}` : file,
        });
      }
    } else {
      items.push({
        name: key,
        isFolder: true,
        path: pathParam ? `${pathParam}/${key}` : key,
      });
    }
  }

  res.json(items);
});

// Fetch file with decryption
app.get('/file', async (req, res) => {
  try {
    const pathParam = req.query.path;
    if (!pathParam) return res.status(400).json({ error: 'Missing path' });

    const fileUrl = `https://najuzi.com/webapp/MobileApp/${encodeURIComponent(pathParam)}`;
    console.log(`[FILE] Fetching: ${fileUrl}`);

    const response = await fetch(fileUrl);
    if (!response.ok) return res.status(response.status).send('File not found');

    let fileBuffer = Buffer.from(await response.arrayBuffer());
    const isEncrypted = pathParam.endsWith('.enc');
    const filename = pathParam.split('/').pop().replace('.enc', '');

    if (isEncrypted) {
      console.log(`[FILE] Decrypting: ${filename}`);
      fileBuffer = decryptFile(fileBuffer);
    }

    res.setHeader('Content-Type', getContentType(filename));
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(fileBuffer);

  } catch (err) {
    console.error('[FILE] Error fetching file:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Decrypt .enc files
function decryptFile(buffer) {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_CONFIG.algorithm,
    ENCRYPTION_CONFIG.key,
    ENCRYPTION_CONFIG.iv
  );
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

// Determine Content-Type
function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return { pdf: 'application/pdf', mp4: 'video/mp4' }[ext] || 'application/octet-stream';
}

// Start server
app.listen(PORT, '0.0.0.0', () => console.log(`Server ready on port ${PORT}`));
