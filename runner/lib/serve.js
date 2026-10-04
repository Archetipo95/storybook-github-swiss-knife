import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// Minimal static server for a built Storybook (Playwright webServer). No directory listing,
// no paths outside the root.

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

/**
 * @param {string} root
 * @param {string} urlPath
 */
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const index = path.join(resolved, 'index.html');
    return fs.existsSync(index) ? index : null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * @param {string} rootDir
 */
export function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  return http.createServer((request, response) => {
    const file =
      request.method === 'GET' || request.method === 'HEAD' ? resolveStaticPath(root, request.url ?? '/') : null;
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'max-age=3600'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [rootDir, port] = process.argv.slice(2);
  if (!rootDir || !port) {
    console.error('Usage: node serve.js <storybook-static> <port>');
    process.exit(1);
  }
  createStaticServer(rootDir).listen(Number(port), '127.0.0.1');
}
