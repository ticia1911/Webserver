const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Serve static files
app.use('/public', express.static('public'));

// Constants
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';

// Helper functions
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

// Clean path for server usage (prevents double encoding)
function cleanPath(inputPath) {
  if (!inputPath) return '';
  try {
    const url = new URL(inputPath);
    if (url.searchParams.get('path')) {
      // recursively unwrap if URL has "path" param
      return cleanPath(url.searchParams.get('path'));
    }
  } catch (e) {
    // not a full URL, treat as relative path
  }
  // remove BASE_FILE_URL prefix if present
  return inputPath.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

function isAllowedFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4');
}

// Recursive search helper
function searchFiles(node, path, keyword) {
  let results = [];

  if (node.files && Array.isArray(node.files)) {
    node.files.forEach(file => {
      if (!file.startsWith('~$') && isAllowedFile(file)) {
        if (file.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({
            name: file,
            isFolder: false,
            path: path ? `${path}/${file}` : file
          });
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

// API: List folders/files or search
app.get('/list', async (req, res) => {
  try {
    let pathParam = cleanPath(req.query.path || '');
    const searchKeyword = req.query.search || '';

    const tree = await fetchDirectoryJSON();
    if (tree.html) return res.status(500).send(tree.html);

    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    if (searchKeyword.trim()) {
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

// Video streaming
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
  if (videoResp.headers.get('content-range')) headers['Content-Range'] = videoResp.headers.get('content-range');

  res.writeHead(videoResp.headers.get('content-range') ? 206 : 200, headers);
  return videoResp.body.pipe(res);
}

// API: Serve PDF or MP4
app.get('/file', async (req, res) => {
  try {
    let filePath = cleanPath(req.query.path);
    if (!filePath) return res.status(400).send('No file path provided');

    if (!isAllowedFile(filePath)) return res.status(400).send('Only PDF and MP4 allowed');

    if (filePath.toLowerCase().endsWith('.mp4')) return handleVideoStreaming(filePath, req, res);

    const pdfUrl = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(pdfUrl);
    if (!response.ok) return res.status(response.status).send('File not found');

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': response.headers.get('content-length'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    response.body.pipe(res);

  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).send('Server error');
  }
});

// /video alias
app.get('/video', async (req, res) => {
  try {
    let filePath = cleanPath(req.query.path);
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
