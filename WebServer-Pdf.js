const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

// Dynamic fetch import
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// This is your Namecheap hosting URL where PDFs/videos are stored
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Encryption config
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-cbc',
  key: crypto.createHash('sha256').update('najuzi0702518998').digest(),
  iv: Buffer.alloc(16, 0)
};

// HTTPS agent
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 15000
});

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <h1>Najuzi Web Server is running</h1>
    <p>Endpoints:</p>
    <ul>
      <li><a href="/ping">/ping</a> - Health check</li>
      <li>/list?path=&lt;relative_path&gt; - List files/folders</li>
      <li>/file?path=&lt;encoded_url&gt; - Fetch file (PDF, MP4, or encrypted)</li>
    </ul>
  `);
});

// Health endpoint
app.get('/ping', (req, res) => res.status(200).send('pong'));

// List files/folders endpoint
app.get('/list', async (req, res) => {
  try {
    const pathParam = req.query.path || ''; // relative folder path
    const folderUrl = new URL(pathParam, ROOT_URL).href;

    console.log(`Listing folder: ${folderUrl}`);

    const response = await fetch(folderUrl, { agent: httpsAgent });
    if (!response.ok) return res.status(response.status).send('Cannot fetch folder');

    const htmlText = await response.text();

    // Simple regex to extract href links from the directory listing HTML
    const regex = /href="([^"]+)"/g;
    let match;
    const items = [];
    while ((match = regex.exec(htmlText)) !== null) {
      const name = decodeURIComponent(match[1]);
      if (name !== '../') {
        items.push({
          name,
          isFolder: name.endsWith('/')
        });
      }
    }

    res.json(items);
  } catch (err) {
    console.error('Error listing folder:', err.message);
    res.status(500).json({ error: 'Failed to list folder', details: err.message });
  }
});

// File fetch endpoint
app.get('/file', async (req, res) => {
  try {
    const pathParam = req.query.path;
    if (!pathParam) return res.status(400).json({ error: 'Missing path parameter' });

    const fileUrl = new URL(pathParam, ROOT_URL).href;

    if (!fileUrl.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access to this domain not allowed' });
    }

    console.log(`Fetching file: ${fileUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(fileUrl, {
        agent: httpsAgent,
        signal: controller.signal,
        headers: { 'User-Agent': 'NajuziResourceLoader/1.0' }
      });
    } catch (err) {
      console.error(`Fetch error: ${err.message}`);
      return res.status(502).json({ error: 'Could not retrieve file', details: err.message });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return res.status(response.status).send('Remote server error');

    const fileBuffer = await response.buffer();
    const isEncrypted = fileUrl.endsWith('.enc');

    if (isEncrypted) {
      try {
        const decrypted = decryptFile(fileBuffer);
        const filename = fileUrl.split('/').pop().replace('.enc', '');
        res.setHeader('Content-Type', getContentType(filename));
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.send(decrypted);
      } catch (err) {
        console.error('Decryption failed:', err.message);
        return res.status(500).json({ error: 'Decryption failed', details: err.message });
      }
    } else {
      const filename = fileUrl.split('/').pop();
      res.setHeader('Content-Type', getContentType(filename));
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(fileBuffer);
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Decrypt function
function decryptFile(encryptedBuffer) {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_CONFIG.algorithm,
    ENCRYPTION_CONFIG.key,
    ENCRYPTION_CONFIG.iv
  );
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

// Get content type
function getContentType(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  const types = { pdf: 'application/pdf', mp4: 'video/mp4' };
  return types[extension] || 'application/octet-stream';
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ready on port ${PORT}`);
});
