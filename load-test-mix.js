// load-test-mix.js - Simulates realistic competition traffic mix at controlled RPS
const http = require('http');

const AGENT = new http.Agent({
  keepAlive: true,
  maxSockets: 1000,
});

const TARGET_RPS = parseInt(process.argv[2] || '3000', 10);
const DURATION_SEC = parseInt(process.argv[3] || '10', 10);

console.log(`\n======================================================`);
console.log(`🚀 STARTING BENCHMARK: Target ${TARGET_RPS} req/s for ${DURATION_SEC}s`);
console.log(`Traffic mix: 60% GET /products/:id, 15% GET category, 20% POST /orders, 5% GET user orders`);
console.log(`======================================================\n`);

const latencies = [];
let totalRequests = 0;
let successCount = 0;
let errorCount = 0;

function sendRequest(type) {
  totalRequests++;
  const start = process.hrtime.bigint();

  let options;
  let postData = null;

  if (type === 'PRODUCT') {
    options = {
      hostname: '127.0.0.1',
      port: 8080,
      path: '/products/p3f9a0c2e71bd',
      method: 'GET',
      agent: AGENT,
    };
  } else if (type === 'CATEGORY') {
    options = {
      hostname: '127.0.0.1',
      port: 8080,
      path: '/products?category=electronics&page=1&limit=20',
      method: 'GET',
      agent: AGENT,
    };
  } else if (type === 'USER_ORDERS') {
    options = {
      hostname: '127.0.0.1',
      port: 8080,
      path: '/users/test_user/orders',
      method: 'GET',
      agent: AGENT,
    };
  } else {
    // ORDER (20%)
    postData = JSON.stringify({
      userId: `user_${Math.floor(Math.random() * 50000)}`,
      productId: 'p0c4be91a3f25',
    });
    options = {
      hostname: '127.0.0.1',
      port: 8080,
      path: '/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      agent: AGENT,
    };
  }

  const req = http.request(options, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      const end = process.hrtime.bigint();
      const latencyMs = Number(end - start) / 1e6;
      latencies.push(latencyMs);

      // 200, 201, 409 are valid answers
      if (res.statusCode >= 200 && res.statusCode < 500) {
        successCount++;
      } else {
        errorCount++;
      }
    });
  });

  req.on('error', () => {
    errorCount++;
  });

  if (postData) {
    req.write(postData);
  }
  req.end();
}

// Generate requests at controlled rate
const intervalMs = 20; // dispatch in 20ms batches
const requestsPerBatch = Math.round(TARGET_RPS * (intervalMs / 1000));

let elapsedMs = 0;
const intervalTimer = setInterval(() => {
  elapsedMs += intervalMs;
  if (elapsedMs >= DURATION_SEC * 1000) {
    clearInterval(intervalTimer);
    setTimeout(printResults, 1000);
    return;
  }

  for (let i = 0; i < requestsPerBatch; i++) {
    const rand = Math.random();
    if (rand < 0.60) {
      sendRequest('PRODUCT');
    } else if (rand < 0.75) {
      sendRequest('CATEGORY');
    } else if (rand < 0.95) {
      sendRequest('ORDER');
    } else {
      sendRequest('USER_ORDERS');
    }
  }
}, intervalMs);

function printResults() {
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.90)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const max = latencies[latencies.length - 1] || 0;
  const actualRps = Math.round(totalRequests / DURATION_SEC);

  console.log(`\n================== RESULTS ==================`);
  console.log(`Total Requests Sent : ${totalRequests.toLocaleString()}`);
  console.log(`Actual Rate         : ${actualRps.toLocaleString()} req/s`);
  console.log(`Valid Responses     : ${successCount.toLocaleString()}`);
  console.log(`Errors (5xx/Timeout): ${errorCount} (${((errorCount / totalRequests) * 100).toFixed(2)}%)`);
  console.log(`---------------------------------------------`);
  console.log(`Latency p50         : ${p50.toFixed(2)} ms`);
  console.log(`Latency p90         : ${p90.toFixed(2)} ms`);
  console.log(`Latency p99         : ${p99.toFixed(2)} ms (Limit: <= 100 ms)`);
  console.log(`Latency Max         : ${max.toFixed(2)} ms`);
  console.log(`=============================================\n`);

  if (p99 <= 100 && (errorCount / totalRequests) <= 0.01) {
    console.log(`🏆 RESULT: LEVEL PASSED! (p99 <= 100ms, Error <= 1%)\n`);
  } else {
    console.log(`❌ RESULT: LEVEL FAILED!\n`);
  }
}
