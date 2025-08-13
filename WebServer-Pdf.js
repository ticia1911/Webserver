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
const ROOT_URL = 'https://webserver-zpgc.onrender.com';

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

// Root endpoint (fixes Cannot GET /)
app.get('/', (req, res) => {
  res.send(`
    <h1>Najuzi Web Server is running</h1>
    <p>Endpoints:</p>
    <ul>
      <li><a href="/ping">/ping</a> - Health check</li>
      <li>/file?path=&lt;encoded_url&gt; - Fetch file (PDF, MP4, or encrypted)</li>
    </ul>
  `);
});

// Health endpoint
app.get('/ping', (req, res) => res.status(200).send('pong'));

// File fetch endpoint
app.get('/file', async (req, res) => {
  try {
    const pathParam = req.query.path;
    if (!pathParam) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    let fileUrl;
    try {
      fileUrl = new URL(decodeURIComponent(pathParam.trim()));
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (!fileUrl.href.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access to this domain not allowed' });
    }

    console.log(`Processing file: ${fileUrl.href}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(fileUrl.href, {
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

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`Remote error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: 'Remote server error',
        status: response.status,
        details: errorText
      });
    }

    const fileBuffer = await response.buffer();
    const isEncrypted = fileUrl.pathname.endsWith('.enc');

    if (isEncrypted) {
      try {
        const decrypted = decryptFile(fileBuffer);
        const filename = fileUrl.pathname.split('/').pop().replace('.enc', '');
        res.setHeader('Content-Type', getContentType(filename));
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.send(decrypted);
      } catch (err) {
        console.error('Decryption failed:', err.message);
        return res.status(500).json({ error: 'Decryption failed', details: err.message });
      }
    } else {
      const filename = fileUrl.pathname.split('/').pop();
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
  const types = {
    pdf: 'application/pdf',
    mp4: 'video/mp4'
  };
  return types[extension] || 'application/octet-stream';
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ready on port ${PORT}`);
});

