const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Base URL for Namecheap storage, set to your desired root folder
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp/AGRICULTURE/NOTES/1.SENIOR 1/TERM 1/INTRODUCTION TO AGRICULTURE/1. HISTORICAL BACKGROUND OF AGRICULTURE/';

// Encryption config for .enc files
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-cbc',
  key: crypto.createHash('sha256').update('najuzi0702518998').digest(),
  iv: Buffer.alloc(16, 0),
};

// HTTPS agent
const httpsAgent = new https.Agent({ rejectUnauthorized: false, timeout: 15000 });

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));

// ----------------------
// Health check
// ----------------------
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ----------------------
// List folders/files dynamically
// ----------------------
app.get('/list', async (req, res) => {
  try {
    // Path relative to ROOT_URL
    const pathParam = req.query.path || '';
    const folderUrl = new URL(pathParam, ROOT_URL).href;
    console.log(`Listing folder: ${folderUrl}`);

    const response = await fetch(folderUrl, { agent: httpsAgent });
    if (!response.ok) return res.status(response.status).send('Cannot fetch folder');

    const htmlText = await response.text();

    // Parse all href links from HTML
    const regex = /href="([^"]+)"/g;
    const items = [];
    let match;

    while ((match = regex.exec(htmlText)) !== null) {
      const name = decodeURIComponent(match[1]);
      if (name !== '../') {
        items.push({
          name,
          isFolder: name.endsWith('/'),
          path: pathParam ? `${pathParam}/${name}` : name, // full relative path
        });
      }
    }

    res.json(items); // Flutter can render buttons from this JSON
  } catch (err) {
    console.error('Error listing folder:', err.message);
    res.status(500).json({ error: 'Failed to list folder', details: err.message });
  }
});

// ----------------------
// Fetch PDF or MP4 (with decryption for .enc)
// ----------------------
app.get('/file', async (req, res) => {
  try {
    const pathParam = req.query.path;
    if (!pathParam) return res.status(400).json({ error: 'Missing path parameter' });

    const fileUrl = new URL(pathParam, ROOT_URL).href;
    console.log(`Fetching file: ${fileUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(fileUrl, { agent: httpsAgent, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return res.status(response.status).send('Remote server error');

    let fileBuffer = await response.buffer();
    const isEncrypted = fileUrl.endsWith('.enc');
    const filename = fileUrl.split('/').pop().replace('.enc', '');

    if (isEncrypted) fileBuffer = decryptFile(fileBuffer);

    res.setHeader('Content-Type', getContentType(filename));
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(fileBuffer);
  } catch (err) {
    console.error('Error fetching file:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ----------------------
// Decrypt .enc files
// ----------------------
function decryptFile(encryptedBuffer) {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_CONFIG.algorithm,
    ENCRYPTION_CONFIG.key,
    ENCRYPTION_CONFIG.iv
  );
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

// ----------------------
// Determine Content-Type
// ----------------------
function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return { pdf: 'application/pdf', mp4: 'video/mp4' }[ext] || 'application/octet-stream';
}

// ----------------------
// Start server
// ----------------------
app.listen(PORT, '0.0.0.0', () => console.log(`Server ready on port ${PORT}`));
