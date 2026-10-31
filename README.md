# FleetWise — Vehicle & Delivery Assignment System

FleetWise is a high-reliability, responsive fleet-management and delivery-dispatch web application. It automates and safeguards vehicle and driver allocations, enforcing business rules, atomic database concurrency controls, and lifecycle integrity.

---

## 1. System Architecture & Tech Stack

```
               ┌────────────────────────────────────────────────────────┐
               │         Responsive Web UI (HTML5 / CSS3 / Vanilla JS)   │
               │   • Operational Dashboard & Real-Time KPI Cards        │
               │   • Dynamic Visual Delivery Status Breakdown           │
               │   • Filterable Tables & Interactive Assignment Modals   │
               └───────────────────────────┬────────────────────────────┘
                                           │ HTTP / JSON API
               ┌───────────────────────────▼────────────────────────────┐
               │              Express Application Layer                 │
               │   • CORS, JSON body parsing, Centralized Error Handler │
               │   • Routes: /vehicles, /drivers, /deliveries, /health  │
               └───────────────────────────┬────────────────────────────┘
                                           │
               ┌───────────────────────────▼────────────────────────────┐
               │                Domain Service Layer                    │
               │   • Strict Delivery Lifecycle State Machine            │
               │   • Assignment Validation & Conflict Prevention        │
               │   • Safe Resource Release Calculation                  │
               └───────────────────────────┬────────────────────────────┘
                                           │
               ┌───────────────────────────▼────────────────────────────┐
               │             SQLite Physical Engine                     │
               │   • Synchronous ACID Transactions (BEGIN IMMEDIATE)    │
               │   • Foreign Key Constraints (PRAGMA foreign_keys = ON) │
               │   • Partial Unique Indexes for Double-Booking Defense  │
               │   • Write-Ahead Logging (WAL Mode)                     │
               └────────────────────────────────────────────────────────┘
```

### Stack Selection & Rationale
- **Runtime**: **Node.js v22.13.0+ or Node.js v24+** with **Express (v5.3.0)**. Provides a lightweight, high-performance HTTP server with standard middleware support.
- **Database**: Built-in **`node:sqlite` (`DatabaseSync`)**. Delivers zero-dependency, local file-based ACID transactions without requiring external C++ build tooling or Python node-gyp compilers. Requires Node.js 22.13+ or 24+.
- **Concurrency & Integrity Controls**:
  - `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;`
  - Atomic transactions via `BEGIN IMMEDIATE` ensuring exclusive write locking during assignment allocation.
  - **Partial Unique Indexes** at the SQLite schema level:
    ```sql
    CREATE UNIQUE INDEX idx_active_assign_vehicle ON assignments(vehicle_id) WHERE is_active = 1;
    CREATE UNIQUE INDEX idx_active_assign_driver ON assignments(driver_id) WHERE is_active = 1;
    CREATE UNIQUE INDEX idx_active_assign_delivery ON assignments(delivery_id) WHERE is_active = 1;
    ```
    This guarantees that neither a vehicle nor a driver can ever be double-booked, even under concurrent requests.
- **Frontend**: Clean, dependency-free responsive SPA (`index.html`, `style.css`, `app.js`). Loads instantly, requires zero bundling steps, and communicates directly with the REST API.
- **Testing Engine**: Built-in Node test runner (`node:test`) and assert library (`node:assert/strict`).

---

## 2. Mandatory Business Rules & Delivery Lifecycle

### Delivery Lifecycle State Machine

```
              ┌─────────┐
              │ Pending │
              └────┬────┘
                   │
         ┌─────────┴─────────┐
         │ (Assign Resource) │ (Cancel)
         ▼                   ▼
    ┌──────────┐        ┌───────────┐
    │ Assigned │        │ Cancelled │
    └────┬─────┘        └───────────┘
         │                   ▲
         ├───────────────────┤ (Cancel + Release)
         │ (Dispatch)        │
         ▼                   │
   ┌────────────┐            │
   │ In Transit ├────────────┘
   └─────┬──────┘
         │ (Complete)
         ▼
    ┌───────────┐
    │ Delivered │
    └───────────┘
```

### Core Business Rules
1. **Assignment Criteria**:
   - The delivery exists and status is `pending`.
   - The vehicle exists and status is `available`.
   - The driver exists and status is `available`.
   - Neither the vehicle nor the driver is allocated to another active assignment (`is_active = 1`).
2. **Atomic State Updates**:
   - When an assignment succeeds, delivery becomes `assigned`, vehicle becomes `assigned`, and driver becomes `assigned` in a single transaction.
   - If validation fails, an HTTP `409 Conflict` (or `400/404`) is returned, and all database tables remain untouched (atomic rollback).
3. **Safe Resource Release**:
   - When a delivery reaches `delivered` or `cancelled`, the active assignment record is marked inactive (`is_active = 0`, `released_at = DATETIME('now')`).
   - Vehicle and driver statuses are recalculated: if no other active assignments exist and vehicle was in `assigned` status, it returns to `available`.
   - **Protection Rule**: Resources in `maintenance`, `inactive`, or `unavailable` are **never** overwritten with `available`.
4. **Maintenance Lockout**:
   - A vehicle or driver cannot be switched to `maintenance`, `inactive`, or `unavailable` while an active assignment exists.

---

## 3. Quick Start & Execution

### Prerequisites
- Node.js v20+ (developed and verified on Node.js v24.21.0)
- npm v10+

### Installation & Server Startup
```bash
# 1. Install dependencies
npm install

# 2. Start the FleetWise server
npm start
```
The server will start listening at:
👉 **`http://localhost:3000`**

Open `http://localhost:3000` in any web browser to access the application.

### Running Automated Test Suite
FleetWise includes 114 automated unit, integration, concurrency, authentication, and governance tests across 16 test suites with zero external testing dependencies:
```bash
npm test
```

### Docker & Container Deployment
Run the production multi-stage container via Docker Compose:
```bash
# Build and start the containerized service
docker compose up -d --build

# View container logs
docker compose logs -f

# Check container health status
docker compose ps
```
The application will be accessible at `http://localhost:3000` with persistent SQLite volume storage.

### Interactive OpenAPI / Swagger Documentation
API documentation is automatically hosted directly by the server:
👉 **`http://localhost:3000/api/docs`**

---

## 4. Suggested API Specification

### Authentication & User Management (Phase 1)
| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `POST` | `/auth/login` | Authenticate with username and password, return JWT access + refresh tokens | 200, 401, 429 |
| `POST` | `/auth/register` | Register a new user account (Requires `admin`) | 201, 400, 403, 409 |
| `POST` | `/auth/refresh` | Rotate single-use SHA-256 refresh token for fresh access token | 200, 400, 401 |
| `POST` | `/auth/logout` | Revoke refresh token | 200 |
| `GET` | `/auth/me` | Inspect authenticated user profile & permissions | 200, 401 |

### Operations & Fleet Management

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `GET` | `/health` | Service health, uptime, and DB connectivity | 200, 503 |
| `GET` | `/api/dashboard/stats` | Aggregated operational KPI metrics & chart data | 200 |
| `GET` | `/api/analytics/performance` | Detailed fleet utilization, driver workload & completion rates | 200 |
| `GET` | `/api/audit-logs` | Comprehensive tamper-evident audit history | 200 |
| `POST` | `/api/seed` | Seeds realistic demo fleet, drivers, and deliveries | 200 |
| `GET` | `/vehicles` | List all vehicles with active delivery details | 200 |
| `POST` | `/vehicles` | Register a new fleet vehicle (Requires `fleet_manager`) | 201, 400, 403, 409 |
| `GET` | `/vehicles/:id` | Retrieve single vehicle details | 200, 404 |
| `PUT` | `/vehicles/:id` | Update vehicle details (Requires `fleet_manager`) | 200, 400, 403, 409 |
| `PATCH`| `/vehicles/:id/status` | Update vehicle status (Requires `fleet_manager`, enforces lockout) | 200, 400, 403, 409 |
| `DELETE`| `/vehicles/:id` | Safe deletion of vehicle (Requires `fleet_manager`, rejects active) | 200, 403, 404, 409 |
| `GET` | `/drivers` | List all drivers with active delivery details | 200 |
| `POST` | `/drivers` | Register a new driver (Requires `fleet_manager`) | 201, 400, 403, 409 |
| `GET` | `/drivers/:id` | Retrieve single driver details | 200, 404 |
| `PUT` | `/drivers/:id` | Update driver details (Requires `fleet_manager`) | 200, 400, 403, 409 |
| `PATCH`| `/drivers/:id/status` | Update driver availability status (Requires `fleet_manager`) | 200, 400, 403, 409 |
| `DELETE`| `/drivers/:id` | Safe deletion of driver (Requires `fleet_manager`, rejects active) | 200, 403, 404, 409 |
| `GET` | `/deliveries` | List deliveries (supports `search`, `status`, `priority`) | 200 |
| `GET` | `/deliveries/queue` | Priority-based delivery queue (sorted by priority & schedule) | 200 |
| `POST` | `/deliveries` | Create a pending delivery request (with capacity/type reqs) | 201, 400 |
| `GET` | `/deliveries/:id` | Retrieve delivery details with assigned resources | 200, 404 |
| `GET` | `/deliveries/:id/suggestions`| Suggest optimal vehicle/driver pairing with capacity & workload rationale | 200, 404 |
| `PUT` | `/deliveries/:id` | Update pending delivery details (rejects active/terminal) | 200, 400, 409 |
| `GET` | `/deliveries/:id/assignments` | Retrieve historical assignment audit logs for delivery | 200, 404 |
| `DELETE`| `/deliveries/:id` | Safe deletion of delivery (rejects active/history) | 200, 404, 409 |
| `POST` | `/deliveries/:id/assign` | Atomically assign vehicle & driver to delivery | 200, 400, 404, 409 |
| `PATCH`| `/deliveries/:id/status` | Perform validated lifecycle transition | 200, 400, 404, 409 |

---

## 5. Phase 6 Advanced Operational Enhancements

1. **Capacity & Vehicle Type Matching**:
   - Deliveries specify optional `required_capacity` (kg) and `required_vehicle_type`.
   - The authoritative assignment engine enforces strict matching: allocating a vehicle with insufficient capacity or mismatched type triggers an HTTP `409 Conflict`.
2. **Priority-Based Dispatch Queue**:
   - `GET /deliveries/queue` returns pending deliveries ordered by priority (`urgent` > `high` > `medium` > `low`), scheduled delivery time, and creation timestamp.
3. **Smart Resource Suggestion Engine**:
   - `GET /deliveries/:id/suggestions` identifies available vehicles that meet capacity and type specifications, ranks by best capacity fit, and pairs with drivers having balanced workloads.
   - Suggestions must be confirmed and executed through the authoritative assignment engine.
4. **Audit Trail**:
   - Every creation, assignment, status transition, and asset modification writes an immutable record to the `audit_logs` table.
   - Queryable via `GET /api/audit-logs?entity_type=...`.
5. **Fleet Utilization & Delivery Analytics**:
   - `GET /api/analytics/performance` calculates live fleet deployment rate, driver utilization rate, fulfillment completion rate, vehicle category breakdown, and driver trip leaderboards.
6. **Role-Based Access Control (RBAC)**:
   - Evaluates `X-User-Role` (`fleet_manager` vs `dispatcher`).
   - `fleet_manager` has full administrative authority to register, update, and delete vehicles and drivers.
   - `dispatcher` can assign resources and manage delivery lifecycles, but asset modifications return `403 Forbidden`.

---

## 6. API cURL Examples

### 1. Create a Vehicle
```bash
curl -X POST http://localhost:3000/vehicles \
  -H "Content-Type: application/json" \
  -d '{"registration_number": "NYC-2045", "type": "Sprinter Van", "capacity": 1500, "status": "available"}'
```

### 2. Create a Driver
```bash
curl -X POST http://localhost:3000/drivers \
  -H "Content-Type: application/json" \
  -d '{"name": "Marcus Vance", "phone": "+1-555-0145", "availability_status": "available"}'
```

### 3. Create a Pending Delivery
```bash
curl -X POST http://localhost:3000/deliveries \
  -H "Content-Type: application/json" \
  -d '{"pickup_address": "100 Broadway, NY", "dropoff_address": "450 5th Ave, NY", "scheduled_time": "2026-11-01T10:00:00Z", "priority": "high", "notes": "Medical cargo"}'
```

### 4. Assign Vehicle & Driver
```bash
curl -X POST http://localhost:3000/deliveries/DEL-XXXX/assign \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "VEH-YYYY", "driver_id": "DRV-ZZZZ"}'
```

### 5. Transition Delivery Status
```bash
curl -X PATCH http://localhost:3000/deliveries/DEL-XXXX/status \
  -H "Content-Type: application/json" \
  -d '{"status": "in_transit"}'
```

---

## 7. Clean-Start & Acceptance Demonstration Guide

### Clean-Start Procedure
To start FleetWise cleanly from scratch:
```bash
# 1. Stop any running server process (Ctrl+C)

# 2. (Optional) Remove previous database file to start fresh
rm -f data/fleetwise.db*

# 3. Start the application
npm start
```
The server will automatically initialize the database schema, foreign keys, and unique indexes on startup.

### Running the Acceptance Demonstration Sequence
FleetWise includes an automated acceptance demonstration script verifying the 7 required business acceptance steps:
```bash
node --test tests/acceptance_demonstration.test.js
```

#### What This Demonstrates:
1. **Resource Creation**: Creates vehicle `DEMO-V100`, driver `Jordan Hayes`, and delivery `DEL-1`.
2. **Successful Assignment**: Atomically assigns `DEMO-V100` and `Jordan Hayes` to `DEL-1`. Both resources transition to `assigned`.
3. **Vehicle Conflict Prevention**: Rejects assigning `DEMO-V100` to a second delivery with HTTP `409 Conflict`.
4. **Driver Conflict Prevention**: Rejects assigning `Jordan Hayes` to a second delivery with HTTP `409 Conflict`.
5. **Delivery Completion**: Transitions `DEL-1` to `in_transit` and then `delivered`. Both resources safely return to `available`.
6. **Resource Reuse**: Successfully re-assigns the freed vehicle and driver to the second delivery.
7. **Database Consistency Verification**: Confirms database records, assignment counts, and audit logs remain strictly consistent.

---

## 8. Troubleshooting & FAQ

### 1. Port 3000 Already in Use
If port 3000 is occupied by another process, specify an alternative port via environment variable:
```bash
# On Linux/macOS
PORT=3001 npm start

# On Windows PowerShell
$env:PORT="3001"; npm start
```

### 2. Database Locked (`SQLITE_BUSY`)
FleetWise enables Write-Ahead Logging (`WAL` mode) and synchronous transactions (`BEGIN IMMEDIATE`) to prevent write collisions. If you manually access the SQLite file with external database viewers, ensure they open in read-only mode to prevent external file locking.

### 3. Role-Based Access Denied (`403 Forbidden`)
If you receive an HTTP `403 Forbidden` when attempting to register or delete vehicles/drivers, ensure the request includes the `fleet_manager` role header:
```bash
-H "X-User-Role: fleet_manager"
```
Dispatchers (`X-User-Role: dispatcher`) can assign deliveries and transition statuses, but cannot mutate fleet physical assets.



---

## 9. Phase 3A: Driver Mobile Portal (PWA) & Customer Live Tracking

### Driver Mobile PWA (`/driver`)
- **URL**: `http://localhost:3000/driver` (or `https://<domain>/driver`)
- **Target Role**: `driver` (authenticates with JWT credentials)
- **Features**:
  - Offline-ready static shell cached by Service Worker (`sw.js`). Tokens and dynamic API responses are **never cached**.
  - My Deliveries overview with active trip badges.
  - One-tap trip start (`assigned` → `in_transit`).
  - **Live Telematics & Geolocation**:
    - Automatically streams driver coordinates and speed using `navigator.geolocation.watchPosition` only while a delivery is `in_transit`.
    - Live location toggle button allows drivers to pause/resume location sharing at any time.
    - Automatic stop on delivery completion or cancellation.
  - **Proof of Delivery (POD)**:
    - **6-Digit Customer OTP**: Drivers enter the recipient's OTP to atomically complete the delivery. Enforces constant-time HMAC verification, 24-hour expiration, and a 5-attempt lockout.
    - **Photo Proof**: Drivers take or upload a delivery photo. Validated server-side using magic byte detection (JPEG, PNG, WebP) up to 5MB, EXIF metadata stripped, and saved outside public folders.
  - **Direct Delivered Blocking**: Drivers are strictly blocked from setting `status: delivered` via PATCH; completion requires verified proof.

> [!IMPORTANT]
> **Mobile Browser Geolocation Requirements (HTTPS / Localhost)**
> `navigator.geolocation` is restricted by modern mobile browsers to **Secure Contexts** (`https://` or `http://localhost`).
> When testing on a physical smartphone:
> 1. Use a secure tunnel: `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`.
> 2. Open the generated HTTPS URL on your phone's browser.
> 3. Alternatively, for Android Chrome debugging, configure port forwarding in Chrome DevTools (`chrome://inspect`) to map `localhost:3000` directly to your connected device.

---

### Public Customer Tracking Page (`/t/:token`)
- **Customer Tracking Web Page**: `http://localhost:3000/t/:token`
- **Customer Tracking JSON API**: `GET /api/track/:token`
- **Security & Data Minimization**:
  - Secure 192-bit cryptographic random tokens; only SHA-256 hashes are stored in the database.
  - Identical HTTP 404 response for invalid, expired, or revoked tracking tokens to prevent enumeration attacks.
  - Strictly limited payload: delivery status, pickup/dropoff addresses, estimated time, and live vehicle location **only** while delivery is `in_transit`.
  - Zero leakage of internal IDs, driver phone numbers, driver identity, internal notes, or cryptographic proof hashes.
  - Hardened with security headers: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
