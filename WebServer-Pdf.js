// server.js
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// === CONFIG ===
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';

// Encryption secret (change to env var in production)
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'najuzi0702518998';

// derive 32-byte key from secret (sha256)
const KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

// === CORS setup ===
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Serve static files
app.use('/public', express.static('public'));

// Helper: fetch directory JSON
async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  } else if (contentType.includes('text/html')) {
    const text = await res.text();
    console.warn('Warning: Received HTML instead of JSON from directory URL');
    return { html: text };
  } else {
    throw new Error('Unsupported content type: ' + contentType);
  }
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

function cleanPath(inputPath) {
  if (!inputPath) return '';
  if (inputPath.includes('onrender.com')) {
    const url = new URL(inputPath);
    return cleanPath(url.searchParams.get('path'));
  }
  return inputPath.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

function isAllowedFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4') || lower.endsWith('.pdf.enc');
}

// Recursive search helper
function searchFiles(node, path, keyword) {
  let results = [];
  // Search in files
  if (node.files && Array.isArray(node.files)) {
    node.files.forEach(file => {
      if (!file.startsWith('~$') && isAllowedFile(file)) {
        const name = file.toLowerCase();
        if (name.includes(keyword.toLowerCase())) {
          results.push({
            name: file,
            isFolder: false,
            path: path ? `${path}/${file}` : file
          });
        }
      }
    });
  }
  // Search in subfolders
  for (const key in node) {
    if (key !== 'files') {
      const subNode = node[key];
      const subPath = path ? `${path}/${key}` : key;
      results = results.concat(searchFiles(subNode, subPath, keyword));
    }
  }
  return results;
}

// API: List folders/files hierarchically or search
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = cleanPath(pathParam);
    const searchKeyword = req.query.search || '';
    const tree = await fetchDirectoryJSON();
    if (tree.html) return res.status(500).send(tree.html);
    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });
    if (searchKeyword.trim() !== '') {
      const files = searchFiles(node, pathParam, searchKeyword);
      return res.json(files);
    }
    const folders = [];
    const files = [];
    for (const key in node) {
      if (key !== 'files') {
        folders.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key
        });
      }
    }
    if (folders.length === 0 && node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        if (!file.startsWith('~$') && isAllowedFile(file)) {
          files.push({
            name: file,
            isFolder: false,
            path: pathParam ? `${pathParam}/${file}` : file
          });
        }
      });
    }
    res.json(folders.length > 0 ? folders : files);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// === Video streaming (unchanged, supports Range) ===
async function handleVideoStreaming(filePath, req, res) {
  const videoUrl = `${BASE_FILE_URL}${filePath}`;
  const range = req.headers.range;
  if (!range) {
    const fullResp = await fetch(videoUrl);
    if (!fullResp.ok) return res.status(fullResp.status).send('Video not found');
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': fullResp.headers.get('content-length'),
      'Accept-Ranges': 'bytes'
    });
    return fullResp.body.pipe(res);
  }
  const videoResp = await fetch(videoUrl, { headers: { Range: range } });
  if (!videoResp.ok) return res.status(videoResp.status).send('Video not found');
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': videoResp.headers.get('content-length') || undefined
  };
  if (videoResp.headers.get('content-range')) headers['Content-Range'] =
    videoResp.headers.get('content-range');
  res.writeHead(videoResp.headers.get('content-range') ? 206 : 200, headers);
  return videoResp.body.pipe(res);
}

// Helper: decrypt an encrypted stream (expects IV prepended as first 16 bytes)
async function streamDecryptAndPipe(remoteStream, res) {
  // remoteStream is a Node ReadableStream (from node-fetch .body)
  const asyncIter = remoteStream[Symbol.asyncIterator]();
  // read first 16 bytes for IV
  let ivBuf = Buffer.alloc(0);
  try {
    while (ivBuf.length < 16) {
      const { value, done } = await asyncIter.next();
      if (done) {
        throw new Error('Stream ended before IV could be read');
      }
      ivBuf = Buffer.concat([ivBuf, Buffer.from(value)]);
    }
  } catch (err) {
    throw err;
  }
  const iv = ivBuf.slice(0, 16);
  const leftover = ivBuf.slice(16); // any bytes after the IV from the first chunk(s)

  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);

  // set headers and stream decrypted data
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'none',
    // optionally prevent caching of decrypted content:
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });

  // If there's leftover plaintext (after decryption) write it first
  if (leftover && leftover.length > 0) {
    const dec = decipher.update(leftover);
    if (dec && dec.length) res.write(dec);
  }

  // continue reading chunks, decrypt and write
  try {
    for await (const chunk of asyncIter) {
      const dec = decipher.update(chunk);
      if (dec && dec.length) {
        // backpressure could be handled better, but node streams handle it internally
        const ok = res.write(dec);
        if (!ok) {
          // if downstream is slower, wait for drain
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
    }
    const final = decipher.final();
    if (final && final.length) res.write(final);
    res.end();
  } catch (err) {
    console.error('Decryption streaming error:', err);
    try { res.destroy(err); } catch (e) { /* ignore */ }
  }
}

// API: Serve file (PDF or MP4) with on-the-fly decryption for .enc files
app.get('/file', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');
    filePath = cleanPath(filePath);
    const lowerPath = filePath.toLowerCase();

    if (!isAllowedFile(filePath)) return res.status(400).send('Only PDF and MP4 allowed');

    // If MP4 -> use video streaming (no decryption support here)
    if (lowerPath.endsWith('.mp4')) return handleVideoStreaming(filePath, req, res);

    // PDF handling:
    // Try to fetch encrypted version first: (append .enc) e.g., doc.pdf.enc
    const encUrl = `${BASE_FILE_URL}${filePath}.enc`;
    let encResp;
    try {
      encResp = await fetch(encUrl, { method: 'GET' });
    } catch (err) {
      encResp = null;
    }

    if (encResp && encResp.ok) {
      // We found an encrypted file -> decrypt on the fly and stream.
      // Do NOT support Range for encrypted files (because of encryption).
      if (req.headers.range) {
        return res.status(416).send('Range not supported for encrypted PDFs');
      }
      return streamDecryptAndPipe(encResp.body, res);
    }

    // Fallback: try unencrypted PDF at the original path
    const pdfUrl = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(pdfUrl);
    if (!response.ok) return res.status(response.status).send('File not found');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': response.headers.get('content-length'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    return response.body.pipe(res);
  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).send('Server error');
  }
});

// API: /video alias (unchanged)
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
app.get('/', (req, res) => res.send('Server running'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PDF viewer: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
