const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 10000;

// URLs for externally hosted files
const TEACHER_UPLOADS_URL = 'https://najuzi.com/webapp/teacher_uploads';
const PDFJS_PUBLIC_URL = 'https://najuzi.com/webapp/public';
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Local folder for teacher uploads (on Render)
const TEACHER_UPLOADS_DIR = path.join(__dirname, 'teacher_uploads');

// Encryption config
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

app.use(cors());

// Ensure teacher uploads directory exists
if (!fs.existsSync(TEACHER_UPLOADS_DIR)) {
  fs.mkdirSync(TEACHER_UPLOADS_DIR, { recursive: true });
  console.log(`Created directory: ${TEACHER_UPLOADS_DIR}`);
}

// Root route
app.get('/', (req, res) => {
  res.send('Welcome to the Najuzi PDF Server!');
});

// ========= Teacher Upload =========
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

// ========= Decryption =========
function decryptFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const key = Buffer.from(
    crypto.createHash('sha256').update(SECRET_KEY).digest('base64').substring(0, 32),
    'utf-8'
  );
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
  return Buffer.concat([decipher.update(fileBuffer), decipher.final()]);
}

// ========= Folder Tree API (returns URLs instead of local files) =========
app.get('/folder-tree', (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.status(400).send('Missing folder name');

  try {
    const lower = folder.toLowerCase();
    const baseUrl = `${ROOT_URL}/${encodeURIComponent(folder)}`;
    const allowedExts = lower.includes('videos')
      ? ['.mp4', '.mp4.enc']
      : ['.pdf', '.pdf.enc'];

    // Return sample URLs (since we can't read Namecheap FS)
    const fakeFiles = allowedExts.map(ext => ({
      type: 'file',
      name: `example${ext}`,
      url: `${baseUrl}/example${ext}`
    }));

    res.json(fakeFiles);
  } catch (err) {
    console.error('Error building folder tree:', err.message);
    res.status(500).send('Error building folder tree');
  }
});

// ========= Teacher Files Tree (local files on Render) =========
function buildFileTree(currentPath, allowedExts) {
  const name = path.basename(currentPath);
  const stats = fs.statSync(currentPath);

  if (stats.isDirectory()) {
    const children = fs.readdirSync(currentPath)
      .map(child => buildFileTree(path.join(currentPath, child), allowedExts))
      .filter(Boolean);
    return { type: 'folder', name, path: currentPath, children };
  } else {
    const lower = name.toLowerCase();
    if (!allowedExts.some(ext => lower.endsWith(ext))) return null;
    return { type: 'file', name, path: currentPath };
  }
}

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

// ========= Secure Local File Serving (teacher uploads only) =========
app.get('/file', (req, res) => {
  let filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  try {
    filePath = decodeURIComponent(filePath);
    filePath = path.normalize(filePath);

    if (!filePath.startsWith(TEACHER_UPLOADS_DIR)) {
      return res.status(403).send('Access denied');
    }

    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    const lower = filePath.toLowerCase();

    if (lower.endsWith('.pdf.enc')) {
      const decrypted = decryptFile(filePath);
      res.setHeader('Content-Type', 'application/pdf');
      return res.end(decrypted);
    } else if (lower.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      return fs.createReadStream(filePath).pipe(res);
    } else if (lower.endsWith('.mp4') || lower.endsWith('.mp4.enc')) {
      res.setHeader('Content-Type', 'video/mp4');
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

