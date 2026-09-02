// 极简静态服务器：serve dist/（SPA 回退到 index.html）
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "dist");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "video/webm", ".mp4": "video/mp4",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".ttf": "font/ttf",
};
http.createServer((req, res) => {
  try {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    let fp = path.join(ROOT, p);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(ROOT, "index.html");
    const ext = path.extname(fp).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    res.statusCode = 500;
    res.end("server error");
  }
}).listen(4173, () => console.log("SongLearn static server on http://localhost:4173"));
