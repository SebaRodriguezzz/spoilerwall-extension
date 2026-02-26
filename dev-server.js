// SpoilerWall — minimal dev server for previewing extension pages
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') {
    res.writeHead(302, { Location: '/options/options.html' });
    res.end();
    return;
  }

  const filePath = path.join(ROOT, url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(`Not found: ${url}`);
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`SpoilerWall dev server running at http://localhost:${PORT}`);
  console.log(`Options page: http://localhost:${PORT}/options/options.html`);
  console.log(`Popup page:   http://localhost:${PORT}/popup/popup.html`);
});
