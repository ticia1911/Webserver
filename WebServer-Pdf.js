const express = require('express');const express = require('express');
const cors = require('cors');
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

app.use(cors({ origin: '*', methods: ['GET', 'HEAD'], allowedHeaders: ['Content-Type', 'Range'] }));
app.use('/public', express.static('public'));

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

function isAllowedFile(path = '') {
  const lower = path.toLowerCase();
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

async function proxyRemoteFile(url, res, headers = {}, status = 200) {
  const remote = await fetch(url);
  if (!remote.ok) return res.status(remote.status).send('Remote fetch failed');
  res.writeHead(status, headers);
  remote.body.pipe(res);
}

async function streamEncryptedPdf(filePath, res) {
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

async function handlePdfRequest(filePath, req, res) {
  const encryptedPath = filePath.endsWith('.pdf.enc') ? filePath : `${filePath}.enc`;
  try {
    await streamEncryptedPdf(encryptedPath, res);
    return;
  } catch (err) {
    if (!filePath.endsWith('.pdf.enc')) {
      return proxyRemoteFile(`${BASE_FILE_URL}${filePath}`, res, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=3600',
      });
    }
    throw err;
  }
}

async function handleVideoRequest(filePath, req, res) {
  const url = `${BASE_FILE_URL}${filePath}`;
  const range = req.headers.range;

  if (!range) {
    return proxyRemoteFile(url, res, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
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

// Routes

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

    if (filePath.toLowerCase().endsWith('.mp4')) return handleVideoRequest(filePath, req, res);
    return handlePdfRequest(filePath, req, res);
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
    return handleVideoRequest(filePath, req, res);
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
when i install idm in my browser like firefox the pdf fails to show and instead idm appears to download it but i want the pdf to show and in the download i need to download the format like file:///C:/Users/HP/Downloads/viewer.html dont dowmload the pdf even if the idm is installed in firefox modify code and return full code
const cors = require('cors');
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

app.use(cors({ origin: '*', methods: ['GET', 'HEAD'], allowedHeaders: ['Content-Type', 'Range'] }));
app.use('/public', express.static('public'));

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

function isAllowedFile(path = '') {
  const lower = path.toLowerCase();
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

async function proxyRemoteFile(url, res, headers = {}, status = 200) {
  const remote = await fetch(url);
  if (!remote.ok) return res.status(remote.status).send('Remote fetch failed');
  res.writeHead(status, headers);
  remote.body.pipe(res);
}

async function streamEncryptedPdf(filePath, res) {
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

async function handlePdfRequest(filePath, req, res) {
  const encryptedPath = filePath.endsWith('.pdf.enc') ? filePath : `${filePath}.enc`;
  try {
    await streamEncryptedPdf(encryptedPath, res);
    return;
  } catch (err) {
    if (!filePath.endsWith('.pdf.enc')) {
      return proxyRemoteFile(`${BASE_FILE_URL}${filePath}`, res, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=3600',
      });
    }
    throw err;
  }
}

async function handleVideoRequest(filePath, req, res) {
  const url = `${BASE_FILE_URL}${filePath}`;
  const range = req.headers.range;

  if (!range) {
    return proxyRemoteFile(url, res, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
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

// Routes

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

    if (filePath.toLowerCase().endsWith('.mp4')) return handleVideoRequest(filePath, req, res);
    return handlePdfRequest(filePath, req, res);
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
    return handleVideoRequest(filePath, req, res);
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
when i install idm in my browser like firefox the pdf fails to show and instead idm appears to download it but i want the pdf to show and in the download i need to download the format like file:///C:/Users/HP/Downloads/viewer.html dont dowmload the pdf even if the idm is installed in firefox modify code and return full code
