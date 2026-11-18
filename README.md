# Kodr Challenge · Flash Sale Server (Last Server Standing)

## 📁 Project Structure
- `server.js` - Complete API implementation (Fastify + In-Memory L1 Cache + SQLite WAL).
- `test-api.js` - Automated test suite verifying all 6 routes, race conditions, over-selling prevention, double clicks, and sorting.
- `tune.sh` - Linux kernel & network optimizations for AWS EC2 `m7i.large`.
- `flashsale.service` - Systemd service file ensuring automatic crash recovery (Test 3 compliance).
- `package.json` - Project metadata and dependencies (`fastify`, `better-sqlite3`).

---

## 🚀 Local Run & Testing (Windows / Mac / Linux)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
Server `0.0.0.0:8080` par listen karega.

### 3. Run Automated Tests
Ek alag terminal window me:
```bash
npm test
```
Yeh script automatically check karegi:
- `GET /health` (Status 200)
- `POST /products` & validation (400, 409, 201)
- `GET /products/:id` (200, 404)
- `GET /products?category=...` (Price ASC, ID ASC sorting check)
- Parallel 50 buyers on 1 stock (Strictly 1 201, 49 409s)
- 20 double-clicks by same user (Strictly 1 201, 19 409s)
- User orders list

---

## ☁️ EC2 Box Deployment (Ubuntu 24.04 LTS)

### 1. Box Login
```bash
ssh -i your-key.pem ubuntu@<public-ip>
```

### 2. Install Node.js & Build Tools
```bash
sudo apt update
sudo apt install -y nodejs npm build-essential
```

### 3. Copy Code & Install
Apne code ko `/home/ubuntu/flash-sale` me rakho aur run karo:
```bash
cd /home/ubuntu/flash-sale
npm install --omit=dev
```

### 4. Apply OS Tuning
```bash
sudo bash tune.sh
```

### 5. Setup Systemd Auto-Restart (Test 3 Compliance)
```bash
sudo cp flashsale.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable flashsale
sudo systemctl start flashsale
```

Check status:
```bash
sudo systemctl status flashsale
sudo ss -tlnp | grep 8080
```
Isme `0.0.0.0:8080` dikhai dena chahiye!

---

## 🛡️ Pre-Flight Verification on Box
Code freeze se pehle yeh 3 tests run karo jo spec me diye gaye hain:

### Test 1: The Last Unit
```bash
curl -s -w '\n' -X POST localhost:8080/products -H 'content-type: application/json' \
  -d '{"id":"plast1","name":"Last One","category":"ctest","price":100,"stock":1}'

args=()
for i in $(seq 50); do
  [ "$i" -gt 1 ] && args+=(--next)
  args+=(-s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
         -d "{\"userId\":\"u$i\",\"productId\":\"plast1\"}" http://localhost:8080/orders)
done
curl -Z --parallel-immediate --parallel-max 50 "${args[@]}" | sort | uniq -c
# Output must be: 1 201 and 49 409
```

### Test 2: Double Click
```bash
curl -s -w '\n' -X POST localhost:8080/products -H 'content-type: application/json' \
  -d '{"id":"pclick1","name":"Click Test","category":"ctest","price":100,"stock":1000}'

args=()
for i in $(seq 20); do
  [ "$i" -gt 1 ] && args+=(--next)
  args+=(-s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
         -d '{"userId":"udouble1","productId":"pclick1"}' http://localhost:8080/orders)
done
curl -Z --parallel-immediate --parallel-max 20 "${args[@]}" | sort | uniq -c
# Output must be: 1 201 and 19 409
```

### Test 3: Hard Crash Recovery
```bash
sudo killall -9 node
sleep 2
curl -s -w '\n' localhost:8080/health              # {"status":"ok"}
curl -s -w '\n' localhost:8080/products/pclick1    # Data must be intact
```
