const { contextBridge, ipcRenderer } = require('electron');

const BACKEND_BASE = 'http://localhost:8080';
const API_PREFIX = '/api/';

function rewriteApiUrl(url) {
  if (!url || typeof url !== 'string') return url;

  if (url.startsWith(API_PREFIX)) {
    return `${BACKEND_BASE}${url}`;
  }

  if (url.startsWith('file:///') && url.includes(API_PREFIX)) {
    return `${BACKEND_BASE}${url.substring(url.indexOf(API_PREFIX))}`;
  }

  return url;
}

const originalFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  if (typeof input === 'string') {
    input = rewriteApiUrl(input);
  } else if (input instanceof Request) {
    const rewrittenUrl = rewriteApiUrl(input.url);
    if (rewrittenUrl !== input.url) {
      input = new Request(rewrittenUrl, input);
    }
  }
  return originalFetch(input, init);
};

const originalXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
  return originalXhrOpen.call(this, method, rewriteApiUrl(url), async, user, password);
};

contextBridge.exposeInMainWorld('electronAPI', {
  downloadFile: (fileData) => ipcRenderer.invoke('download-file', fileData),
  
  // Add other API methods as needed
  getBackendStatus: () => {
    return fetch(`${BACKEND_BASE}/api/download/checkHealth`)
      .then(response => response.ok)
      .catch(() => false);
  }
});

window.addEventListener('error', (event) => {
  ipcRenderer.send('renderer-error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error ? event.error.stack : null
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send('renderer-unhandled-rejection', {
    reason: event.reason,
    stack: event.reason?.stack || null
  });
});