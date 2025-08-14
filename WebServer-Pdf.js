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
const VIDEO_SERVER_URL = 'https://webserver-zpgc.onrender.com/video?path=';

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
  if (inputPath.includes('webserver-zpgc.onrender.com')) {
    const url = new URL(inputPath);
    return cleanPath(url.searchParams.get('path'));
  }
  return inputPath.replace(/^https?:\/\/[^/]+\/webapp\/MobileApp\//, '');
}

// Only allow PDF and MP4
function isAllowedFile(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4');
}

// List API
app.get('/list', async (req, res) => {
  try {
    let pathParam = req.query.path || '';
    pathParam = cleanPath(pathParam);

    const tree = await fetchDirectoryJSON();
    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    const items = [];

    // Folders
    for (const key in node) {
      if (key !== 'files') {
        items.push({
          name: key,
          isFolder: true,
          path: pathParam ? `${pathParam}/${key}` : key,
        });
      }
    }

    // Files
    if (node.files && Array.isArray(node.files)) {
      node.files.forEach(file => {
        if (!file.startsWith('~$') && isAllowedFile(file)) {
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

// File/Video API with proper streaming
app.get('/file', async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send('No file path provided');

    filePath = cleanPath(filePath);
    const lowerPath = filePath.toLowerCase();

    if (!isAllowedFile(filePath)) {
      return res.status(400).send('Unsupported file type. Only PDF and MP4 allowed.');
    }

    // MP4 streaming
    if (lowerPath.endsWith('.mp4')) {
      const videoUrl = `${VIDEO_SERVER_URL}${encodeURIComponent(filePath)}`;
      console.log(`Streaming video from: ${videoUrl}`);

      const range = req.headers.range;
      if (!range) {
        // If no range, fetch full video
        const fullResp = await fetch(videoUrl);
        if (!fullResp.ok) return res.status(fullResp.status).send('Video not found');

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', fullResp.headers.get('content-length'));
        return fullResp.body.pipe(res);
      }

      // Range request
      const videoResp = await fetch(videoUrl, { headers: { Range: range } });
      if (!videoResp.ok) return res.status(videoResp.status).send('Video not found');

      if (videoResp.headers.get('content-range')) {
        res.setHeader('Content-Range', videoResp.headers.get('content-range'));
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', videoResp.headers.get('content-length'));
      res.setHeader('Content-Type', 'video/mp4');

      return videoResp.body.pipe(res);
    }

    // PDF serving
    const pdfUrl = `${BASE_FILE_URL}${filePath}`;
    const response = await fetch(pdfUrl);
    if (!response.ok) return res.status(response.status).send('File not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', response.headers.get('content-length'));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    response.body.pipe(res);

  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).send('Server error');
  }
});

// Health check
app.get('/', (req, res) => res.send('Server running 🎉'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PDF viewer available at: http://localhost:${PORT}/public/pdfjs/web/viewer.html`);
});
