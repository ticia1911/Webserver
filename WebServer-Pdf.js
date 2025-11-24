const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 10000;


const blockedAgents = [
  "idm",
  "internet download manager",
  "fdm",
  "free download manager",
  "1dm",
  "motrix",
  "downloader",
  "wget",
  "curl",
  "aria",
  "xunlei",
  "uget",
  "adm"
];

// Block if UA detected
app.use((req, res, next) => {
  const ua = (req.headers['user-agent'] || "").toLowerCase();
  if (blockedAgents.some(agent => ua.includes(agent))) {
    console.log(" BLOCKED DOWNLOADER →", ua);
    return res.status(403).send("Download manager blocked");
  }
  next();
});

app.use((req, res, next) => {
  const ref = req.headers.referer || "";

  if (req.path.startsWith('/file')) {
    if (
      !ref.includes('onrender.com') &&
      !ref.includes('localhost') &&
      !ref.includes('/pdfjs/')
    ) {
      console.log(" HOTLINK BLOCK:", ref);
      return res.status(403).send("Hotlink blocked");
    }
  }
  next();
});


app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range'],
}));

// Static
app.use('/public', express.static('public'));

const JSON_URL = 'https://najuzi.com/webapp/MobileApp/directory.json';
const BASE_FILE_URL = 'https://najuzi.com/webapp/MobileApp/';
const SECRET_TOKEN = "NAJUZI_SECURE_BROWSER_ONLY";

// -----------------------------------------------------

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


async function handleVideoStreaming(filePath, req, res) {

  if (
      req.headers['sec-fetch-dest'] === 'empty' ||
      req.headers['accept'] === '*/*'
  ) {
    return res.status(403).send('Streaming only');
  }

  const videoUrl = `${BASE_FILE_URL}${filePath}`;
  const range = req.headers.range;

  if (!range) {
    const response = await fetch(videoUrl);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return response.body.pipe(res);
  }

  const stream = await fetch(videoUrl, { headers: { Range: range } });

  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
    'Content-Range': stream.headers.get('content-range'),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  stream.body.pipe(res);
}

app.get('/file', async (req, res) => {
  try {
    let filePath = cleanPath(req.query.path);
    const token = req.query.token || '';

    if (!filePath) return res.status(400).send('Path required');
    if (!isAllowedFile(filePath)) return res.status(403).send('Invalid');
    if (token !== SECRET_TOKEN) return res.status(403).send('No token');

    const lower = filePath.toLowerCase();

    if (lower.endsWith('.mp4')) {
      return handleVideoStreaming(filePath, req, res);
    }

   
    const fileUrl = BASE_FILE_URL + filePath;
    const response = await fetch(fileUrl);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="secure.pdf"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self';");

    return response.body.pipe(res);

  } catch (err) {
    console.log("Stream error:", err);
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
  res.send('Secure streaming server running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
