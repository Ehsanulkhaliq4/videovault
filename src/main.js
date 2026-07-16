const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
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

  if (fs.existsSync(pngPath)) {
    return pngPath;
  }

  if (fs.existsSync(svgPath)) {
    return svgPath;
  }
  return undefined;
}

app.disableHardwareAcceleration();

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
    backgroundColor: '#f8fafc'
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
    console.log('Loading development frontend at http://localhost:4200');
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
  const backendPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'quarkus-backend')
    : path.join(__dirname, '../resources/quarkus-backend');
  const binaryPath = getBackendBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    console.error(`ERROR: Binary file not found at ${binaryPath}. Make sure it isn't an empty directory.`);
    return;
  }

  backendProcess = spawn(binaryPath, {
    cwd: backendPath,
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