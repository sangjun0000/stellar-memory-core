import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_PORT = 21547;
const API_URL = `http://localhost:${API_PORT}`;

let apiProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// API server lifecycle — uses system Node.js 24 (not Electron's Node 20)
// ---------------------------------------------------------------------------

function startApiServer(): ChildProcess {
  // dist/api/server.js relative to project root
  // electron/main.ts is compiled to dist-electron/main.js
  const projectRoot = join(__dirname, '..');
  const serverScript = join(projectRoot, 'dist', 'api', 'server.js');

  const proc = spawn('node', [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      STELLAR_API_PORT: String(API_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (data: Buffer) => {
    console.log(`[api] ${data.toString().trim()}`);
  });
  proc.stderr?.on('data', (data: Buffer) => {
    console.error(`[api] ${data.toString().trim()}`);
  });
  proc.on('error', (err) => {
    console.error('[api] Failed to start API server:', err.message);
  });

  return proc;
}

async function waitForServer(url: string, maxRetries = 30, intervalMs = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url + '/api/health');
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server did not start within ${maxRetries * intervalMs}ms`);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Stellar Memory',
    backgroundColor: '#050a14',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(API_URL);

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

ipcMain.handle('open-path', async (_event, filePath: string) => {
  return shell.openPath(filePath);
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  console.log('[stellar] Starting API server...');
  apiProcess = startApiServer();

  try {
    await waitForServer(API_URL);
    console.log('[stellar] API server ready');
  } catch (err) {
    console.error('[stellar] Failed to start API server:', err);
    app.quit();
    return;
  }

  mainWindow = createWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // macOS: re-create window on dock click
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

app.on('before-quit', () => {
  cleanup();
});

function cleanup() {
  if (apiProcess) {
    apiProcess.kill('SIGTERM');
    apiProcess = null;
  }
}
