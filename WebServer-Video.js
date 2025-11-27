const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3003;

// ================= CONFIG =================
const ROOT_DIR = 'D:/MobileApp';
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);
const ALLOWED_DOMAIN = "http://localhost:3000"; // Your Flutter Web / App URL

app.use(cors({ origin: ALLOWED_DOMAIN }));

/* ================= RATE LIMIT ================= */
app.use(
  rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: "Too many requests"
  })
);

/* ================= BLOCK DOWNLOAD MANAGERS ================= */
const blockedAgents = [
  "IDM",
  "Internet Download Manager",
  "FDM",
  "Free Download Manager",
  "Wget",
  "curl",
  "aria2",
  "ADM",
  "Xtreme Download Manager",
  "electron"
];

app.use((req, res, next) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (blockedAgents.some(a => ua.includes(a.toLowerCase()))) {
    return res.status(403).send('❌ Download manager blocked');
  }
  next();
});

/* ================= ALLOW ONLY YOUR APP ================= */
app.use((req, res, next) => {
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';

  if (!referer.includes(ALLOWED_DOMAIN) && !origin.includes(ALLOWED_DOMAIN)) {
    return res.status(403).send("❌ Direct access blocked");
  }
  next();
});

/* ================= AES KEY ================= */
function getKey() {
  return crypto.createHash('sha256').update(SECRET_KEY).digest();
}

/* ================= PATH SECURITY ================= */
function getSafePath(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(ROOT_DIR);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

/* ================= FOLDER TREE ================= */
app.get('/folder-tree', (req, res) => {
  const relative = req.query.folder || '';
  const folderPath = getSafePath(path.join(ROOT_DIR, relative));

  if (!folderPath) return res.status(403).send('Invalid path');
  if (!fs.existsSync(folderPath)) return res.status(404).send('Folder not found');

  try {
    const items = fs.readdirSync(folderPath).map(name => {
      const full = path.join(folderPath, name);
      const stats = fs.statSync(full);

      let type = stats.isDirectory() ? 'folder' : 'file';

      if (name.toLowerCase().endsWith('.mp4.enc')) type = 'video';
      if (name.toLowerCase().endsWith('.pdf.enc')) type = 'pdf';

      return {
        name,
        path: full.replace(ROOT_DIR, "").replace(/\\/g, "/"),
        type
      };
    });

    res.json(items);

  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= PDF STREAM ================= */
app.get('/pdf', (req, res) => {

  if (req.headers.range) {
    return res.status(403).send("❌ Range requests blocked");
  }

  const raw = req.query.path;
  if (!raw) return res.status(400).send('Missing path');

  const fullPath = getSafePath(path.join(ROOT_DIR, raw));
  if (!fullPath) return res.status(403).send('Illegal path');
  if (!fs.existsSync(fullPath)) return res.status(404).send('File not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none');

  try {
    const key = getKey();

    const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);
    fs.createReadStream(fullPath).pipe(decipher).pipe(res);

  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= VIDEO STREAM (.mp4.enc ONLY) ================= */
app.get('/video', (req, res) => {

  if (req.headers.range) {
    return res.status(403).send("❌ Range requests blocked");
  }

  const raw = req.query.path;
  if (!raw) return res.status(400).send('Missing file path');

  const fullPath = getSafePath(path.join(ROOT_DIR, raw));
  if (!fullPath) return res.status(403).send('Illegal path');
  if (!fs.existsSync(fullPath)) return res.status(404).send('File not found');

  if (!fullPath.toLowerCase().endsWith('.mp4.enc')) {
    return res.status(415).send("Only encrypted videos allowed");
  }

  try {
    const key = getKey();

    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "none",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    const decipher = crypto.createDecipheriv('aes-256-ctr', key, IV);
    fs.createReadStream(fullPath).pipe(decipher).pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).send("Video decryption error");
  }

});

/* ================= HEALTH ================= */
app.get('/', (req, res) => {
  res.send('✅ Secure Encrypted Media Server Running...');
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
