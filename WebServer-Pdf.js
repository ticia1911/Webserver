const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Enhanced CORS configuration
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
const VIDEO_SERVER_URL = 'https://webserver-zpgc.onrender.com/file?path='; // Video server endpoint

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
  if (inputPath.includes('webserver-zpgc.onrender.com/file?path=')) {
    const url = new URL(inputPath);
    return cleanPath(url.searchParams.get('path'));
  }
  return inputPath.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

// API endpoints
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = cleanPath(pathParam);

    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);

    if (!node) return res.status(404).json({ error: 'Path not found' });

    const items = [];
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }

    if (node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        if (!file.startsWith('~$')) {
          items.push({
            name: file,
            isFolder: false,
            path: pathParam ? `${pathParam}/${file}` : file,
          });
        }
      });
    }

    res.json(items);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/file', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    filePath = cleanPath(filePath);

    // If it's an MP4, redirect/proxy to the video server
    if (filePath.toLowerCase().endsWith('.mp4')) {
      const videoUrl = `${VIDEO_SERVER_URL}${encodeURIComponent(filePath)}`;
      console.log(`Redirecting MP4 request to video server: ${videoUrl}`);

      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        return res.status(videoResponse.status).send('Video not found');
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', videoResponse.headers.get('content-length'));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return videoResponse.body.pipe(res);
    }

    // Otherwise, fetch normally (PDF, docx, etc.)
    const finalUrl = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(finalUrl);
    if (!response.ok) {
      return res.status(response.status).send('File not found');
    }

    res.setHeader('Content-Type', getContentType(filePath) || 'application/octet-stream');
    res.setHeader('Content-Length', response.headers.get('content-length'));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    response.body.pipe(res);
  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).send('Server error');
  }
});

function getContentType(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  const types = {
    'pdf': 'application/pdf',
    'pdf.enc': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'mp4': 'video/mp4'
  };
  return types[extension] || null;
}

// Health check
app.get('/', (req, res) => res.send('Server running 🎉'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PDF viewer available at: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
