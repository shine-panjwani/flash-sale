// ==============================================================================
// TEST SUITE FOR KODR FLASH SALE API
// Tests all 6 endpoints, validation rules, parallel buys, double-clicks, and audit
// ==============================================================================

const BASE_URL = 'http://127.0.0.1:8080';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runTests() {
  console.log('--- STARTING FLASH SALE API TEST SUITE ---\n');

  // 1. Health check
  console.log('1. Testing /health...');
  let health;
  try {
    health = await request('GET', '/health');
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.error('\n❌ SERVER OFF HAI BHAI! (ECONNREFUSED)');
      console.error('👉 Pehle ek alag terminal me server start karo:');
      console.error('   node server.js\n');
      console.error('👉 Phir is terminal me dobara test run karo:');
      console.error('   node test-api.js\n');
      process.exit(1);
    }
    throw err;
  }
  assert(health.status === 200 && health.data?.status === 'ok', 'GET /health returns 200 {"status":"ok"}');

  // 2. Create products
  console.log('\n2. Testing POST /products...');
  const prod1 = await request('POST', '/products', {
    id: 'pixel10',
    name: 'Pixel 10 Pro 256GB',
    category: 'electronics',
    price: 79999,
    stock: 120
  });
  assert(prod1.status === 201 && prod1.data.stock === 120, 'POST /products creates product successfully');

  // Test duplicate product
  const prodDup = await request('POST', '/products', {
    id: 'pixel10',
    name: 'Duplicate Phone',
    category: 'electronics',
    price: 89999,
    stock: 50
  });
  assert(prodDup.status === 409 && prodDup.data.error === 'PRODUCT_EXISTS', 'POST duplicate product returns 409 PRODUCT_EXISTS');

  // Test invalid product
  const prodInvalid = await request('POST', '/products', {
    id: 'badprod',
    name: 'Bad Product',
    category: 'electronics',
    price: -10, // negative price
    stock: 5
  });
  assert(prodInvalid.status === 400 && prodInvalid.data.error === 'VALIDATION_ERROR', 'POST invalid product returns 400 VALIDATION_ERROR');

  // 3. Read one product
  console.log('\n3. Testing GET /products/:id...');
  const getProd = await request('GET', '/products/pixel10');
  assert(getProd.status === 200 && getProd.data.id === 'pixel10', 'GET /products/pixel10 returns 200');

  const getNotFound = await request('GET', '/products/nonexistent_id');
  assert(getNotFound.status === 404 && getNotFound.data.error === 'PRODUCT_NOT_FOUND', 'GET non-existent product returns 404 PRODUCT_NOT_FOUND');

  // 4. List category & pagination
  console.log('\n4. Testing GET /products?category=...&page=...&limit=...');
  // Add 2 more products to electronics for sorting test
  await request('POST', '/products', {
    id: 'p_case',
    name: 'Phone Case',
    category: 'electronics',
    price: 349,
    stock: 1000
  });
  await request('POST', '/products', {
    id: 'p_bottle',
    name: 'Bottle',
    category: 'electronics',
    price: 349, // same price, should sort by id ASC: p_bottle comes before p_case
    stock: 1000
  });

  const catList = await request('GET', '/products?category=electronics&page=1&limit=2');
  assert(catList.status === 200 && catList.data.items.length === 2, 'GET category returns correct limit');
  assert(catList.data.total >= 3, 'GET category returns total count');
  assert(catList.data.items[0].id === 'p_bottle' && catList.data.items[1].id === 'p_case', 'Sort order: price ASC, then id ASC tie-break is correct');

  // Empty category
  const emptyCat = await request('GET', '/products?category=unknown_category');
  assert(emptyCat.status === 200 && emptyCat.data.items.length === 0 && emptyCat.data.total === 0, 'Empty category returns items: [] and total: 0');

  // Invalid category / limit
  const badLimit = await request('GET', '/products?category=electronics&limit=80');
  assert(badLimit.status === 400 && badLimit.data.error === 'VALIDATION_ERROR', 'Limit > 50 returns 400 VALIDATION_ERROR');

  // 5. Test Orders (Single & Duplicate)
  console.log('\n5. Testing POST /orders...');
  const order1 = await request('POST', '/orders', {
    userId: 'u_alice',
    productId: 'pixel10'
  });
  assert(order1.status === 201 && order1.data.userId === 'u_alice', 'POST /orders succeeds with 201');

  // Duplicate order by same user
  const orderDup = await request('POST', '/orders', {
    userId: 'u_alice',
    productId: 'pixel10'
  });
  assert(orderDup.status === 409 && orderDup.data.error === 'ALREADY_PURCHASED', 'Same user re-buying returns 409 ALREADY_PURCHASED');

  // 6. User Orders list
  console.log('\n6. Testing GET /users/:userId/orders...');
  const userOrders = await request('GET', '/users/u_alice/orders');
  assert(userOrders.status === 200 && userOrders.data.orders.length === 1, 'GET user orders returns list of orders');

  const emptyUserOrders = await request('GET', '/users/u_bob_empty/orders');
  assert(emptyUserOrders.status === 200 && emptyUserOrders.data.orders.length === 0, 'User with no orders returns 200 with orders: []');

  // 7. Test 1 from Spec: The Last Unit (Overselling test with 50 parallel buyers)
  console.log('\n7. Running Spec Test 1: The Last Unit (50 parallel buyers for 1 stock)...');
  await request('POST', '/products', {
    id: 'plast1',
    name: 'Last Unit Test',
    category: 'test_drop',
    price: 100,
    stock: 1 // Only 1 unit!
  });

  const parallel50Promises = [];
  for (let i = 1; i <= 50; i++) {
    parallel50Promises.push(request('POST', '/orders', { userId: `user_drop_${i}`, productId: 'plast1' }));
  }
  const parallel50Results = await Promise.all(parallel50Promises);

  const count201 = parallel50Results.filter(r => r.status === 201).length;
  const count409 = parallel50Results.filter(r => r.status === 409).length;

  console.log(`   Results -> 201 Created: ${count201}, 409 Conflicts: ${count409}`);
  assert(count201 === 1 && count409 === 49, 'EXACTLY 1 buyer got 201, and 49 buyers got 409 (Zero Overselling)');

  const plastCheck = await request('GET', '/products/plast1');
  assert(plastCheck.data.stock === 0, 'Final stock is exactly 0, never negative');

  // 8. Test 2 from Spec: Double-Click (Same user sending 20 orders at the same moment)
  console.log('\n8. Running Spec Test 2: Double-Click (20 simultaneous clicks from same user)...');
  await request('POST', '/products', {
    id: 'pclick1',
    name: 'Double Click Test',
    category: 'test_drop',
    price: 500,
    stock: 1000
  });

  const doubleClickPromises = [];
  for (let i = 1; i <= 20; i++) {
    doubleClickPromises.push(request('POST', '/orders', { userId: 'u_fast_clicker', productId: 'pclick1' }));
  }
  const doubleClickResults = await Promise.all(doubleClickPromises);

  const dcCount201 = doubleClickResults.filter(r => r.status === 201).length;
  const dcCount409 = doubleClickResults.filter(r => r.status === 409).length;

  console.log(`   Results -> 201 Created: ${dcCount201}, 409 Conflicts: ${dcCount409}`);
  assert(dcCount201 === 1 && dcCount409 === 19, 'EXACTLY 1 request succeeded, 19 rejected with 409');

  const pclickCheck = await request('GET', '/products/pclick1');
  assert(pclickCheck.data.stock === 999, 'Stock decremented by exactly 1 (1000 -> 999)');

  const userClickOrders = await request('GET', '/users/u_fast_clicker/orders');
  assert(userClickOrders.data.orders.length === 1, 'User order history has exactly 1 order');

  console.log('\n======================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! SERVER IS 100% READY!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
