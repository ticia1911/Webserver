const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
// const multer = require('multer'); // Commented out since we're not using uploads

const app = express();
const PORT = process.env.PORT || 10000;

// URLs for externally hosted files
const TEACHER_UPLOADS_URL = 'https://najuzi.com/webapp/teacher_uploads';
const PDFJS_PUBLIC_URL = 'https://najuzi.com/webapp/public';
const ROOT_URL = 'https://najuzi.com/webapp/MobileApp';

// Local folder for teacher uploads (on Render)
// const TEACHER_UPLOADS_DIR = path.join(__dirname, 'teacher_uploads');

// Encryption config
const SECRET_KEY = 'najuzi0702518998';
const IV = Buffer.alloc(16, 0);

app.use(cors());

// ========================================================
// === COMMENTED OUT: Teacher Uploads & Local File System ===
// ========================================================

// // Ensure teacher uploads directory exists
// if (!fs.existsSync(TEACHER_UPLOADS_DIR)) {
//   fs.mkdirSync(TEACHER_UPLOADS_DIR, { recursive: true });
//   console.log(`Created directory: ${TEACHER_UPLOADS_DIR}`);
// }

// // ========= Teacher Upload =========
// const upload = multer({ dest: path.join(TEACHER_UPLOADS_DIR, 'temp') });

// app.post('/teacher-upload', upload.single('file'), (req, res) => {
//   const file = req.file;
//   if (!file) return res.status(400).send('No file uploaded');

//   const targetPath = path.join(TEACHER_UPLOADS_DIR, file.originalname);
//   fs.rename(file.path, targetPath, err => {
//     if (err) return res.status(500).send('Failed to save file');
//     res.send({ success: true, filename: file.originalname });
//   });
// });

// // ========= Decryption (Local Only) =========
// function decryptFile(filePath) {
//   const fileBuffer = fs.readFileSync(filePath);
//   const key = Buffer.from(
//     crypto.createHash('sha256').update(SECRET_KEY).digest('base64').substring(0, 32),
//     'utf-8'
//   );
//   const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
//   return Buffer.concat([decipher.update(fileBuffer), decipher.final()]);
// }

// // ========= Teacher Files Tree (local files on Render) =========
// function buildFileTree(currentPath, allowedExts) {
//   const name = path.basename(currentPath);
//   const stats = fs.statSync(currentPath);

//   if (stats.isDirectory()) {
//     const children = fs.readdirSync(currentPath)
//       .map(child => buildFileTree(path.join(currentPath, child), allowedExts))
//       .filter(Boolean);
//     return { type: 'folder', name, path: currentPath, children };
//   } else {
//     const lower = name.toLowerCase();
//     if (!allowedExts.some(ext => lower.endsWith(ext))) return null;
//     return { type: 'file', name, path: currentPath };
//   }
// }

// app.get('/teacher-files', (req, res) => {
//   if (!fs.existsSync(TEACHER_UPLOADS_DIR)) return res.json([]);
//   try {
//     const tree = fs.readdirSync(TEACHER_UPLOADS_DIR)
//       .map(item => buildFileTree(path.join(TEACHER_UPLOADS_DIR, item), ['.pdf', '.pdf.enc']))
//       .filter(Boolean);
//     res.json(tree);
//   } catch (err) {
//     console.error('Error building teacher-files tree:', err.message);
//     res.status(500).send('Error building file tree');
//   }
// });

// // ========= Secure Local File Serving (teacher uploads only) =========
// app.get('/file', (req, res) => {
//   let filePath = req.query.path;
//   if (!filePath) return res.status(400).send('Missing file path');

//   try {
//     filePath = decodeURIComponent(filePath);
//     filePath = path.normalize(filePath);

//     if (!filePath.startsWith(TEACHER_UPLOADS_DIR)) {
//       return res.status(403).send('Access denied');
//     }

//     if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

//     const lower = filePath.toLowerCase();

//     if (lower.endsWith('.pdf.enc')) {
//       const decrypted = decryptFile(filePath);
//       res.setHeader('Content-Type', 'application/pdf');
//       return res.end(decrypted);
//     } else if (lower.endsWith('.pdf')) {
//       res.setHeader('Content-Type', 'application/pdf');
//       return fs.createReadStream(filePath).pipe(res);
//     } else if (lower.endsWith('.mp4') || lower.endsWith('.mp4.enc')) {
//       res.setHeader('Content-Type', 'video/mp4');
//       return fs.createReadStream(filePath).pipe(res);
//     } else {
//       return res.status(415).send('Unsupported file type');
//     }
//   } catch (err) {
//     console.error('[file] Error:', err.message);
//     res.status(500).send('Error serving file');
//   }
// });

// app.get('/secure-file', (req, res) => {
//   const filePath = req.query.path;
//   const token = req.query.token;
//   if (!validToken(token)) return res.status(403).send('Access denied');
//   if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not found');

//   res.setHeader('Cache-Control', 'no-store');
//   res.setHeader('Content-Type', 'application/pdf');
//   fs.createReadStream(filePath).pipe(res);
// });

// function validToken(token) {
//   const VALID_TOKENS = ['secret123', 'najuzi-access'];
//   return VALID_TOKENS.includes(token);
// }

// ========================================================
// === NEW: Allow Remote File Proxying & Dynamic Tree ===
// ========================================================

// Use node-fetch to fetch remote directory HTML
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ========= Dynamic Folder Tree from Remote Server =========
app.get('/folder-tree', async (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.status(400).send('Missing folder name');

  try {
    const decodedFolder = decodeURIComponent(folder).trim();
    const safeFolder = decodedFolder.replace(/[^a-zA-Z0-9_\-/]/g, ''); // Sanitize
    const url = `${ROOT_URL}/${safeFolder}/`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(404).send('Folder not found on remote server');
    }

    const text = await response.text();

    // Parse HTML directory listing
    const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
    const matches = [...text.matchAll(regex)];
    const items = [];

    for (const m of matches) {
      const href = m[1];
      const name = m[2].trim();

      // Skip parent directory
      if (name === 'Parent Directory' || name === '..') continue;

      const isFolder = href.endsWith('/');
      const itemUrl = `${ROOT_URL}/${safeFolder}/${href}`.replace(/\/+/g, '/');

      if (isFolder) {
        items.push({
          type: 'folder',
          name: name,
          path: itemUrl,
        });
      } else {
        // Only include supported encrypted or plain files
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
    console.error('Error fetching remote folder:', err.message);
    res.status(500).send('Failed to fetch folder structure');
  }
});

// ========= Proxy Remote Encrypted Files =========
app.get('/file', async (req, res) => {
  let filePath = req.query.path;
  if (!filePath) return res.status(400).send('Missing file path');

  try {
    filePath = decodeURIComponent(filePath.trim());

    if (!filePath.startsWith('http')) {
      return res.status(400).send('Invalid remote file URL');
    }

    const response = await fetch(filePath);
    if (!response.ok) {
      return res.status(404).send('File not found');
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine file type
    if (filePath.endsWith('.pdf.enc')) {
      const decrypted = decryptBuffer(buffer);
      res.setHeader('Content-Type', 'application/pdf');
      return res.end(decrypted);
    } else if (filePath.endsWith('.mp4.enc')) {
      const decrypted = decryptBuffer(buffer);
      res.setHeader('Content-Type', 'video/mp4');
      return res.end(decrypted);
    } else if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      return res.end(buffer);
    } else if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      return res.end(buffer);
    } else {
      return res.status(415).send('Unsupported file type');
    }
  } catch (err) {
    console.error('[proxy-file] Error:', err.message);
    res.status(500).send('Error fetching or decrypting file');
  }
});

// Decrypt buffer (used for remote .enc files)
function decryptBuffer(buffer) {
  const key = Buffer.from(
    crypto.createHash('sha256').update(SECRET_KEY).digest('base64').substring(0, 32),
    'utf-8'
  );
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

// Root route
app.get('/', (req, res) => {
  res.send('Welcome to the Najuzi PDF Server! (Teacher uploads disabled)');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
