const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3003; // Match with Flutter
const ROOT_DIR = 'D:/MobileApp';
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0); // Fixed IV for AES-256-CTR

app.use(cors());

// AES-256-CTR decryption
function decryptFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);
  return Buffer.concat([decipher.update(fileBuffer), decipher.final()]);
}

// ============  FIXED: Folder Tree Endpoint =============
app.get('/folder-tree', (req, res) => {
  const relative = req.query.folder || '';
  const folderPath = path.resolve(path.join(ROOT_DIR, relative));

  // Normalize both paths for Windows compatibility
  const normalizedRoot = path.resolve(ROOT_DIR).replace(/\\/g, '/');
  const normalizedFolder = folderPath.replace(/\\/g, '/');

  // Prevent path traversal
  if (!normalizedFolder.startsWith(normalizedRoot)) {
    return res.status(400).send('Invalid path');
  }

  try {
    if (!fs.existsSync(folderPath)) {
      return res.status(404).send('Folder not found');
    }

    const items = fs.readdirSync(folderPath).map(name => {
      const fullPath = path.join(folderPath, name);
      const stats = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        type: stats.isDirectory() ? 'folder' : 'file'
      };
    });

    res.json(items);
  } catch (err) {
    console.error('Folder tree error:', err.message);
    res.status(500).send({ error: err.message });
  }
});

// ============ PDF Route ============
app.get('/pdf', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  const normalized = path.normalize(filePath);
  const lower = normalized.toLowerCase();

  if (!fs.existsSync(normalized)) {
    return res.status(404).send('File not found');
  }

  try {
    if (lower.endsWith('.pdf.enc')) {
      const decrypted = decryptFile(normalized);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', decrypted.length);
      res.end(decrypted);
    } else if (lower.endsWith('.pdf')) {
      const stat = fs.statSync(normalized);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(normalized).pipe(res);
    } else {
      res.status(415).send('Unsupported PDF type');
    }
  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).send('Error serving PDF');
  }
});

// ============ Video Route ============
app.get('/video', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  const normalized = path.normalize(filePath);
  const lower = normalized.toLowerCase();

  if (!fs.existsSync(normalized)) {
    return res.status(404).send('File not found');
  }

  try {
    if (lower.endsWith('.mp4.enc')) {
      const decrypted = decryptFile(normalized);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', decrypted.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.end(decrypted);
    } else if (lower.endsWith('.mp4')) {
      const stat = fs.statSync(normalized);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Accept-Ranges', 'bytes');
      fs.createReadStream(normalized).pipe(res);
    } else {
      res.status(415).send('Unsupported video type');
    }
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).send('Error serving video');
  }
});

// ============ Start Server ============
app.listen(PORT, () => {
  console.log(` Media server running at http://localhost:${PORT}`);
});
