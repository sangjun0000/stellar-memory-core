import { app, BrowserWindow, shell, ipcMain, dialog, utilityProcess } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { createServer } from 'net';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_PORT = 21547;
const API_URL = `http://localhost:${API_PORT}`;

let apiProcess: Electron.UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Port availability check
// ---------------------------------------------------------------------------

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

// ---------------------------------------------------------------------------
// API server lifecycle — uses Electron's built-in Node.js (no system Node)
// ---------------------------------------------------------------------------

function startApiServer(): Electron.UtilityProcess {
  const projectRoot = join(__dirname, '..');
  // In packaged app, asarUnpack extracts dist/ to app.asar.unpacked/dist/
  const serverScript = app.isPackaged
    ? join(projectRoot + '.unpacked', 'dist', 'api', 'server.js')
    : join(projectRoot, 'dist', 'api', 'server.js');

  // Validate server script exists
  if (!existsSync(serverScript)) {
    dialog.showErrorBox(
      'Stellar Memory — 시작 오류',
      `API 서버 파일을 찾을 수 없습니다:\n${serverScript}\n\n빌드가 완료되었는지 확인해주세요.`,
    );
    app.quit();
    throw new Error(`Server script not found: ${serverScript}`);
  }

  const proc = utilityProcess.fork(serverScript, [], {
    cwd: projectRoot,
    env: {
      ...process.env,
      STELLAR_API_PORT: String(API_PORT),
    },
    stdio: 'pipe',
  });

  proc.stdout?.on('data', (data: Buffer) => {
    console.log(`[api] ${data.toString().trim()}`);
  });
  proc.stderr?.on('data', (data: Buffer) => {
    console.error(`[api] ${data.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[api] Server exited with code ${code}`);
      dialog.showErrorBox(
        'Stellar Memory — 서버 오류',
        `API 서버가 예기치 않게 종료되었습니다 (코드: ${code}).\n\n앱을 다시 시작해주세요.`,
      );
      apiProcess = null;
      app.quit();
    }
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
  // Check port availability before starting server
  const portAvailable = await checkPort(API_PORT);
  if (!portAvailable) {
    dialog.showErrorBox(
      'Stellar Memory — 포트 충돌',
      `포트 ${API_PORT}이 이미 사용 중입니다.\n\n다른 프로그램이 해당 포트를 사용하고 있는지 확인해주세요.`,
    );
    app.quit();
    return;
  }

  console.log('[stellar] Starting API server...');
  apiProcess = startApiServer();

  try {
    await waitForServer(API_URL);
    console.log('[stellar] API server ready');
  } catch (err) {
    console.error('[stellar] Failed to start API server:', err);
    dialog.showErrorBox(
      'Stellar Memory — 서버 시작 실패',
      `API 서버가 시간 내에 시작되지 않았습니다.\n\n로그를 확인하거나 앱을 다시 시작해주세요.`,
    );
    cleanup();
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
    apiProcess.kill();
    apiProcess = null;
  }
}
