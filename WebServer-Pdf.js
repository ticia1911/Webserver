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
  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch directory.json:', err);
    throw err;
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
  return lower.endsWith('.pdf') || lower.endsWith('.mp4');
}

// Recursive search inside a folder node
function filterFilesInNode(node, keyword) {
  if (!keyword) return node; // no search, return original node

  const filteredNode = {};

  // Keep folders as is
  for (const key in node) {
    if (key !== 'files') {
      filteredNode[key] = node[key];
    }
  }

  // Filter files only
  if (node.files && Array.isArray(node.files)) {
    const filteredFiles = node.files.filter(file =>
      !file.startsWith('~$') && isAllowedFile(file) && file.toLowerCase().includes(keyword.toLowerCase())
    );
    if (filteredFiles.length) filteredNode.files = filteredFiles;
  }

  return filteredNode;
}

// API: List folders/files with optional search filtering
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    const keyword = req.query.q || ''; // search within folder
    pathParam = cleanPath(pathParam);

    const tree = await fetchDirectoryJSON();
    let node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    // Apply search filtering inside this folder
    node = filterFilesInNode(node, keyword);

    const items = [];

    // Folders first (keep structure)
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }

    // Then files
    if (node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        items.push({
          name: file,
          isFolder: false,
          path: pathParam ? `${pathParam}/${file}` : file,
        });
      });
    }

    res.json(items);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Video streaming
async function handleVideoStreaming(filePath, req, res) {
  const videoUrl = `${BASE_FILE_URL}${filePath}`;
  console.log(`Streaming video from: ${videoUrl}`);

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

  const contentRange = videoResp.headers.get('content-range');
  const contentLength = videoResp.headers.get('content-length');

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength || undefined,
  };

  if (contentRange) {
    headers['Content-Range'] = contentRange;
    res.writeHead(206, headers);
  } else {
    res.writeHead(200, headers);
  }

  return videoResp.body.pipe(res);
}

// API: Serve file (PDF or MP4)
app.get('/file', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    filePath = cleanPath(filePath);
    const lowerPath = filePath.toLowerCase();

    if (!isAllowedFile(filePath)) return res.status(400).send('Only PDF and MP4 allowed');

    if (lowerPath.endsWith('.mp4')) return handleVideoStreaming(filePath, req, res);

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

// API: Video alias
app.get('/video', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    filePath = cleanPath(filePath);
    if (!filePath.toLowerCase().endsWith('.mp4')) return res.status(400).send('Only MP4 supported in /video');

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
  console.log(`PDF viewer available at: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
