const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;


const blockedAgents = [
  "IDM",
  "Internet Download Manager",
  "FDM",
  "Free Download Manager",
  "Xtreme",
  "Xtreme Download Manager",
  "1DM",
  "uGet",
  "Motrix",
  "DownThemAll",
  "ADM",
  "HTTP Downloader"
];

app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (blockedAgents.some(agent => ua.toLowerCase().includes(agent.toLowerCase()))) {
    console.log(`Blocked Downloader: ${ua}`);
    return res.status(403).send('Download manager blocked');
  }
  next();
});


app.use((req, res, next) => {
  const ref = req.headers.referer || '';

  // Allow only your own domain + pdf viewer
  if (
    req.path.startsWith('/file') &&
    !ref.includes('onrender.com') &&
    !ref.includes('localhost')
  ) {
    return res.status(403).send('Hotlinking blocked');
  }
  next();
});


app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

// Static content
app.use('/public', express.static('public'));

const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';
const SECRET_TOKEN = "NAJUZI_SECURE"; // You can change



async function fetchDirectoryJSON() {
  const res = await fetch(JSON_URL);
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error("JSON not reachable");

  if (type.includes('json')) return res.json();
  if (type.includes('html')) {
    const text = await res.text();
    return { html: text };
  }

  throw new Error("Unsupported content-type");
}

function getNodeAtPath(tree, pathParam) {
  if (!pathParam) return tree;
  const segments = pathParam.split('/').filter(Boolean);
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

function isAllowedFile(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.mp4');
}



function searchFiles(node, path, keyword) {
  let results = [];

  if (node.files) {
    node.files.forEach(file => {
      if (isAllowedFile(file) && file.toLowerCase().includes(keyword.toLowerCase())) {
        results.push({
          name: file,
          isFolder: false,
          path: path ? `${path}/${file}` : file
        });
      }
    });
  }

  for (const key in node) {
    if (key !== 'files') {
      results = results.concat(searchFiles(node[key], path ? `${path}/${key}` : key, keyword));
    }
  }

  return results;
}



app.get('/list', async (req, res) => {
  try {
    let pathParam = cleanPath(req.query.path || '');
    const searchKeyword = req.query.search || '';

    const tree = await fetchDirectoryJSON();
    if (tree.html) return res.status(500).send(tree.html);

    const node = getNodeAtPath(tree, pathParam);
    if (!node) return res.status(404).json({ error: 'Path not found' });

    if (searchKeyword.trim() !== '') {
      return res.json(searchFiles(node, pathParam, searchKeyword));
    }

    const folders = [];
    const files = [];

    for (const key in node) {
      if (key !== 'files') folders.push({ name: key, isFolder: true, path: `${pathParam}/${key}`.replace(/^\/+/,'') });
    }

    if (folders.length === 0 && node.files) {
      node.files.forEach(file => {
        if (isAllowedFile(file)) {
          files.push({
            name: file,
            isFolder: false,
            path: `${pathParam}/${file}`.replace(/^\/+/,'')
          });
        }
      });
    }

    res.json(folders.length ? folders : files);

  } catch (e) {
    console.error(e);
    res.status(500).send('List failed');
  }
});



async function handleVideoStreaming(filePath, req, res) {
  const videoUrl = `${BASE_FILE_URL}${filePath}`;
  const range = req.headers.range;

  if (!range) {
    const full = await fetch(videoUrl);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    return full.body.pipe(res);
  }

  const partial = await fetch(videoUrl, { headers: { Range: range } });

  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': partial.headers.get('content-length')
  };

  if (partial.headers.get('content-range')) {
    headers['Content-Range'] = partial.headers.get('content-range');
    res.writeHead(206, headers);
  } else {
    res.writeHead(200, headers);
  }

  return partial.body.pipe(res);
}



app.get('/file', async (req, res) => {
  try {
    let filePath = cleanPath(req.query.path);
    const token = req.query.token || '';

    if (!filePath) return res.status(400).send('File required');
    if (!isAllowedFile(filePath)) return res.status(400).send('Invalid file');
    if (token !== SECRET_TOKEN) return res.status(403).send('No token');

    const lower = filePath.toLowerCase();

    if (lower.endsWith('.mp4')) {
      return handleVideoStreaming(filePath, req, res);
    }

    const fileUrl = BASE_FILE_URL + filePath;
    const response = await fetch(fileUrl);

    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    response.body.pipe(res);

  } catch (err) {
    console.log(err);
    res.status(500).send('Stream error');
  }
});



app.get('/view', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).send("Path missing");

  const safeUrl =
    `/public/pdfjs/web/viewer.html?file=` +
    encodeURIComponent(`/file?path=${p}&token=${SECRET_TOKEN}`);

  res.redirect(safeUrl);
});



app.get('/', (req, res) => {
  res.send(' Secure server running');
});



app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

