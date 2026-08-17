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

function normalizeVideoInfoUrl(url) {
  if (typeof url !== 'string') {
    return url;
  }

  const normalizedBase = 'http://localhost:8080/api/video/info';

  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.origin === 'http://localhost:8080' && parsed.pathname === '/api/video/info') {
      const existingUrl = parsed.searchParams.get('url');
      if (existingUrl) {
        const sanitized = new URL(normalizedBase);
        sanitized.searchParams.set('url', existingUrl);
        return sanitized.href;
      }
    }
  } catch (error) {
    // Ignore invalid URLs and fallback to the original value.
  }

  const rawMatch = url.match(/([?&])url=(.*)$/i);
  if (rawMatch) {
    const rawValue = decodeURIComponent(rawMatch[2]);
    const base = url.slice(0, rawMatch.index + rawMatch[1].length + 4);
    const target = `${base}${encodeURIComponent(rawValue)}`;
    return target;
  }

  return url;
}

const originalFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  if (typeof input === 'string') {
    input = normalizeVideoInfoUrl(rewriteApiUrl(input));
  } else if (input instanceof Request) {
    const rewrittenUrl = normalizeVideoInfoUrl(rewriteApiUrl(input.url));
    if (rewrittenUrl !== input.url) {
      input = new Request(rewrittenUrl, input);
    }
  }
  return originalFetch(input, init);
};

const originalXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
  return originalXhrOpen.call(this, method, normalizeVideoInfoUrl(rewriteApiUrl(url)), async, user, password);
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