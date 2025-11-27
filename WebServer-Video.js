const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3003; 
const ROOT_DIR = 'D:/MobileApp';
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0); // Fixed IV for CTR

app.use(cors());

// ================= BLOCK DOWNLOAD MANAGERS =================
const blockedAgents = [
  "IDM",
  "Internet Download Manager",
  "FDM",
  "Free Download Manager",
  "Wget",
  "curl",
  "aria2"
];

app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (blockedAgents.some(a => ua.toLowerCase().includes(a.toLowerCase()))) {
    return res.status(403).send('Download Manager Blocked');
  }
  next();
});

// ============= KEY GENERATION FOR AES-256 ============
function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

// ============= SAFE PATH CHECKING =====================
function getSafePath(filePath) {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(ROOT_DIR);

  if (!resolved.startsWith(rootResolved)) {
    return null;
  }
  return resolved;
}

// ================= STREAM DECRYPT FUNCTION =================
function streamDecrypt(filePath, res, contentType) {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none'); // prevent IDM range sniffing

  const readStream = fs.createReadStream(filePath);

  readStream
    .pipe(decipher)
    .pipe(res)
    .on('error', err => {
      console.error('Streaming Error:', err.message);
      res.end();
    });
}

// ============= NORMAL STREAM ============================
function streamNormal(filePath, res, contentType) {
  const stats = fs.statSync(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none');

  fs.createReadStream(filePath).pipe(res);
}

// ============ FOLDER TREE ====================
app.get('/folder-tree', (req, res) => {
  const relative = req.query.folder || '';
  const folderPath = getSafePath(path.join(ROOT_DIR, relative));

  if (!folderPath) return res.status(403).send('Invalid path');

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
    console.error(err);
    res.status(500).send('Folder error');
  }
});

// ============ PDF ROUTE (ON-THE-FLY DECRYPT) ============
app.get('/pdf', (req, res) => {
  const input = req.query.path;
  if (!input) return res.status(400).send('Missing file path');

  const filePath = getSafePath(input);
  if (!filePath) return res.status(403).send('Illegal path');

  if (!fs.existsSync(filePath))
    return res.status(404).send('File not found');

  const lower = filePath.toLowerCase();

  try {
    if (lower.endsWith('.pdf.enc')) {
      // ✅ Decrypt and stream live
      return streamDecrypt(filePath, res, 'application/pdf');
    } 

    if (lower.endsWith('.pdf')) {
      // ✅ Stream normal PDF
      return streamNormal(filePath, res, 'application/pdf');
    }

    res.status(415).send('Unsupported PDF type');

  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).send('Server error');
  }
});

// ============ VIDEO ROUTE (ON-THE-FLY DECRYPT) ============
app.get('/video', (req, res) => {
  const input = req.query.path;
  if (!input) return res.status(400).send('Missing file path');

  const filePath = getSafePath(input);
  if (!filePath) return res.status(403).send('Illegal path');

  if (!fs.existsSync(filePath))
    return res.status(404).send('File not found');

  const lower = filePath.toLowerCase();

  try {
    if (lower.endsWith('.mp4.enc')) {
      // ✅ Decrypt and stream live
      return streamDecrypt(filePath, res, 'video/mp4');
    } 

    if (lower.endsWith('.mp4')) {
      // ✅ Stream normal video
      return streamNormal(filePath, res, 'video/mp4');
    }

    res.status(415).send('Unsupported video type');

  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).send('Server error');
  }
});

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.send('Secure Streaming Server is Running...');
});

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`✅ Secure Media Server running at: http://localhost:${PORT}`);
});
