const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createHash, createDecipheriv } = require('crypto');
const { URL } = require('url');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 10000;

const JSON_URL = process.env.JSON_URL || 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = process.env.BASE_FILE_URL || 'https://najuzi.com/webapp/MobileApp/';
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'change-me';
const DECRYPT_KEY = createHash('sha256').update(ENCRYPTION_SECRET).digest();

// ===================== DOWNLOAD MANAGER BLOCKER ======================
const DOWNLOAD_MANAGER_SIGNATURES = [
  'idm', 'internet download manager', 'fdm', 'free download manager',
  'aria2', 'wget', 'curl', 'jdownloader', 'orbit', 'flashget',
  'downloader', 'download'
];

function isDownloadManager(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const extra = (req.headers['x-downloader'] || '').toLowerCase();
  const combined = ua + extra;
  return DOWNLOAD_MANAGER_SIGNATURES.some(sig => combined.includes(sig));
}

// ======================== GLOBAL SECURITY ==============================
app.use(cors({ origin: '*', methods: ['GET', 'HEAD'] }));

app.use((req, res, next) => {
  // Kill embed + download hooks
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self' blob: data: https:; " +
    "img-src 'self' blob: data: https:; " +
    "media-src 'self' blob: data: https:; " +
    "script-src 'self' 'unsafe-inline' blob: https:; " +
    "style-src 'self' 'unsafe-inline' https:; " +
    "frame-ancestors 'self';"
  );
  next();
});

app.use('/public', express.static('public'));

// ======================== UTILITIES ==============================

function cleanPath(input = '') {
  let current = input.trim();
  let depth = 0;

  while (depth++ < 5 && current) {
    if (!current.toLowerCase().startsWith('file?')) break;
    const parsed = new URL(current, 'http://dummy');
    const nested = parsed.searchParams.get('path');
    if (!nested) break;
    current = nested;
  }

  return current.replace(/^\/+/, '');
}

function isAllowedFile(p = '') {
  const lower = p.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4') || lower.endsWith('.pdf.enc');
}

async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error("Directory fetch failed");
  return res.json();
}

function getNodeAtPath(tree, rawPath) {
  if (!rawPath) return tree;
  return rawPath.split('/').filter(Boolean).reduce((node, seg) => (node && node[seg]) || null, tree);
}

// ====================== HTML BLOCK RESPONSE =========================

function sendAntiDownloadPage(res) {
  return res.status(200).type('text/html').send(`
<!DOCTYPE html>
<html>
<head>
<title>Protected</title>
<style>
body { background:#111; color:#0f0; font-family: monospace; text-align:center; padding-top:20vh;}
</style>
</head>
<body>
<h2>⛔ Direct Download Blocked</h2>
<p>This content can only be viewed through the official viewer.</p>
</body>
</html>
`);
}

// ====================== PDF HANDLER ==========================

async function streamEncryptedPdf(filePath, req, res) {

  if (isDownloadManager(req)) return sendAntiDownloadPage(res);

  const remote = await fetch(`${BASE_FILE_URL}${filePath}`);
  if (!remote.ok) throw new Error("Missing encrypted file");

  const stream = remote.body[Symbol.asyncIterator]();

  let ivBuffer = Buffer.alloc(0);
  while (ivBuffer.length < 16) {
    const { value } = await stream.next();
    ivBuffer = Buffer.concat([ivBuffer, Buffer.from(value)]);
  }

  const iv = ivBuffer.subarray(0, 16);
  const leftover = ivBuffer.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', DECRYPT_KEY, iv);

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store, no-cache',
    'Accept-Ranges': 'none'
  });

  if (leftover.length) res.write(decipher.update(leftover));

  for await (const chunk of stream) {
    const decrypted = decipher.update(chunk);
    if (decrypted.length) res.write(decrypted);
  }

  res.end(decipher.final());
}

async function handlePdfRequest(filePath, req, res) {

  if (isDownloadManager(req)) return sendAntiDownloadPage(res);

  const encrypted = filePath.endsWith('.pdf.enc') ? filePath : filePath + '.enc';

  try {
    return await streamEncryptedPdf(encrypted, req, res);
  } catch (e) {
    const remote = await fetch(`${BASE_FILE_URL}${filePath}`);
    if (!remote.ok) return res.status(404).send('File not found');

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store'
    });

    remote.body.pipe(res);
  }
}

// ======================= VIDEO HANDLER =======================

async function handleVideoRequest(filePath, req, res) {

  if (isDownloadManager(req)) return sendAntiDownloadPage(res);

  const url = BASE_FILE_URL + filePath;
  const range = req.headers.range;

  if (!range) {
    const remote = await fetch(url);
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return remote.body.pipe(res);
  }

  const remote = await fetch(url, { headers: { Range: range } });

  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Range': remote.headers.get('content-range')
  });

  remote.body.pipe(res);
}

// ========================= ROUTES ============================

app.get('/list', async (req, res) => {
  try {
    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, cleanPath(req.query.path || ''));
    if (!node) return res.json([]);

    const folders = Object.keys(node).filter(k => k !== 'files').map(k => ({
      name: k,
      isFolder: true,
      path: req.query.path ? `${req.query.path}/${k}` : k
    }));

    if (folders.length) return res.json(folders);

    const files = (node.files || []).filter(isAllowedFile).map(f => ({
      name: f,
      isFolder: false,
      path: req.query.path ? `${req.query.path}/${f}` : f
    }));

    res.json(files);

  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/file', async (req, res) => {
  const raw = req.query.path;
  if (!raw) return res.status(400).send('No file');

  const filePath = cleanPath(raw);
  if (!isAllowedFile(filePath)) return res.status(403).send('Blocked');

  if (filePath.endsWith('.mp4')) return handleVideoRequest(filePath, req, res);
  return handlePdfRequest(filePath, req, res);
});

app.get('/', (_, res) => res.send('✅ Server running securely'));

app.listen(PORT, () => {
  console.log('Server started on ' + PORT);
});
