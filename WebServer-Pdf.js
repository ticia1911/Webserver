const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Local path to your directory.json
const DIRECTORY_JSON_PATH = path.join(__dirname, 'webapp', 'MobileApp', 'directory.json');

// Encryption config for .enc files
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-cbc',
  key: crypto.createHash('sha256').update('najuzi0702518998').digest(),
  iv: Buffer.alloc(16, 0),
};

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));

// ----------------------
// Health check
// ----------------------
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ----------------------
// Read JSON helper
// ----------------------
function readDirectoryJSON() {
  try {
    const data = fs.readFileSync(DIRECTORY_JSON_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading directory.json:', err.message);
    return {};
  }
}

// ----------------------
// Recursive lookup for a path
// ----------------------
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

// ----------------------
// List folders/files dynamically
// ----------------------
app.get('/list', (req, res) => {
  const pathParam = req.query.path || '';
  const tree = readDirectoryJSON();
  const node = getNodeAtPath(tree, pathParam);

  if (!node) return res.status(404).json({ error: 'Path not found' });

  const items = [];

  for (const key in node) {
    if (key === 'files') {
      // Add files
      for (const file of node.files) {
        items.push({
          name: file,
          isFolder: false,
          path: pathParam ? `${pathParam}/${file}` : file,
        });
      }
    } else {
      // Add folder
      items.push({
        name: key,
        isFolder: true,
        path: pathParam ? `${pathParam}/${key}` : key,
      });
    }
  }

  res.json(items);
});

// ----------------------
// Fetch PDF/MP4 file with decryption for .enc
// ----------------------
app.get('/file', async (req, res) => {
  try {
    const pathParam = req.query.path;
    if (!pathParam) return res.status(400).json({ error: 'Missing path parameter' });

    const filePath = path.join(__dirname, 'webapp', 'MobileApp', pathParam);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    let fileBuffer = fs.readFileSync(filePath);
    const isEncrypted = filePath.endsWith('.enc');
    const filename = path.basename(filePath).replace('.enc', '');

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
