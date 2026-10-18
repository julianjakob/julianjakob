// Static server like GitHub Pages: /about → about.html, unknown paths → 404.html,
// nothing cached, byte ranges for video. Optional bandwidth limit in Mbit/s (shared by all
// responses, like one real connection):   node server.cjs <site folder> <port> [mbit]
const http = require("http"), fs = require("fs"), path = require("path"), { Transform } = require("stream");
const root = path.resolve(process.argv[2] || ".."), port = +process.argv[3] || 8767, mbit = +process.argv[4] || 0;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain", ".xml": "application/xml", ".ico": "image/x-icon" };
let budgetAt = Date.now();
const throttle = () => new Transform({ transform(chunk, enc, cb) {
  if (!mbit) return cb(null, chunk);
  budgetAt = Math.max(budgetAt, Date.now()) + chunk.length / (mbit * 1e6 / 8 / 1000);
  setTimeout(() => cb(null, chunk), budgetAt - Date.now());
} });
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(root, p), status = 200;
  if (p.endsWith("/")) f = path.join(f, "index.html");
  else if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { f = path.join(root, "404.html"); status = 404; }
  const size = fs.statSync(f).size, head = { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range && status === 200) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(f, { start, end, highWaterMark: 16384 }).pipe(throttle()).pipe(res);
  } else { res.writeHead(status, { ...head, "Content-Length": size }); fs.createReadStream(f, { highWaterMark: 16384 }).pipe(throttle()).pipe(res); }
}).listen(port, "0.0.0.0", () => { if (require.main === module && !process.env.QUIET) console.log(`serving ${root} on http://localhost:${port}${mbit ? ` at ${mbit} Mbit/s` : ""}`); });
