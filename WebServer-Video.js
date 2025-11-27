const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3003;
const ROOT_DIR = 'D:/MobileApp';
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

app.use(cors());

// ============= BLOCK DOWNLOAD MANAGERS ===============
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
    return res.status(403).send('Blocked download manager');
  }
  next();
});

// ============= AES KEY =================
function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

// ============= PATH SECURITY =================
function getSafePath(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(ROOT_DIR);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

// ============= FOLDER TREE =================
app.get('/folder-tree', (req, res) => {
  const relative = req.query.folder || '';
  const folderPath = getSafePath(path.join(ROOT_DIR, relative));

  if (!folderPath) return res.status(403).send('Invalid path');
  if (!fs.existsSync(folderPath)) return res.status(404).send('Folder not found');

  try {
    const items = fs.readdirSync(folderPath).map(name => {
      const full = path.join(folderPath, name);
      const stats = fs.statSync(full);

      return {
        name,
        path: full,
        type: stats.isDirectory() ? 'folder' : 'file'
      };
    });

    res.json(items);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ============= PDF STREAM =================
app.get('/pdf', (req, res) => {
  const input = req.query.path;
  if (!input) return res.status(400).send('Missing path');

  const filePath = getSafePath(input);
  if (!filePath) return res.status(403).send('Illegal path');
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const lower = filePath.toLowerCase();
  const key = getKey();

  try {
    if (lower.endsWith('.pdf.enc')) {
      const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(filePath).pipe(decipher).pipe(res);
    }

    else if (lower.endsWith('.pdf')) {
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(filePath).pipe(res);
    }

    else {
      res.status(415).send('Unsupported PDF');
    }

  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ============= ✅ FIXED VIDEO STREAM WITH RANGE + DECRYPT ============
app.get('/video', (req, res) => {
  const input = req.query.path;
  if (!input) return res.status(400).send('Missing file path');

  const filePath = getSafePath(input);
  if (!filePath) return res.status(403).send('Illegal path');
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const lower = filePath.toLowerCase();
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  const range = req.headers.range;

  if (!range) {
    res.status(416).send("Range header required");
    return;
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, fileSize - 1);
  const chunkSize = (end - start) + 1;

  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store"
  });

  const stream = fs.createReadStream(filePath, { start, end });

  if (lower.endsWith(".enc")) {
    stream.pipe(decipher).pipe(res);
  } else {
    stream.pipe(res);
  }
});

// ============= HEALTH ============
app.get('/', (req, res) => {
  res.send('✅ Secure Encrypted Media Server Running');
});

// ============= START =============
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
