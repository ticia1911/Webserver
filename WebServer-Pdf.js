const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// Use require for node-fetch (CommonJS)
const fetch = require('node-fetch');

const app = express();

// ✅ Use Render's PORT or fallback to 10000
const PORT = process.env.PORT || 10000;

// ✅ Cleaned URLs (no trailing spaces)
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Encryption config
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0); // Initialization vector

app.use(cors());
app.use(express.json());

// ================================
// === Root Route
// ================================
app.get('/', (req, res) => {
  res.send('Welcome to the Najuzi PDF Server! 🚀<br>Ready to serve encrypted files from najuzi.com');
});

// ================================
// === Dynamic Folder Tree API
// ================================
app.get('/folder-tree', async (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.status(400).send('Missing folder name');

  try {
    const decodedFolder = decodeURIComponent(folder).trim();

    // Sanitize folder name to prevent path traversal
    const safeFolder = decodedFolder.replace(/[^a-zA-Z0-9_\-/]/g, '');
    if (!safeFolder) return res.status(400).send('Invalid folder name');

    const url = `${ROOT_URL}/${safeFolder}/`.replace(/\/+/g, '/');

    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      console.error(`[folder-tree] Failed to connect to remote server: ${url}`, err.message);
      return res.status(502).send('Failed to reach remote server');
    }

    if (!response.ok) {
      return res.status(404).send('Folder not found on remote server');
    }

    const text = await response.text();

    // Parse HTML directory listing (AutoIndex format)
    const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
    const matches = [...text.matchAll(regex)];
    const items = [];

    for (const m of matches) {
      const href = m[1];
      const name = m[2].trim();

      // Skip parent directory link
      if (name === 'Parent Directory' || href === '../') continue;

      const isFolder = href.endsWith('/');
      const itemUrl = `${ROOT_URL}/${safeFolder}/${href}`.replace(/\/+/g, '/');

      if (isFolder) {
        items.push({
          type: 'folder',
          name: name,
          path: itemUrl,
        });
      } else {
        // Only include supported file types
        if (
          name.endsWith('.pdf.enc') ||
          name.endsWith('.pdf') ||
          name.endsWith('.mp4.enc') ||
          name.endsWith('.mp4')
        ) {
          items.push({
            type: 'file',
            name: name,
            path: itemUrl,
            url: itemUrl,
          });
        }
      }
    }

    res.json(items);
  } catch (err) {
    console.error('[folder-tree] Error:', err.message);
    res.status(500).send('Failed to fetch folder structure');
  }
});

// ================================
// === Proxy & Decrypt Remote Files
// ================================
app.get('/file', async (req, res) => {
  let filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  try {
    filePath = decodeURIComponent(filePath.trim());

    if (!filePath.startsWith('http')) {
      return res.status(400).send('Invalid URL: must start with http');
    }

    // Sanitize and validate URL
    let response;
    try {
      response = await fetch(filePath);
    } catch (err) {
      console.error(`[file] Failed to fetch: ${filePath}`, err.message);
      return res.status(502).send('Failed to download file');
    }

    if (!response.ok) {
      return res.status(404).send('File not found on remote server');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Handle file type
    if (filePath.endsWith('.pdf.enc')) {
      const decrypted = decryptBuffer(buffer);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      return res.send(decrypted);
    } else if (filePath.endsWith('.mp4.enc')) {
      const decrypted = decryptBuffer(buffer);
      res.setHeader('Content-Type', 'video/mp4');
      return res.send(decrypted);
    } else if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      return res.send(buffer);
    } else if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      return res.send(buffer);
    } else {
      return res.status(415).send('Unsupported file type. Only .pdf, .pdf.enc, .mp4, .mp4.enc allowed.');
    }
  } catch (err) {
    console.error('[proxy-file] Unexpected error:', err.message);
    res.status(500).send('Error fetching or decrypting file');
  }
});

// ================================
// === Buffer Decryption Function
// ================================
function decryptBuffer(buffer) {
  try {
    const key = Buffer.from(
      crypto.createHash('sha256').update(SECRET_KEY).digest('base64').substring(0, 32),
      'utf-8'
    );
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
    const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]);
    return decrypted;
  } catch (err) {
    console.error('[decrypt] Decryption failed:', err.message);
    throw new Error('Decryption failed - check encryption key or file integrity');
  }
}

// ================================
// === Start Server
// ================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Access your service at: https://webserver-zpgc.onrender.com`);
});

// Optional: Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
});
