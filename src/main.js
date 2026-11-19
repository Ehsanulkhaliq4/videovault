const { app, BrowserWindow, ipcMain, nativeImage, nativeTheme } = require('electron')
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const { log } = require('console');

let mainWindow;
let backendProcess;
let windowCreated = false;

function loadAppIcon() {
  const svgPath = path.join(__dirname, '../icons/app-icon.svg');
  const pngPath = path.join(__dirname, '../icons/app-icon.png');
  const icoPath = path.join(__dirname, '../icons/app-icon.ico');

  if (fs.existsSync(pngPath)) {
    return pngPath;
  }

  if (fs.existsSync(svgPath)) {
    return svgPath;
  }

  if (process.platform === 'darwin' && fs.existsSync(icnsPath)) {
    return icnsPath;
  }

  return undefined;
}

app.disableHardwareAcceleration();

// Keep the native window backdrop in sync with the OS theme so the splash
// page never flashes a light background while dark mode is active (or vice versa).
function getWindowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#0a0c14' : '#f4f6fb';
}

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(getWindowBackgroundColor());
  }
});

function createWindow() {
  if (windowCreated) return;
  windowCreated = true;
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon,
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor()
  });
  const splashPath = path.join(__dirname, 'splash.html');
  if (fs.existsSync(splashPath)) {
    mainWindow.loadFile(splashPath);
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Window failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window finished load');
  });

  mainWindow.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('Renderer DOM is ready');
  });

  const session = mainWindow.webContents.session;
  session.webRequest.onBeforeRequest({ urls: ['file:///api/*', 'http://*/*', 'https://*/*'] }, (details, callback) => {
    const apiUrl = details.url;
    if (!apiUrl.includes('/api/')) {
      return callback({ cancel: false });
    }

    if (apiUrl.startsWith('file:///api/')) {
      try {
        const url = new URL(apiUrl);
        const redirectURL = `http://localhost:8080${url.pathname}${url.search}`;
        return callback({ redirectURL });
      } catch (error) {
        return callback({ cancel: false });
      }
    }

    try {
      const parsed = new URL(apiUrl);
      if (parsed.origin === 'http://localhost:8080' && parsed.pathname === '/api/video/info') {
        const rawVideoUrl = parsed.searchParams.get('url');
        if (rawVideoUrl) {
          const sanitized = new URL('http://localhost:8080/api/video/info');
          sanitized.searchParams.set('url', rawVideoUrl);
          if (sanitized.toString() !== apiUrl) {
            return callback({ redirectURL: sanitized.toString() });
          }
        }
      }
    } catch (error) {
      // Not a valid URL, ignore and continue.
    }

    return callback({ cancel: false });
  });

  // Only forward renderer warnings and errors to main process logs.
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level === 1) {
      console.warn(`Renderer warning: ${message} (${sourceId}:${line})`);
    } else if (level >= 2) {
      console.error(`Renderer error: ${message} (${sourceId}:${line})`);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadFrontend() {
  const frontendPath = path.join(__dirname, '../frontend/dist/yt-downloader-ui/browser/index.html');
  if (fs.existsSync(frontendPath)) {
    mainWindow.loadFile(frontendPath);
  } else {
    mainWindow.loadURL('http://localhost:4200');
  }
}

function getBackendBinaryPath() {
  const backendFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'quarkus-backend')
    : path.join(__dirname, '../resources/quarkus-backend');
  const binaryName = process.platform === 'win32'
    ? 'yt-downloader-backend-runner.exe'
    : 'yt-downloader-backend-runner';
  return path.join(backendFolder, binaryName);
}

function startBackend() {
  let backendPath;
  if (app.isPackaged) {
    backendPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'quarkus-backend');
  } else {
    backendPath = path.join(__dirname, '../resources/quarkus-backend');
  }
  const binaryPath = getBackendBinaryPath();

  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const ytDlpExt = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

  const resourcesBasePath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "resources")
    : path.join(__dirname, "../resources");

  const possibleYtDlpPaths = [
    path.join(resourcesBasePath, "bin", platform, ytDlpExt),
    path.join(backendPath, "bin", platform, ytDlpExt),
    path.join(resourcesBasePath, ytDlpExt),
    path.join(backendPath, ytDlpExt),
    ytDlpExt,
  ];

  let ytDlpPath = null;
  for (const testPath of possibleYtDlpPaths) {
    if (!fs.existsSync(testPath)) continue;
    try {
      fs.accessSync(testPath, fs.constants.X_OK);
      ytDlpPath = testPath;
      break;
    } catch (err) {
      // Some installers drop the executable bit when unpacking; fix it and
      // try again. This is required for the unpacked AppImage/deb resources.
      try {
        fs.chmodSync(testPath, 0o755);
        fs.accessSync(testPath, fs.constants.X_OK);
        ytDlpPath = testPath;
        break;
      } catch (chmodErr) {
        console.error(`Cannot make yt-dlp executable at ${testPath}: ${chmodErr}`);
      }
    }
  }

  if (!ytDlpPath) {
    console.error('❌ yt-dlp not found in any location!');
    console.error(`Expected path: ${path.join(resourcesBasePath, 'bin', platform, ytDlpExt)}`);
    console.error('Please ensure yt-dlp exists in the correct location.');
    
    try {
      const binPath = path.join(resourcesBasePath, 'bin');
      if (fs.existsSync(binPath)) {
        console.error(`Contents of ${binPath}:`, fs.readdirSync(binPath));
        const platformPath = path.join(binPath, platform);
        if (fs.existsSync(platformPath)) {
          console.error(`Contents of ${platformPath}:`, fs.readdirSync(platformPath));
        }
      } else {
        console.error(`Bin path does not exist: ${binPath}`);
        console.error(`Resources path contents:`, fs.readdirSync(resourcesBasePath));
      }
    } catch (err) {
      console.error('Could not list directory contents:', err);
    }
  }

  if (!fs.existsSync(binaryPath)) {
    console.error(`ERROR: Binary file not found at ${binaryPath}.`);
    return;
  }

  // The backend reads YTDLP_PATH at runtime. YTDLP_BINARY is also exported
  // so it keeps working if Quarkus config mapping is used instead.
  const resolvedYtDlp = ytDlpPath || 'yt-dlp';
  const env = {
    ...process.env,
    YTDLP_PATH: resolvedYtDlp,
    YTDLP_BINARY: resolvedYtDlp,
  };

  if (ytDlpPath) {
    const binDir = path.dirname(ytDlpPath);
    env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
    console.log(`Using bundled yt-dlp: ${ytDlpPath}`);
  } else {
    console.warn('Bundled yt-dlp not found; falling back to yt-dlp on PATH');
  }

  backendProcess = spawn(binaryPath, {
    cwd: backendPath,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
    if (code !== 0) {
      console.error('Backend process exited before startup. It may have failed to bind the port or crashed.');
    }
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start native process directly:', err);
  });
}

function waitForBackend() {
  const maxAttempts = 30;
  let attempts = 0;
  let backendReady = false;

  const checkBackend = () => {
    const req = http.request('http://localhost:8080/api/download/checkHealth', { method: 'GET' }, (res) => {
      if (res.statusCode === 200) {
        backendReady = true;
        if (!windowCreated) {
          createWindow();
        }
        loadFrontend();
      } else {
        log(`Backend not ready yet (status: ${res.statusCode})`);
        scheduleNextAttempt();
      }
    });

    req.on('error', (err) => {
      attempts++;
      console.log(`Backend not ready yet (attempt ${attempts}/${maxAttempts})`);
      scheduleNextAttempt();
    });

    req.end();
  };

  const scheduleNextAttempt = () => {
    if (backendReady) {
      return;
    }
    if (attempts < maxAttempts) {
      setTimeout(checkBackend, 1000);
    } else {
      console.error('Backend failed to start after maximum attempts');
      if (!windowCreated) {
        createWindow(); // Create window anyway, but backend is unavailable
      }
      loadFrontend();
    }
  };

  checkBackend();
}

ipcMain.handle('download-file', async (event, fileData) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(fileData);
    
    const req = http.request('http://localhost:8080/api/download/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP error! status: ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
});

ipcMain.on('renderer-error', (event, error) => {
  console.error('Renderer error:', error);
});

ipcMain.on('renderer-unhandled-rejection', (event, data) => {
  console.error('Renderer unhandled rejection:', data);
});

app.whenReady().then(() => {
  console.log('Starting app...');
  createWindow();
  startBackend();

  setTimeout(waitForBackend, 2000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});