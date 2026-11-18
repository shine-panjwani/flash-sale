// seed-sample.js - Seeds 4 sample products for testing
const items = [
  { id: 'p3f9a0c2e71bd', name: 'Pixel 10 Pro 256GB', category: 'electronics', price: 79999, stock: 10 },
  { id: 'p7d2e05b1c9aa', name: 'Phone Case Matte Black', category: 'electronics', price: 349, stock: 100 },
  { id: 'p0c4be91a3f25', name: 'Steel Bottle 1L Insulated', category: 'lifestyle', price: 349, stock: 50 },
  { id: 'p9e1d7c40b2a6', name: 'Air Fryer 4L Flash Drop', category: 'kitchen', price: 2999, stock: 2 }
];

async function seed() {
  for (const item of items) {
    const res = await fetch('http://127.0.0.1:8080/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item)
    });
    const data = await res.json();
    console.log(`Created: ${item.id} -> Status: ${res.status}`, data);
  }
}

seed();
