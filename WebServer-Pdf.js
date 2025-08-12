const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

// Modern node-fetch import for Node.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Encryption config
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

// HTTPS agent with timeout
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  timeout: 10000
});

// CORS configuration
app.use(cors());
app.use(express.json());

// Root Route
app.get('/', (req, res) => {
  res.send('Welcome to the Najuzi PDF Server! 🚀<br>Ready to serve encrypted files from najuzi.com');
});

// Folder Tree API
app.get('/folder-tree', async (req, res) => {
  if (!req.query.folder) return res.status(400).json({ error: 'Missing folder parameter' });

  try {
    const folderPath = decodeURIComponent(req.query.folder).trim();
    const safePath = folderPath.replace(/[^a-zA-Z0-9_\-/]/g, '');
    
    if (!safePath) return res.status(400).json({ error: 'Invalid folder path' });

    const targetUrl = `${ROOT_URL}/${safePath}/`.replace(/\/+/g, '/');
    console.log('Fetching folder:', targetUrl);

    const response = await fetch(targetUrl, { agent: httpsAgent });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch folder (${response.status})` 
      });
    }

    const html = await response.text();
    const items = parseDirectoryListing(html, safePath);
    
    res.json(items);
  } catch (err) {
    console.error('Folder error:', err);
    res.status(500).json({ error: 'Server error while fetching folder' });
  }
});

// File Proxy Endpoint
app.get('/file', async (req, res) => {
  if (!req.query.path) return res.status(400).json({ error: 'Missing path parameter' });

  try {
    const fileUrl = decodeURIComponent(req.query.path.trim());
    
    if (!fileUrl.startsWith(ROOT_URL)) {
      return res.status(403).json({ error: 'Access to this domain not allowed' });
    }

    console.log('Fetching file:', fileUrl);
    const response = await fetch(fileUrl, { agent: httpsAgent });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `File not found (${response.status})` 
      });
    }

    const buffer = await response.buffer();
    
    if (fileUrl.endsWith('.enc')) {
      const decrypted = decryptBuffer(buffer);
      const filename = fileUrl.split('/').pop().replace('.enc', '');
      res.setHeader('Content-Type', getContentType(filename));
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(decrypted);
    } else {
      const filename = fileUrl.split('/').pop();
      res.setHeader('Content-Type', getContentType(filename));
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(buffer);
    }
  } catch (err) {
    console.error('File error:', err);
    res.status(500).json({ error: 'Error processing file' });
  }
});

// Helper functions
function parseDirectoryListing(html, basePath) {
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
  const items = [];
  
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const name = match[2].trim();

    if (name === 'Parent Directory' || href === '../') continue;

    const isFolder = href.endsWith('/');
    const fullUrl = `${ROOT_URL}/${basePath}/${href}`.replace(/\/+/g, '/');

    if (isFolder) {
      items.push({
        type: 'folder',
        name: name,
        path: fullUrl
      });
    } else if (isSupportedFile(name)) {
      items.push({
        type: 'file',
        name: name,
        path: fullUrl,
        url: `/file?path=${encodeURIComponent(fullUrl)}`
      });
    }
  }
  
  return items;
}

function isSupportedFile(filename) {
  return /\.(pdf|mp4)(\.enc)?$/i.test(filename);
}

function getContentType(filename) {
  if (filename.endsWith('.pdf')) return 'application/pdf';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function decryptBuffer(buffer) {
  try {
    const key = crypto.createHash('sha256')
      .update(SECRET_KEY)
      .digest()
      .slice(0, 32);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  } catch (err) {
    console.error('Decryption failed:', err);
    throw new Error('File decryption error');
  }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Access at: https://webserver-zpgc.onrender.com`);
});
