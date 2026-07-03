// AllMansSky — Electron shell for the Steam build.
// Serves the game from an in-process loopback HTTP server (ES modules and
// import maps cannot load over file://), then opens a frameless game window.
const { app, BrowserWindow, globalShortcut, Menu } = require('electron');
const http = require('node:http');
const { createReadStream, promises: fsp } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');   // repo root inside the packaged app
const DEV = process.argv.includes('--debug');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const rel = urlPath === '/' ? '/index.html' : urlPath;
        const file = path.resolve(path.join(ROOT, path.normalize(rel)));
        if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
        const info = await fsp.stat(file).catch(() => null);
        if (!info?.isFile()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        createReadStream(file).pipe(res);
      } catch (err) {
        console.error(err);
        res.writeHead(500); res.end();
      }
    });
    // loopback only — nothing is exposed to the network
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: !DEV,
    title: 'AllMansSky',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
  globalShortcut.register('Alt+Enter', () => win.setFullScreen(!win.isFullScreen()));
}

// one game window, ever
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
