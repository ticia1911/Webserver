// server.js
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS
app.use(cors());

// Serve static files from 'public' folder
app.use('/public', express.static('public'));

// 🔴 CRITICAL: Remove extra spaces in URLs
const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/'; // No trailing space

// Helper: fetch JSON remotely
async function fetchDirectoryJSON() {
  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`Failed to fetch directory.json: ${res.status}`);
    return res.json();
  } catch (err) {
    console.error('Error fetching directory.json:', err);
    throw err;
  }
}

// Helper: traverse JSON by path segments
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

// API: list folders/files
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = pathParam.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '').trim();

    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);

    if (!node) return res.status(404).json({ error: 'Path not found' });

    const items = [];
    // Add folders
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }
    // Add files
    if (Array.isArray(node.files)) {
      node.files
        .filter(file => !file.startsWith('~$'))
        .forEach(file => {
          items.push({
            name: file,
            isFolder: false,
            path: pathParam ? `${pathParam}/${file}` : file,
          });
        });
    }

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching directory' });
  }
});

// Helper: get content type
function getContentType(filePath) {
  if (filePath.endsWith('.pdf') || filePath.endsWith('.pdf.enc')) {
    return 'application/pdf';
  } else if (filePath.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

// Proxy route: fetch any file from Namecheap
app.get('/file', async (req, res) => {
  try {
    const filePath = req.query.path?.trim();
    if (!filePath) return res.status(400).send('File path is required');

    const url = `${BASE_FILE_URL}${filePath}`;

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(404).send('File not found on remote server');
    }

    // Set headers
    const contentType = response.headers.get('content-type') || getContentType(filePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Stream file
    response.body.pipe(res);

    response.body.on('error', () => res.destroy());
    res.on('close', () => response.body.destroy());
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Error fetching file');
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server running 🎉');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
