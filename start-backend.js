const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function startBackend() {
  const backendPath = path.join(__dirname, 'src/backend');
  
  console.log('Starting Quarkus backend...');
  
  if (fs.existsSync(path.join(backendPath, 'mvnw'))) {
    const backend = spawn('./mvnw', ['quarkus:dev'], {
      cwd: backendPath,
      stdio: 'inherit',
      shell: true
    });

    backend.on('error', (err) => {
      console.error('Failed to start backend:', err);
    });

    return backend;
  } else {
    console.error('Backend not found at:', backendPath);
    return null;
  }
}

module.exports = startBackend;