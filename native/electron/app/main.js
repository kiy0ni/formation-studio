// Formation Studio — desktop app (Mac / Windows). Serves the built web app from inside the package.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB = path.join(__dirname, 'web');
const ORIGIN = 'app://formation';

// a secure, stable origin: offline storage (IndexedDB) lives here and survives updates
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
};

function createWindow(route = '') {
  const state = route ? {} : readState();
  const win = new BrowserWindow({
    width: state.width ?? 1360,
    height: state.height ?? 860,
    x: state.x,
    y: state.y,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Formation Studio',
    backgroundColor: '#0f0d17',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // the page never zooms (trackpad pinch, Ctrl/Cmd +/-): the app zooms its own stage and timeline
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault();
  });

  // app screens open in new app windows, web links in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1200, height: 820, backgroundColor: '#0f0d17', autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (!route) {
    win.on('close', () => {
      try {
        fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
      } catch {
        /* read-only profile */
      }
    });
  }
  win.loadURL(`${ORIGIN}/index.html${route}`);
  return win;
}

function buildMenu() {
  if (process.platform !== 'darwin') return null;
  // no Undo/Redo/Select all roles: those shortcuts belong to the app (undo a move, select all dancers)
  return Menu.buildFromTemplate([
    {
      label: 'Formation Studio',
      submenu: [
        { role: 'about', label: 'À propos de Formation Studio' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Formation Studio' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Formation Studio' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
      ],
    },
    {
      label: 'Fenêtre',
      submenu: [
        { label: 'Nouvelle fenêtre', accelerator: 'CmdOrCtrl+N', click: () => createWindow('#/') },
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Agrandir' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'close', label: 'Fermer la fenêtre' },
      ],
    },
  ]);
}

let mainWindow = null;

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB)) return new Response('Accès refusé', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
  app.setAboutPanelOptions({ applicationName: 'Formation Studio', applicationVersion: app.getVersion(), copyright: 'Chorégraphies K-pop' });
  Menu.setApplicationMenu(buildMenu());
  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
