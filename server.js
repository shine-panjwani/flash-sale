// ==============================================================================
// KODR CHALLENGE - FLASH SALE SERVER (LAST SERVER STANDING)
// Architecture: Node.js + In-Memory L1 Cache + SQLite WAL Persistence
// Author: Kodr Challenger
// ==============================================================================

const path = require('path');
const Database = require('better-sqlite3');
const Fastify = require('fastify');

// 1. FASTIFY SERVER INITIALIZATION
// logger: false is crucial — at 5,000+ req/s, file/console logging would choke the CPU
const app = Fastify({
  logger: false,
  keepAliveTimeout: 65000,
  forceCloseConnections: true,
});

// 2. EMBEDDED SQLITE SETUP (In-Process, Persistent, Zero Network Overhead)
const dbPath = path.join(__dirname, 'shop.db');
const db = new Database(dbPath);

// Ultra-fast SQLite PRAGMAs
db.pragma('journal_mode = WAL');       // Write-Ahead Logging for high concurrency
db.pragma('synchronous = NORMAL');     // Fast commits that survive process crashes (kill -9)
db.pragma('temp_store = MEMORY');      // Temporary tables/indexes in RAM
db.pragma('cache_size = -64000');      // 64 MB SQLite page cache
db.pragma('mmap_size = 268435456');    // 256 MB memory-mapped I/O for lightning reads

// Schema creation with strict UNIQUE index to block duplicate purchases
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS orders (
    orderId TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    productId TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_product ON orders(userId, productId);
  CREATE INDEX IF NOT EXISTS idx_user_orders ON orders(userId);
`);

// Prepared Statements (Compiled once for maximum execution speed)
const insertProductStmt = db.prepare(`
  INSERT INTO products (id, name, category, price, stock) VALUES (?, ?, ?, ?, ?)
`);

const decrStockStmt = db.prepare(`
  UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0
`);

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (orderId, userId, productId, createdAt) VALUES (?, ?, ?, ?)
`);

// 3. IN-MEMORY L1 CACHE (Serves 80% of all requests in < 0.1ms directly from RAM)
let isReady = false;
let orderSeq = 0;

const productsMap = new Map();       // productId -> { id, name, category, price, stock }
const categoryMap = new Map();       // categoryId -> Array of products (sorted)
const userPurchasedSet = new Set();  // "userId:productId" -> boolean (Anti double-click)
const userOrdersMap = new Map();     // userId -> Array<{ orderId, productId }>

// Sorter: Cheapest first (price ASC), then by id in alphabetical order (id ASC)
function compareProducts(a, b) {
  if (a.price !== b.price) {
    return a.price - b.price;
  }
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

// Generate unique order ID without heavy crypto libraries
function generateOrderId() {
  orderSeq = (orderSeq + 1) & 0x7fffffff;
  return `o_${Date.now().toString(36)}_${orderSeq.toString(36)}`;
}

// Warm up In-Memory Cache from SQLite on boot (and after crash/restart)
function loadCacheFromDb() {
  const products = db.prepare('SELECT id, name, category, price, stock FROM products').all();
  for (const p of products) {
    productsMap.set(p.id, p);
    let catList = categoryMap.get(p.category);
    if (!catList) {
      catList = [];
      categoryMap.set(p.category, catList);
    }
    catList.push(p);
  }

  // Pre-sort all category lists
  for (const catList of categoryMap.values()) {
    catList.sort(compareProducts);
  }

  const orders = db.prepare('SELECT orderId, userId, productId FROM orders').all();
  for (const o of orders) {
    userPurchasedSet.add(`${o.userId}:${o.productId}`);
    let uOrders = userOrdersMap.get(o.userId);
    if (!uOrders) {
      uOrders = [];
      userOrdersMap.set(o.userId, uOrders);
    }
    uOrders.push({ orderId: o.orderId, productId: o.productId });
  }

  isReady = true;
}

// 4. ATOMIC ORDER TRANSACTION (Guarantees books balance & no overselling)
const executeOrderTx = db.transaction((orderId, userId, productId, now) => {
  // Step 1: Decrement stock atomically (only if stock > 0)
  const updateRes = decrStockStmt.run(productId);
  if (updateRes.changes === 0) {
    return { status: 409, error: 'SOLD_OUT' };
  }

  // Step 2: Insert order. If user already bought, UNIQUE index throws and auto-rolls back
  try {
    insertOrderStmt.run(orderId, userId, productId, now);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('UNIQUE'))) {
      throw new Error('ALREADY_PURCHASED');
    }
    throw err;
  }

  return { status: 201 };
});

// 5. ERROR HANDLING OVERRIDES (Spec compliance: exact error codes)
app.setErrorHandler((error, request, reply) => {
  if (error instanceof SyntaxError || error.statusCode === 400 || error.validation) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }
  return reply.code(500).send({ error: 'INTERNAL_ERROR' });
});

app.setNotFoundHandler((request, reply) => {
  return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
});

// ==============================================================================
// 6. ENDPOINTS IMPLEMENTATION
// ==============================================================================

// [1] GET /health - Ready check
app.get('/health', async (request, reply) => {
  if (!isReady) {
    return reply.code(503).send({ status: 'starting' });
  }
  return reply.code(200).send({ status: 'ok' });
});

// [2] POST /products - Create a product (Seeding & Flash drop)
app.post('/products', async (request, reply) => {
  const body = request.body;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }

  const { id, name, category, price, stock } = body;

  // Validation according to Section 04
  if (
    typeof id !== 'string' || id.length < 1 || id.length > 64 ||
    typeof name !== 'string' || name.length < 1 || name.length > 200 ||
    typeof category !== 'string' || category.length < 1 || category.length > 64 ||
    typeof price !== 'number' || !Number.isInteger(price) || price < 0 ||
    typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0
  ) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }

  // Check duplicate ID
  if (productsMap.has(id)) {
    return reply.code(409).send({ error: 'PRODUCT_EXISTS' });
  }

  // Persist to Disk (SQLite)
  try {
    insertProductStmt.run(id, name, category, price, stock);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || (err.message && err.message.includes('UNIQUE'))) {
      return reply.code(409).send({ error: 'PRODUCT_EXISTS' });
    }
    throw err;
  }

  // Save in Memory Cache
  const product = { id, name, category, price, stock };
  productsMap.set(id, product);

  let catList = categoryMap.get(category);
  if (!catList) {
    catList = [];
    categoryMap.set(category, catList);
  }
  catList.push(product);
  catList.sort(compareProducts);

  return reply.code(201).send(product);
});

// [3] GET /products/:id - Read one product (60% of total traffic)
app.get('/products/:id', async (request, reply) => {
  const { id } = request.params;
  const product = productsMap.get(id);

  if (!product) {
    return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
  }

  return reply.code(200).send({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stock
  });
});

// [4] GET /products?category=...&page=...&limit=... - List category (15% of total traffic)
app.get('/products', async (request, reply) => {
  const query = request.query || {};
  const category = query.category;

  // Category param is required and must be non-empty string
  if (!category || typeof category !== 'string' || category.trim().length === 0) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }

  // Page: Optional, default 1, must be integer >= 1
  let page = 1;
  if (query.page !== undefined) {
    const p = Number(query.page);
    if (!Number.isInteger(p) || p < 1) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    }
    page = p;
  }

  // Limit: Optional, default 20, must be integer 1 to 50
  let limit = 20;
  if (query.limit !== undefined) {
    const l = Number(query.limit);
    if (!Number.isInteger(l) || l < 1 || l > 50) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    }
    limit = l;
  }

  const catList = categoryMap.get(category) || [];
  const total = catList.length;
  const startIndex = (page - 1) * limit;

  let items = [];
  if (startIndex < total) {
    const slice = catList.slice(startIndex, startIndex + limit);
    items = slice.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock
    }));
  }

  return reply.code(200).send({
    items,
    page,
    limit,
    total
  });
});

// [5] POST /orders - Buy one unit (20% of traffic, the flash drop core)
app.post('/orders', async (request, reply) => {
  const body = request.body;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }

  const { userId, productId } = body;

  // 1. Validation check (400)
  if (
    typeof userId !== 'string' || userId.length < 1 || userId.length > 64 ||
    typeof productId !== 'string' || productId.length < 1 || productId.length > 64
  ) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  }

  // 2. Product existence check (404)
  const product = productsMap.get(productId);
  if (!product) {
    return reply.code(404).send({ error: 'PRODUCT_NOT_FOUND' });
  }

  // 3. Ultra-fast in-memory checks (Drops retries & sold-out requests with 0 DB overhead)
  const userProductKey = `${userId}:${productId}`;
  if (userPurchasedSet.has(userProductKey)) {
    return reply.code(409).send({ error: 'ALREADY_PURCHASED' });
  }

  if (product.stock <= 0) {
    return reply.code(409).send({ error: 'SOLD_OUT' });
  }

  // 4. Atomic execution on SQLite disk store
  const orderId = generateOrderId();
  const now = Date.now();

  try {
    const res = executeOrderTx(orderId, userId, productId, now);
    if (res.status === 409) {
      product.stock = 0; // Sync memory stock
      return reply.code(409).send({ error: res.error });
    }
  } catch (err) {
    if (err.message === 'ALREADY_PURCHASED') {
      userPurchasedSet.add(userProductKey);
      return reply.code(409).send({ error: 'ALREADY_PURCHASED' });
    }
    throw err;
  }

  // 5. Update In-Memory L1 Cache (Completely race-condition free in single-threaded JS)
  product.stock -= 1;
  userPurchasedSet.add(userProductKey);

  let uOrders = userOrdersMap.get(userId);
  if (!uOrders) {
    uOrders = [];
    userOrdersMap.set(userId, uOrders);
  }
  uOrders.push({ orderId, productId });

  return reply.code(201).send({ orderId, userId, productId });
});

// [6] GET /users/:userId/orders - User's order list (5% traffic)
app.get('/users/:userId/orders', async (request, reply) => {
  const { userId } = request.params;
  const orders = userOrdersMap.get(userId) || [];

  return reply.code(200).send({
    userId,
    orders
  });
});

// [Helper for Testing] GET /all-products - View all products currently in database
app.get('/all-products', async (request, reply) => {
  return reply.code(200).send({
    total: productsMap.size,
    products: Array.from(productsMap.values())
  });
});

// ==============================================================================
// 7. START SERVER (Listens on 0.0.0.0:8080 as required)
// ==============================================================================
async function start() {
  loadCacheFromDb();

  try {
    await app.listen({ port: 8080, host: '0.0.0.0' });
    // Minimal log on start
    process.stdout.write(`Server listening on 0.0.0.0:8080\n`);
  } catch (err) {
    process.stderr.write(`Failed to start: ${err.message}\n`);
    process.exit(1);
  }
}

start();
