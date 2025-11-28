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

const ALLOWED_HOSTS = [
  'najuzi.com',
  'www.najuzi.com',
  'onrender.com',
  'webserver-zpgc.onrender.com',
];

const DOWNLOAD_MANAGER_SIGNATURES = [
  'idm',
  'internet download manager',
  'internetdownloadmanager',
  'idman',
  'idm/',
  'internet.download.manager',
  'fdm',
  'free download manager',
  'aria2',
  'downthemall',
  'wget',
  'curl',
  'uget',
  'xtreme',
  'flashget',
  'orbit',
  'jdownloader',
];

const BROWSER_SIGNATURES = [
  'mozilla/',
  'chrome/',
  'safari/',
  'firefox/',
  'edg/',
  'opr/',
  'trident/',
  'msie',
];

const TRUSTED_CLIENT_SIGNATURES = [
  'dart/',
  'okhttp',
  'cfnetwork',
  'postmanruntime',
  'insomnia',
  'alamo fire',
  'alamo-fire',
  'alamofire',
  'flutter',
  'axios',
];

app.use(cors({ origin: '*', methods: ['GET', 'HEAD'], allowedHeaders: ['Content-Type', 'Range'] }));
app.use('/public', express.static('public'));

// --- Utilities ---
function stripKnownPrefixes(value = '') {
  let trimmed = value.trim();
  ALLOWED_HOSTS.forEach(host => {
    const regex = new RegExp(`^https?:\\/\\/(?:www\\.)?${host}\\/`, 'i');
    trimmed = trimmed.replace(regex, '');
  });
  return trimmed;
}

function cleanPath(input = '') {
  let current = stripKnownPrefixes(input);
  let depth = 0;

  while (depth++ < 5 && current) {
    if (!current.toLowerCase().startsWith('file?')) break;
    try {
      const parsed = new URL(current, 'http://dummy');
      const nested = parsed.searchParams.get('path');
      if (!nested) break;
      current = stripKnownPrefixes(nested);
    } catch {
      break;
    }
  }

  return current.replace(/^\/+/, '');
}

function isAllowedFile(filePath = '') {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4') || lower.endsWith('.pdf.enc');
}

async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error(`Directory fetch failed: ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) return res.json();
  throw new Error(`Unexpected content-type from directory: ${type}`);
}

function getNodeAtPath(tree, rawPath) {
  if (!rawPath) return tree;
  return rawPath.split('/').filter(Boolean).reduce((node, seg) => (node && node[seg]) || null, tree);
}

function searchFiles(node, basePath, keyword) {
  const results = [];
  if (Array.isArray(node.files)) {
    node.files.forEach(file => {
      if (!file.startsWith('~$') && isAllowedFile(file) && file.toLowerCase().includes(keyword)) {
        results.push({ name: file, isFolder: false, path: basePath ? `${basePath}/${file}` : file });
      }
    });
  }
  Object.entries(node)
    .filter(([key]) => key !== 'files')
    .forEach(([key, sub]) => {
      results.push(...searchFiles(sub, basePath ? `${basePath}/${key}` : key, keyword));
    });
  return results;
}

function looksLikeBrowserUA(ua = '') {
  return BROWSER_SIGNATURES.some(signature => ua.includes(signature));
}

function isTrustedClientUA(ua = '') {
  return TRUSTED_CLIENT_SIGNATURES.some(signature => ua.includes(signature));
}

function hasFetchMetadata(req) {
  if (!req) return false;
  return Boolean(
    req.headers['sec-fetch-dest'] ||
      req.headers['sec-fetch-mode'] ||
      req.headers['sec-fetch-site'] ||
      req.headers['sec-fetch-user'],
  );
}

function parseBooleanFlag(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

// Detect if request comes from a download manager
function isDownloadManagerRequest(req) {
  if (!req) return false;
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const xDownloader = (req.headers['x-downloader'] || '').toLowerCase();
  const combined = `${ua} ${xDownloader}`;

  if (DOWNLOAD_MANAGER_SIGNATURES.some(sig => combined.includes(sig))) return true;

  if (req.headers['x-download-manager'] || req.headers['x-idm']) return true;

  const accept = (req.headers.accept || '').toLowerCase();
  const hasBrowserHints = looksLikeBrowserUA(ua);

  if (!hasFetchMetadata(req) && hasBrowserHints && !isTrustedClientUA(ua)) {
    return true;
  }

  if (
    !hasFetchMetadata(req) &&
    hasBrowserHints &&
    !accept.includes('text/html') &&
    (req.headers.range || req.headers['purpose'] === 'prefetch')
  ) {
    return true;
  }

  return false;
}

// Serve viewer.html to download managers so they receive harmless HTML instead of the raw asset
function serveViewerDownload(res) {
  try {
    const viewerPath = path.join(__dirname, 'public', 'pdfjs', 'web', 'viewer.html');
    if (!fs.existsSync(viewerPath)) {
      return res
        .status(200)
        .type('text/html')
        .send('<!doctype html><meta charset="utf-8"><title>Viewer</title><p>Viewer not found.</p>');
    }
    const data = fs.readFileSync(viewerPath);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', 'attachment; filename="viewer.html"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(data);
  } catch (err) {
    console.error('serveViewerDownload error:', err);
    return res.status(500).send('Server error');
  }
}

// Proxy remote file; optionally short-circuit if download manager detected
async function proxyRemoteFile(url, res, options = {}) {
  const { headers = {}, status = 200, req = null, skipDownloadGuard = false } = options;

  try {
    if (!skipDownloadGuard && req && isDownloadManagerRequest(req)) {
      return serveViewerDownload(res);
    }

    const remote = await fetch(url);
    if (!remote.ok) return res.status(remote.status).send('Remote fetch failed');

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.writeHead(status);
    remote.body.pipe(res);
  } catch (err) {
    console.error('proxyRemoteFile error:', err);
    return res.status(500).send('Proxy error');
  }
}

async function streamEncryptedPdf(filePath, req, res, skipDownloadGuard = false) {
  if (!skipDownloadGuard && isDownloadManagerRequest(req)) return serveViewerDownload(res);

  const remote = await fetch(`${BASE_FILE_URL}${filePath}`);
  if (!remote.ok) throw new Error(`Encrypted file missing: ${remote.status}`);
  const stream = remote.body[Symbol.asyncIterator]();

  let ivBuffer = Buffer.alloc(0);
  while (ivBuffer.length < 16) {
    const { value, done } = await stream.next();
    if (done) throw new Error('Encrypted stream ended before IV read');
    ivBuffer = Buffer.concat([ivBuffer, Buffer.from(value)]);
  }

  const iv = ivBuffer.subarray(0, 16);
  const leftover = ivBuffer.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', DECRYPT_KEY, iv);

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="document.pdf"',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Accept-Ranges': 'none',
  });

  if (leftover.length) res.write(decipher.update(leftover));

  try {
    for await (const chunk of stream) {
      const decrypted = decipher.update(chunk);
      if (decrypted.length && !res.write(decrypted)) {
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
    const finalChunk = decipher.final();
    if (finalChunk.length) res.write(finalChunk);
    res.end();
  } catch (err) {
    res.destroy(err);
    throw err;
  }
}

async function handlePdfRequest(filePath, req, res, options = {}) {
  const skipDownloadGuard = Boolean(options.skipDownloadGuard);

  if (!skipDownloadGuard && isDownloadManagerRequest(req)) return serveViewerDownload(res);

  const encryptedPath = filePath.endsWith('.pdf.enc') ? filePath : `${filePath}.enc`;
  try {
    await streamEncryptedPdf(encryptedPath, req, res, skipDownloadGuard);
    return;
  } catch (err) {
    if (!filePath.endsWith('.pdf.enc')) {
      return proxyRemoteFile(`${BASE_FILE_URL}${filePath}`, res, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
          'Accept-Ranges': 'none',
        },
        status: 200,
        req,
        skipDownloadGuard,
      });
    }
    throw err;
  }
}

async function handleVideoRequest(filePath, req, res, options = {}) {
  const skipDownloadGuard = Boolean(options.skipDownloadGuard);
  const url = `${BASE_FILE_URL}${filePath}`;

  if (!skipDownloadGuard && isDownloadManagerRequest(req)) return serveViewerDownload(res);

  const range = req.headers.range;

  if (!range) {
    return proxyRemoteFile(url, res, {
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      },
      status: 200,
      req,
      skipDownloadGuard,
    });
  }

  const remote = await fetch(url, { headers: { Range: range } });
  if (!remote.ok) return res.status(remote.status).send('Video segment unavailable');

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
  };
  const contentLength = remote.headers.get('content-length');
  if (contentLength) headers['Content-Length'] = contentLength;
  const contentRange = remote.headers.get('content-range');
  if (contentRange) headers['Content-Range'] = contentRange;

  res.writeHead(contentRange ? 206 : 200, headers);
  remote.body.pipe(res);
}

// --- Routes ---
app.get('/list', async (req, res) => {
  try {
    const pathParam = cleanPath(req.query.path || '');
    const searchKeyword = (req.query.search || '').trim().toLowerCase();
    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    if (searchKeyword) return res.json(searchFiles(node, pathParam, searchKeyword));

    const folders = Object.keys(node)
      .filter(key => key !== 'files')
      .map(key => ({ name: key, isFolder: true, path: pathParam ? `${pathParam}/${key}` : key }));

    if (folders.length) return res.json(folders);

    const files = (node.files || [])
      .filter(file => !file.startsWith('~$') && isAllowedFile(file))
      .map(file => ({ name: file, isFolder: false, path: pathParam ? `${pathParam}/${file}` : file }));

    return res.json(files);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/file', async (req, res) => {
  try {
    const raw = req.query.path;
    if (!raw) return res.status(400).send('No file path provided');

    const filePath = cleanPath(raw);
    if (!isAllowedFile(filePath)) return res.status(400).send('Only PDF/MP4 files permitted');

    const skipDownloadGuard = parseBooleanFlag(req.query.forceInline || req.query.view);

    if (filePath.toLowerCase().endsWith('.mp4')) {
      return handleVideoRequest(filePath, req, res, { skipDownloadGuard });
    }
    return handlePdfRequest(filePath, req, res, { skipDownloadGuard });
  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).send('Server error');
  }
});

app.get('/video', async (req, res) => {
  try {
    const raw = req.query.path;
    if (!raw) return res.status(400).send('No file path provided');
    const filePath = cleanPath(raw);
    if (!filePath.toLowerCase().endsWith('.mp4')) return res.status(400).send('Only MP4 supported');

    const skipDownloadGuard = parseBooleanFlag(req.query.forceInline || req.query.view);

    return handleVideoRequest(filePath, req, res, { skipDownloadGuard });
  } catch (err) {
    console.error('Video proxy error:', err);
    res.status(500).send('Server error');
  }
});

app.get('/', (_, res) => res.send('Server running'));

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`PDF viewer: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
