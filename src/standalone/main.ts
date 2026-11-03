import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, net, protocol, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { OfficeEngine, OfficeUpdate } from '../core/engine';
import { resolveSettings } from '../core/settings';
import { officePage } from '../view/officePage';
import {
  AppState,
  dropRecent,
  ensureSettingsFile,
  projectFolders,
  pushRecent,
  readSettingsFile,
  readState,
  StandaloneFile,
  writeState,
} from './store';

const ROOT = path.join(__dirname, '..', '..');
const MEDIA = path.join(ROOT, 'media');
// Fixé avant tout accès à userData : en développement, le nom par défaut serait « Electron ».
app.setName('Agent Office');
const isMac = process.platform === 'darwin';

/** Une fenêtre = un répertoire de travail (comme une fenêtre VS Code) et son propre relevé des agents. */
interface OfficeWindow {
  win: BrowserWindow;
  engine: OfficeEngine;
  folder?: string;
}

const offices = new Map<number, OfficeWindow>();
let settingsFile = '';
let stateFile = '';
let state: AppState = { recents: [] };
let watcher: fs.FSWatcher | undefined;
/** Contenu du fichier de réglages, relu seulement quand il change (voir watchSettings). */
let fileSettings: StandaloneFile = {};

function send(o: OfficeWindow, msg: unknown): void {
  if (!o.win.isDestroyed()) {
    o.win.webContents.send('office:message', msg);
  }
}

function folderName(dir: string): string {
  return path.basename(dir) || dir;
}

function updateTitle(o: OfficeWindow): void {
  const summary = o.engine.last?.summary.text;
  o.win.setTitle(['Agent Office', o.folder ? folderName(o.folder) : 'no folder', summary].filter(Boolean).join(' — '));
}

function render(o: OfficeWindow, update: OfficeUpdate | undefined = o.engine.last): void {
  if (!update) {
    return;
  }
  send(o, { type: 'snapshot', ...update });
  updateTitle(o);
  updateBadge();
}

/** Badge du Dock (macOS) : allumé tant qu'un agent travaille dans l'une des fenêtres ouvertes. */
function updateBadge(): void {
  if (isMac) {
    const working = [...offices.values()].some((w) => w.engine.last?.summary.kind === 'active');
    app.dock?.setBadge(working ? '●' : '');
  }
}

function sendFolders(o: OfficeWindow): void {
  send(o, {
    type: 'folders',
    current: o.folder ?? null,
    recents: state.recents.map((p) => ({ path: p, name: folderName(p) })),
  });
}

/** Mémorise la liste des répertoires, puis rafraîchit les barres de dossier et le menu de toutes les fenêtres. */
function saveState(next: AppState): void {
  state = next;
  writeState(stateFile, state);
  offices.forEach(sendFolders);
  buildMenu();
}

/** Fait travailler une fenêtre sur ce répertoire. Un répertoire introuvable est retiré de la liste. */
function setFolder(o: OfficeWindow, dir: string): void {
  const folder = path.resolve(dir);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    void dialog.showMessageBox(o.win, {
      type: 'warning',
      message: `This folder no longer exists:\n${folder}`,
      detail: 'It was removed from the recent list.',
    });
    saveState(dropRecent(state, folder));
    return;
  }
  o.folder = folder;
  saveState(pushRecent(state, folder));
  updateTitle(o);
  void o.engine.tick();
}

async function pickFolder(parent: BrowserWindow | undefined): Promise<string | undefined> {
  const options = {
    title: 'Working folder (its .claude/agents are shown with your own agents)',
    properties: ['openDirectory' as const],
    defaultPath: state.lastFolder,
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseFolder(o: OfficeWindow): Promise<void> {
  const dir = await pickFolder(o.win);
  if (dir) {
    setFolder(o, dir);
  }
}

/** Nouvelle fenêtre sur un répertoire connu, ou choisi dans une boîte de dialogue. */
async function newWindow(dir?: string): Promise<void> {
  const folder = dir ?? (await pickFolder(BrowserWindow.getFocusedWindow() ?? undefined));
  if (!folder) {
    return;
  }
  const o = createWindow();
  setFolder(o, folder);
}

function focused(): OfficeWindow | undefined {
  const win = BrowserWindow.getFocusedWindow();
  return (win && offices.get(win.webContents.id)) || [...offices.values()][0];
}

/** Ouvre le .md d'un agent dans l'application associée au système ; seul un fichier découvert peut l'être. */
async function openAgent(o: OfficeWindow, id: unknown): Promise<void> {
  const file = o.engine.fileOf(id);
  if (!file) {
    return;
  }
  const error = await shell.openPath(file);
  if (error) {
    shell.showItemInFolder(file);
  }
}

const SCHEME = 'agent-office';

// Les ressources sont servies par un schéma dédié : la CSP `'self'` y est fiable, contrairement à file://.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

function pageHtml(): string {
  // Aucun réseau ni script en ligne : seuls les fichiers de l'application sont chargés.
  const csp = "default-src 'none'; style-src 'self'; img-src 'self' data:; script-src 'self'";
  return officePage({ csp, styles: ['office.css', 'standalone.css'], scripts: ['standalone.js', 'office.js'] });
}

function serveMedia(request: Request): Response | Promise<Response> {
  const name = decodeURIComponent(new URL(request.url).pathname);
  if (name === '/' || name === '/index.html') {
    return new Response(pageHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const file = path.normalize(path.join(MEDIA, name));
  // Seul le dossier media/ est accessible.
  if (!file.startsWith(MEDIA + path.sep)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow(): OfficeWindow {
  // Une nouvelle fenêtre est décalée par rapport à celle qui a le focus.
  const ref = BrowserWindow.getFocusedWindow()?.getBounds();
  const win = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 480,
    minHeight: 420,
    title: 'Agent Office',
    icon: path.join(MEDIA, 'extension-icon.png'),
    backgroundColor: '#1e1e1e',
    ...(ref ? { x: ref.x + 28, y: ref.y + 28 } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const id = win.webContents.id;
  const o: OfficeWindow = {
    win,
    engine: new OfficeEngine({
      settings: () => resolveSettings(fileSettings),
      // Le répertoire de la fenêtre, puis les dossiers toujours lus (`projectFolders` du fichier de réglages).
      projectDirs: () => [...new Set([...(o.folder ? [o.folder] : []), ...projectFolders(fileSettings)])],
      onUpdate: (update) => render(o, update),
    }),
  };
  offices.set(id, o);
  // Le titre de la fenêtre reflète le répertoire et l'état des agents : la page ne le remplace pas.
  win.on('page-title-updated', (e) => e.preventDefault());
  // Aucune navigation ni fenêtre externe depuis la page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    o.engine.stop();
    offices.delete(id);
    updateBadge();
  });
  void win.loadURL(`${SCHEME}://app/`);
  o.engine.start();
  return o;
}

function buildMenu(): void {
  const recent = (click: (dir: string) => void, keys = false): MenuItemConstructorOptions[] =>
    state.recents.length
      ? state.recents.map((dir, i) => ({
          label: `${folderName(dir)} — ${dir}`,
          accelerator: keys && i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
          click: () => click(dir),
        }))
      : [{ label: 'No recent folder', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const o = focused();
            if (o) {
              void chooseFolder(o);
            }
          },
        },
        { label: 'New Window…', accelerator: 'CmdOrCtrl+N', click: () => void newWindow() },
        { type: 'separator' },
        {
          label: 'Open Recent',
          submenu: recent((dir) => {
            const o = focused();
            if (o) {
              setFolder(o, dir);
            }
          }, true),
        },
        { label: 'Open Recent in New Window', submenu: recent((dir) => void newWindow(dir)) },
        { label: 'Remove from Recent List', submenu: recent((dir) => saveState(dropRecent(state, dir))) },
        {
          label: 'Clear Recent List',
          enabled: state.recents.length > 0,
          click: () => saveState({ recents: [], lastFolder: undefined }),
        },
        { type: 'separator' },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => void focused()?.engine.tick() },
        {
          label: 'Open Settings File',
          click: async () => {
            ensureSettingsFile(settingsFile);
            await shell.openPath(settingsFile);
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function watchSettings(): void {
  ensureSettingsFile(settingsFile);
  fileSettings = readSettingsFile(settingsFile);
  let timer: NodeJS.Timeout | undefined;
  // On surveille le dossier (les éditeurs remplacent souvent le fichier) et on regroupe les rafales d'événements.
  watcher = fs.watch(path.dirname(settingsFile), (_event, name) => {
    if (name === path.basename(settingsFile)) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fileSettings = readSettingsFile(settingsFile);
        offices.forEach((o) => o.engine.onSettingsChanged());
      }, 300);
    }
  });
}

interface PageMessage {
  type?: string;
  id?: unknown;
  path?: unknown;
}

function onMessage(o: OfficeWindow, msg: PageMessage | undefined): void {
  // Un chemin venu de la page n'est accepté que s'il est dans la liste des répertoires récents.
  const known = typeof msg?.path === 'string' && state.recents.includes(msg.path) ? msg.path : undefined;
  switch (msg?.type) {
    case 'ready':
      // `auto` : la page suit la préférence « réduire les animations » du système.
      send(o, { type: 'motion', reduceMotion: 'auto' });
      sendFolders(o);
      render(o);
      break;
    case 'openAgent':
      void openAgent(o, msg.id);
      break;
    case 'chooseFolder':
      void chooseFolder(o);
      break;
    case 'newWindow':
      void newWindow(known);
      break;
    case 'switchFolder':
      if (known) {
        setFolder(o, known);
      }
      break;
    case 'removeRecent':
      if (known) {
        saveState(dropRecent(state, known));
      }
      break;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const o = focused();
    if (o) {
      if (o.win.isMinimized()) {
        o.win.restore();
      }
      o.win.focus();
    }
  });

  void app.whenReady().then(async () => {
    protocol.handle(SCHEME, serveMedia);
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    stateFile = path.join(app.getPath('userData'), 'state.json');
    state = readState(stateFile);
    ipcMain.on('office:message', (event, msg: PageMessage | undefined) => {
      const o = offices.get(event.sender.id);
      if (o) {
        onMessage(o, msg);
      }
    });
    buildMenu();
    watchSettings();
    const first = createWindow();
    if (state.lastFolder && fs.existsSync(state.lastFolder)) {
      setFolder(first, state.lastFolder);
    } else if (state.recents.length === 0) {
      // Premier lancement : sans répertoire, seuls vos propres agents (~/.claude/agents) apparaissent.
      await chooseFolder(first);
    }
    app.on('activate', () => {
      if (offices.size === 0) {
        const o = createWindow();
        if (state.lastFolder) {
          setFolder(o, state.lastFolder);
        }
      }
    });
  });

  // Sur macOS, l'application reste ouverte sans fenêtre (clic sur l'icône du Dock : voir `activate`).
  app.on('window-all-closed', () => {
    if (!isMac) {
      app.quit();
    }
  });
  app.on('will-quit', () => watcher?.close());
}
