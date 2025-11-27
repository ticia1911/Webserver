const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// === CONFIG ===
// 🔥 CRITICAL: Removed trailing spaces!
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';

// Encryption — same as before
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'najuzi0702518998';
const KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest(); // 32 bytes

// === CORS ===
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Static files
app.use('/public', express.static('public'));

// === Helpers ===
async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching directory.json`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  if (contentType.includes('text/html')) {
    const txt = await res.text();
    console.warn('directory.json returned HTML (likely 404)');
    throw new Error('directory.json is HTML, not JSON');
  }
  throw new Error('Unsupported content type: ' + contentType);
}

function getNodeAtPath(tree, pathParam) {
  if (!pathParam) return tree;
  const segments = pathParam.split('/').filter(s => s.trim() !== '');
  let node = tree;
  for (const seg of segments) {
    if (!node[seg]) return null;
    node = node[seg];
  }
  return node;
}

// ✅ Robust cleanPath: handles nested /file?path= safely
function cleanPath(inputPath) {
  if (!inputPath) return '';
  let current = inputPath;
  // Unwrap at most 3 levels (prevent infinite loop)
  for (let i = 0; i < 3; i++) {
    try {
      const url = new URL(current, 'https://dummy.com');
      if (url.pathname === '/file') {
        const newPath = url.searchParams.get('path');
        if (newPath) current = newPath;
        else break;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return current.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

function isAllowedFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4');
}

function searchFiles(node, path, keyword) {
  let results = [];
  if (node.files && Array.isArray(node.files)) {
    node.files.forEach(file => {
      if (!file.startsWith('~$') && isAllowedFile(file)) {
        const name = file.toLowerCase();
        if (name.includes(keyword.toLowerCase())) {
          results.push({ name: file, isFolder: false, path: path ? `${path}/${file}` : file });
        }
      }
    });
  }
  for (const key in node) {
    if (key !== 'files') {
      const subNode = node[key];
      const subPath = path ? `${path}/${key}` : key;
      results = results.concat(searchFiles(subNode, subPath, keyword));
    }
  }
  return results;
}

// === Endpoints ===
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = cleanPath(pathParam);
    const searchKeyword = req.query.search || '';
    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    if (searchKeyword.trim() !== '') {
      return res.json(searchFiles(node, pathParam, searchKeyword));
    }

    const folders = [];
    const files = [];
    for (const key in node) {
      if (key !== 'files') {
        folders.push({ name: key, isFolder: true, path: pathParam ? `${pathParam}/${key}` : key });
      }
    }

    if (folders.length === 0 && node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        if (!file.startsWith('~$') && isAllowedFile(file)) {
          files.push({ name: file, isFolder: false, path: pathParam ? `${pathParam}/${file}` : file });
        }
      });
    }

    res.json(folders.length > 0 ? folders : files);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Video streaming (unchanged)
async function handleVideoStreaming(filePath, req, res) {
  const videoUrl = `${BASE_FILE_URL}${encodeURIComponent(filePath)}`;
  const range = req.headers.range;
  const opts = range ? { headers: { Range: range } } : {};
  const videoResp = await fetch(videoUrl, opts);
  if (!videoResp.ok) return res.status(videoResp.status).send('Video not found');

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes'
  };
  const len = videoResp.headers.get('content-length');
  if (len) headers['Content-Length'] = len;
  const cr = videoResp.headers.get('content-range');
  if (cr) headers['Content-Range'] = cr;

  res.writeHead(cr ? 206 : 200, headers);
  return videoResp.body.pipe(res);
}

// 🔐 Stream & decrypt .pdf.enc on-the-fly
async function streamDecryptAndPipe(remoteStream, res, fileName) {
  const asyncIter = remoteStream[Symbol.asyncIterator]();
  let ivBuf = Buffer.alloc(0);

  // Read first 16 bytes for IV
  while (ivBuf.length < 16) {
    const { value, done } = await asyncIter.next();
    if (done) throw new Error('Stream ended before 16-byte IV could be read');
    ivBuf = Buffer.concat([ivBuf, Buffer.from(value)]);
  }

  const iv = ivBuf.slice(0, 16);
  const leftover = ivBuf.slice(16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
  decipher.setAutoPadding(true);

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'X-Content-Type-Options': 'nosniff'
  });

  // Decrypt leftover (if any)
  if (leftover.length > 0) {
    const dec = decipher.update(leftover);
    if (dec.length > 0) res.write(dec);
  }

  // Decrypt rest
  for await (const chunk of asyncIter) {
    const dec = decipher.update(chunk);
    if (dec.length > 0) {
      const ok = res.write(dec);
      if (!ok) await new Promise(resolve => res.once('drain', resolve));
    }
  }

  const final = decipher.final();
  if (final.length > 0) res.write(final);
  res.end();
}

// 🚀 Main /file endpoint: supports .pdf, .pdf.enc, .mp4
app.get('/file', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('❌ Missing ?path=');
    filePath = cleanPath(filePath);
    if (!filePath) return res.status(400).send('❌ Invalid path');

    const lowerPath = filePath.toLowerCase();
    if (!isAllowedFile(filePath)) return res.status(400).send('❌ Only .pdf and .mp4 allowed');

    // MP4 → stream directly
    if (lowerPath.endsWith('.mp4')) {
      return handleVideoStreaming(filePath, req, res);
    }

    // PDF: try encrypted (.pdf.enc) first
    const encUrl = `${BASE_FILE_URL}${encodeURIComponent(filePath)}.enc`;
    let hasEnc = false;
    try {
      const headResp = await fetch(encUrl, { method: 'HEAD' });
      hasEnc = headResp.ok;
    } catch {}

    if (hasEnc) {
      if (req.headers.range) {
        return res.status(416).send('❌ Range requests not supported for encrypted PDFs');
      }
      const fullResp = await fetch(encUrl);
      const fileName = filePath.split('/').pop();
      return streamDecryptAndPipe(fullResp.body, res, fileName);
    }

    // Fallback: unencrypted PDF
    const pdfUrl = `${BASE_FILE_URL}${encodeURIComponent(filePath)}`;
    const pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) {
      return res.status(404).send(`❌ File not found: ${filePath} (and no .enc version)`);
    }

    const fileName = filePath.split('/').pop();
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    return pdfResp.body.pipe(res);

  } catch (err) {
    console.error('💥 /file error:', err.message);
    res.status(500).send('❌ Server error. Check logs.');
  }
});

// /video alias
app.get('/video', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');
    filePath = cleanPath(filePath);
    if (!filePath.toLowerCase().endsWith('.mp4')) return res.status(400).send('Only MP4 supported');
    return handleVideoStreaming(filePath, req, res);
  } catch (err) {
    console.error('Video proxy error:', err);
    res.status(500).send('Server error');
  }
});

// Health check
app.get('/', (req, res) => {
  res.send(`
    <h2>✅ PDF/Video Proxy + On-the-fly Decryption</h2>
    <p>Try:</p>
    <ul>
      <li><a href="/list?path=BIOLOGY/Notes/SENIOR%201">/list?path=BIOLOGY/Notes/SENIOR%201</a></li>
      <li><a href="/file?path=BIOLOGY/Notes/SENIOR%201/TERM%201/DIVERSITY%20OF%20LIVING%20THINGS/1.INTRODUCTION%20TO%20BIOLOGY/1.%20Biology%20is%20the%20study%20of%20life.pdf">
        📄 Direct PDF (encrypted → decrypted)
      </a></li>
      <li><a href="/public/pdfjs/web/viewer.html?file=/file?path=BIOLOGY/Notes/SENIOR%201/TERM%201/DIVERSITY%20OF%20LIVING%20THINGS/1.INTRODUCTION%20TO%20BIOLOGY/1.%20Biology%20is%20the%20study%20of%20life.pdf">
        📘 PDF.js viewer (correct usage)
      </a></li>
    </ul>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📄 PDF viewer: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
