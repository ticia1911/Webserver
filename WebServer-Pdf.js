const express = require('express');
const cors = require('cors');

// Use node-fetch for fetching remote files
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 10000;

// Your public file base URL
const REMOTE_BASE = 'https://najuzi.com/webapp/MobileApp';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 Najuzi File Server</h1>
    <p>Proxying files from: <strong>${REMOTE_BASE}</strong></p>
    <p>Use:</p>
    <ul>
      <li><code>/folder-tree?folder=AGRICULTURE</code></li>
      <li><code>/file?path=/webapp/MobileApp/AGRICULTURE/NOTES/topic.pdf</code></li>
    </ul>
  `);
});

// ========= Dynamic Folder Tree =========
app.get('/folder-tree', async (req, res) => {
  const folder = req.query.folder;
  if (!folder) return res.status(400).json({ error: 'Missing folder parameter' });

  try {
    const url = `${REMOTE_BASE}/${folder}/`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const text = await response.text();
    const items = parseDirectoryListing(text, url);
    res.json(items);
  } catch (err) {
    console.error('Error in /folder-tree:', err.message);
    res.status(500).json({ error: 'Failed to load folder structure' });
  }
});

// Simple parser for Apache/AutoIndex directory listing
function parseDirectoryListing(html, baseUrl) {
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
  const matches = [...html.matchAll(regex)];
  const items = [];

  for (const m of matches) {
    const href = m[1];
    const name = m[2].trim();

    if (name === 'Parent Directory' || href === '../') continue;

    const isFolder = href.endsWith('/');
    const fullPath = new URL(href, baseUrl).pathname;
    const itemUrl = `${REMOTE_BASE}${fullPath}`;

    if (isFolder) {
      items.push({
        type: 'folder',
        name: name,
        path: itemUrl,
      });
    } else if (href.endsWith('.pdf') || href.endsWith('.mp4')) {
      items.push({
        type: 'file',
        name: name,
        path: itemUrl,
        url: itemUrl,
      });
    }
  }

  return items;
}

// ========= Serve Files (PDFs, Videos) =========
app.get('/file', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });

  try {
    // Construct full remote URL
    const remoteUrl = `https://najuzi.com${filePath}`;

    // Security: Ensure URL starts with allowed base
    if (!remoteUrl.startsWith('https://najuzi.com/webapp/MobileApp')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch the file
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      return res.status(404).json({ error: 'File not found on remote server' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = filePath.split('/').pop();

    // Set content type
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(buffer);
    } else if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(buffer);
    } else {
      res.status(415).json({ error: 'Unsupported file type' });
    }
  } catch (err) {
    console.error('Error in /file:', err.message);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🔗 Test folder: https://webserver-zpgc.onrender.com/folder-tree?folder=AGRICULTURE`);
  console.log(`🔗 Test file: https://webserver-zpgc.onrender.com/file?path=/webapp/MobileApp/AGRICULTURE/NOTES/Basics.pdf`);
});
