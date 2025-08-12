const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
// Use the port provided by the environment (Render sets this) or fallback to 3002 locally
const PORT = process.env.PORT || 10000;

// IMPORTANT: Adjust these paths to relative or absolute paths on your deployment server,
// because "D:/..." is Windows-specific and won't exist on Render (which uses Linux).
// For deployment, place your files inside the project or mounted volume.
// Example:
const TEACHER_UPLOADS_DIR = path.join(__dirname, 'teacher_uploads');
const PDFJS_PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = path.join(__dirname, 'MobileApp');

const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

app.use(cors());
app.use('/public', express.static(PDFJS_PUBLIC_DIR));

if (!fs.existsSync(TEACHER_UPLOADS_DIR)) {
  fs.mkdirSync(TEACHER_UPLOADS_DIR, { recursive: true });
  console.log(`Created directory: ${TEACHER_UPLOADS_DIR}`);
}

// Add root route to avoid "Cannot GET /"
app.get('/', (req, res) => {
  res.send('Welcome to the Najuzi PDF and Video Server!');
});

// ========== Teacher Upload ==========
const upload = multer({ dest: path.join(TEACHER_UPLOADS_DIR, 'temp') });

app.post('/teacher-upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No file uploaded');

  const targetPath = path.join(TEACHER_UPLOADS_DIR, file.originalname);
  fs.rename(file.path, targetPath, err => {
    if (err) return res.status(500).send('Failed to save file');
    res.send({ success: true, filename: file.originalname });
  });
});

// ========== Decryption ==========
function decryptFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const key = Buffer.from(
    crypto.createHash('sha256').update(SECRET_KEY).digest('base64').substring(0, 32),
    'utf-8'
  );
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
  return Buffer.concat([decipher.update(fileBuffer), decipher.final()]);
}

// ========== Build File Tree ==========
function buildFileTree(currentPath, allowedExts = ['.pdf', '.pdf.enc']) {
  const name = path.basename(currentPath);
  const stats = fs.statSync(currentPath);

  if (stats.isDirectory()) {
    const children = fs.readdirSync(currentPath)
      .map(child => buildFileTree(path.join(currentPath, child), allowedExts))
      .filter(Boolean);
    return { type: 'folder', name, path: currentPath.replace(/\\/g, '/'), children };
  } else {
    const lower = name.toLowerCase();
    if (!allowedExts.some(ext => lower.endsWith(ext))) return null;

    return {
      type: 'file',
      name,
      path: currentPath.replace(/\\/g, '/'),
    };
  }
}

// ========== Folder Tree API ==========
app.get('/folder-tree', (req, res) => {
  const relative = req.query.folder;
  if (!relative) return res.status(400).send('Missing folder name');

  try {
    const decoded = decodeURIComponent(relative);
    const normalized = path.normalize(decoded);
    const absolutePath = path.join(ROOT_DIR, normalized);

    if (!fs.existsSync(absolutePath)) return res.status(404).send('Folder not found');

    // Decide allowed extensions based on folder path
    const lowerPath = relative.toLowerCase();
    const allowedExts = lowerPath.includes('videos')
      ? ['.mp4', '.mp4.enc']
      : ['.pdf', '.pdf.enc'];

    const tree = fs.readdirSync(absolutePath)
      .map(child => buildFileTree(path.join(absolutePath, child), allowedExts))
      .filter(Boolean);

    res.json(tree);
  } catch (err) {
    console.error('Error building folder tree:', err.message);
    res.status(500).send('Error building folder tree');
  }
});

// ========== Teacher Files Tree ==========
app.get('/teacher-files', (req, res) => {
  if (!fs.existsSync(TEACHER_UPLOADS_DIR)) return res.json([]);

  try {
    const tree = fs.readdirSync(TEACHER_UPLOADS_DIR)
      .map(item => buildFileTree(path.join(TEACHER_UPLOADS_DIR, item), ['.pdf', '.pdf.enc']))
      .filter(Boolean);
    res.json(tree);
  } catch (err) {
    console.error('Error building teacher-files tree:', err.message);
    res.status(500).send('Error building file tree');
  }
});

// ========== Serve File ==========
app.get('/file', (req, res) => {
  let filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  try {
    filePath = decodeURIComponent(filePath);
    filePath = path.normalize(filePath);

    const allowedRoot = [ROOT_DIR, TEACHER_UPLOADS_DIR].some(rootDir => {
      const relative = path.relative(rootDir, filePath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });

    if (!allowedRoot) {
      return res.status(403).send('Access denied: file not in allowed directories');
    }

    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    const lower = filePath.toLowerCase();

    if (lower.endsWith('.pdf.enc')) {
      const decrypted = decryptFile(filePath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', decrypted.length);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.end(decrypted);
    } else if (lower.endsWith('.pdf')) {
      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Accept-Ranges', 'bytes');
      return fs.createReadStream(filePath).pipe(res);
    } else if (lower.endsWith('.mp4') || lower.endsWith('.mp4.enc')) {
      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Accept-Ranges', 'bytes');
      return fs.createReadStream(filePath).pipe(res);
    } else {
      return res.status(415).send('Unsupported file type');
    }
  } catch (err) {
    console.error('[file] Error:', err.message);
    res.status(500).send('Error serving file');
  }
});

app.get('/secure-file', (req, res) => {
  const filePath = req.query.path;
  const token = req.query.token;
  if (!validToken(token)) return res.status(403).send('Access denied');
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/pdf');
  fs.createReadStream(filePath).pipe(res);
});

function validToken(token) {
  const VALID_TOKENS = ['secret123', 'najuzi-access'];
  return VALID_TOKENS.includes(token);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

