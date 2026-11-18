// ==============================================================================
// ALL-IN-ONE RUNNER: Starts server in background, runs tests, and shuts down
// ==============================================================================

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting server.js automatically in background...\n');

const server = spawn('node', [path.join(__dirname, 'server.js')], {
  stdio: 'inherit',
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Wait for server to be ready, then run tests
async function waitForServerAndTest() {
  let attempts = 0;
  while (attempts < 20) {
    try {
      const res = await fetch('http://127.0.0.1:8080/health');
      if (res.status === 200) {
        break;
      }
    } catch (e) {
      // Waiting
    }
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  // Run the test script
  const testProcess = spawn('node', [path.join(__dirname, 'test-api.js')], {
    stdio: 'inherit',
  });

  testProcess.on('exit', (code) => {
    // Stop server
    server.kill();
    process.exit(code);
  });
}

waitForServerAndTest();
