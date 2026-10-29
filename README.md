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
- **Runtime**: **Node.js (v24.21.0)** with **Express (v5.3.0)**. Provides a lightweight, high-performance HTTP server with standard middleware support.
- **Database**: Built-in **`node:sqlite` (`DatabaseSync`)**. Delivers zero-dependency, local file-based ACID transactions without requiring external C++ build tooling or Python node-gyp compilers.
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
FleetWise includes 83 automated unit, integration, concurrency, and governance tests across 13 test suites with zero external testing dependencies:
```bash
npm test
```

---

## 4. Suggested API Specification

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

