const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
let normal = null;
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const mm = require('music-metadata');
const EXT = /\.(mp3|m4a|flac|wav|ogg|aac|opus)$/i;
const covers = path.join(app.getPath('userData'), 'covers');
const stateFile = path.join(app.getPath('userData'), 'state.json');

/* persistence: queue, folder, current track, position, volume and preferences */
let state = {}, timer;
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
const writeState = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {} };
ipcMain.handle('state-load', () => state);
ipcMain.on('state-save', (e, o) => { Object.assign(state, o); clearTimeout(timer); timer = setTimeout(writeState, 300); });
app.on('before-quit', () => { clearTimeout(timer); writeState(); });

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1); else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

async function readTrack(p) {
  let c = {}, dur = 0, cover = null, f = {};
  try {
    const m = await mm.parseFile(p, { duration: true });
    c = m.common; f = m.format; dur = f.duration || 0;
    const pic = mm.selectCover(c.picture);
    if (pic) {
      const file = path.join(covers, crypto.createHash('md5').update(pic.data).digest('hex') + (pic.format.includes('png') ? '.png' : '.jpg'));
      if (!fs.existsSync(file)) fs.writeFileSync(file, pic.data);
      cover = pathToFileURL(file).href;
    }
  } catch {}
  return {
    url: pathToFileURL(p).href, title: c.title || path.basename(p, path.extname(p)),
    artist: c.artist || 'Unknown Artist', album: c.album || 'Unknown Album',
    year: c.year || '', albumArtist: c.albumartist || '', dir: path.dirname(p), disc: (c.disk && c.disk.no) || 0,
    ext: path.extname(p).slice(1).toUpperCase(), kbps: f.bitrate ? Math.round(f.bitrate / 1000) : 0,
    hz: f.sampleRate || 0, bits: f.bitsPerSample || 0,
    no: (c.track && c.track.no) || 0, dur, cover
  };
}

async function scanDir(dir) {
  fs.mkdirSync(covers, { recursive: true });
  const files = walk(dir), out = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < files.length) out.push(await readTrack(files[i++])); }));
  return out.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.no - b.no);
}

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (r.canceled) return null;
  return { folder: r.filePaths[0], tracks: await scanDir(r.filePaths[0]) };
});
ipcMain.handle('scan', async (e, dir) => (dir && fs.existsSync(dir)) ? scanDir(dir) : null);

ipcMain.on('win', (e, cmd) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (cmd === 'close') w.close();
  else if (cmd === 'min') w.minimize();
  else if (cmd === 'max') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (cmd === 'mini' && !normal) {            // small fixed-size always-on-top window in the screen corner
    normal = { b: w.getNormalBounds(), max: w.isMaximized(), z: w.webContents.getZoomLevel() };
    w.webContents.setZoomLevel(0);
    if (normal.max) w.unmaximize();
    const wa = screen.getDisplayMatching(w.getBounds()).workArea, W = 320, H = 176;
    // resize FIRST while the window is still resizable, then lock it (locking first leaves the page laid out at the old size)
    w.setResizable(true);
    w.setMinimumSize(1, 1);
    w.setMaximumSize(0, 0);
    w.setBounds({ x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16, width: W, height: H });
    w.setContentSize(W, H);
    w.setMinimumSize(W, H);
    w.setMaximumSize(W, H);
    w.setResizable(false);
    w.setMaximizable(false);
    w.setAlwaysOnTop(true, 'floating');
  } else if (cmd === 'unmini' && normal) {
    w.setAlwaysOnTop(false);
    w.setResizable(true);
    w.setMaximizable(true);
    w.setMaximumSize(0, 0);                         // 0,0 = no maximum
    w.setMinimumSize(820, 640);
    w.webContents.setZoomLevel(normal.z);
    w.setBounds(normal.b);
    w.setContentSize(normal.b.width, normal.b.height);
    if (normal.max) w.maximize();
    normal = null;
  }
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1040, height: 780, minWidth: 820, minHeight: 640, frame: false,
    backgroundColor: '#d5ccb4', title: 'Tape Deck',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('index.html');
  // Ctrl + / Ctrl - / Ctrl 0 zoom (disabled while pinned so the mini player stays a fixed size)
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !(i.control || i.meta)) return;
    if (normal) return;
    const z = win.webContents;
    if (i.key === '=' || i.key === '+') { z.setZoomLevel(Math.min(z.getZoomLevel() + 0.5, 3)); e.preventDefault(); }
    else if (i.key === '-' || i.key === '_') { z.setZoomLevel(Math.max(z.getZoomLevel() - 0.5, -3)); e.preventDefault(); }
    else if (i.key === '0') { z.setZoomLevel(0); e.preventDefault(); }
  });
});
app.on('window-all-closed', () => app.quit());
