# FleetWise System Architecture

FleetWise is designed as a modular, resilient, single-instance dispatch and telematics platform. This document outlines the core structural components, concurrency models, data flows, and consistency guarantees.

---

## 1. High-Level Topology

```mermaid
flowchart TD
    subgraph Clients["Clients"]
        DispatcherUI["Dispatcher Dashboard<br/>(Desktop / Leaflet / WS)"]
        DriverApp["Driver Mobile PWA<br/>(Geolocation / POD)"]
        CustomerView["Public Customer Tracking<br/>(Data Minimized)"]
    end

    subgraph Edge["Security & Ingress"]
        Helmet["Helmet CSP & Security Headers"]
        RateLimits["Rate Limiting Stores<br/>(Auth, API, Tracking)"]
        AuthN["JWT Authentication & Token Rotation"]
        RBAC["Role-Based Access Control"]
    end

    subgraph App["Application Core (Node.js & Express 5)"]
        DeliveryEngine["Delivery State Machine"]
        AssignEngine["Atomic Assignment Engine"]
        TelematicsHub["Socket.IO Hub & Ops Rooms"]
        RoutingSvc["Routing & ETA Service<br/>(OSRM + Haversine Cache)"]
        ProofSvc["Proof of Delivery Service<br/>(HMAC OTP & Magic-Bytes Photo)"]
    end

    subgraph Workers["Background Services"]
        OutboxWorker["Transactional Outbox Worker<br/>(Lease Locking & Crash Recovery)"]
        PruneWorker["Telematics History Pruner<br/>(7-day retention)"]
    end

    subgraph Storage["Persistence Layer (SQLite / WAL)"]
        DB[("node:sqlite DatabaseSync<br/>Foreign Keys ON / WAL Mode")]
        AuditLog[("Append-Only Audit Logs")]
        DiskProofs[("Proof Storage (/data/proofs)")]
        DiskBackups[("Atomic Backups (/data/backups)")]
    end

    Clients --> Edge
    Edge --> App
    App --> Storage
    App --> TelematicsHub
    App --> Workers
    Workers --> DB
```

---

## 2. Concurrency & ACID Boundaries

### SQLite Write-Ahead Logging (WAL)
FleetWise utilizes Node.js's native `node:sqlite` engine configured with:
- `PRAGMA journal_mode = WAL;` (Concurrent readers do not block writers; writer does not block readers).
- `PRAGMA synchronous = NORMAL;` (Ensures durability while avoiding blocking disk fsync on every commit).
- `PRAGMA foreign_keys = ON;` (Strict referential integrity across vehicles, drivers, deliveries, and audit trails).

### Atomic Resource Assignment
Preventing double-booking requires zero-race-window transactions. The assignment transaction:
1. Validates delivery status is `pending`.
2. Verifies vehicle status is `available` and checks maintenance status.
3. Verifies driver status is `available`.
4. Updates delivery status to `assigned` and sets vehicle and driver references.
5. Updates vehicle status to `assigned` and driver status to `assigned`.
6. Enqueues an outbox event `delivery_assigned` in the **exact same database transaction**.
7. Writes an audit log entry in the **exact same database transaction**.
8. Commits atomically.

If any check fails or concurrent operations attempt to claim the same resource, the transaction rolls back cleanly, leaving zero partial state. Post-commit Socket.IO events fire only after the transaction successfully commits.

---

## 3. Transactional Outbox Pattern

To eliminate distributed 2-phase commits between the database and notification channels (email, SMS), FleetWise implements the Transactional Outbox Pattern:

```mermaid
sequenceDiagram
    autonumber
    actor Dispatcher
    participant API as Delivery Service
    participant DB as SQLite DB
    participant Worker as Outbox Worker
    participant Provider as SMTP / Notification Service

    Dispatcher->>API: Assign Delivery
    rect rgb(240, 248, 255)
        Note over API,DB: Single ACID Transaction
        API->>DB: UPDATE deliveries SET status = 'assigned'
        API->>DB: UPDATE vehicles & drivers SET status = 'assigned'
        API->>DB: INSERT INTO notification_outbox (event, recipient, status='pending')
        API->>DB: INSERT INTO audit_logs
    end
    API-->>Dispatcher: 200 OK (Assigned)

    loop Every 5 Seconds (Worker Tick)
        Worker->>DB: Claim pending rows (UPDATE status='processing', locked_until=now+60s)
        Worker->>Provider: Send rendered notification
        alt Success
            Worker->>DB: UPDATE status='sent', sent_at=now, params_json=NULL
        else Failure (attempts < 3)
            Worker->>DB: UPDATE status='pending', attempts+=1, backoff
        else Final Failure
            Worker->>DB: UPDATE status='failed', params_json=NULL
        end
    end
```

### Crash Recovery & Lease Management
If a node crashes while processing an outbox row, the `locked_until` lease expires after 60 seconds. On the next tick, stalled rows automatically revert to `pending` status and retry.

---

## 4. Telematics & Live Location Pipeline

Drivers stream GPS coordinates via WebSocket (`driver:location_update`) with fallback to REST (`POST /drivers/:id/location`).

```mermaid
flowchart LR
    DriverDevice["Driver Device (PWA)"] -->|"WebSocket / REST<br/>Bearer JWT"| Gate["Rate Limiter<br/>(60/min, min 200ms gap)"]
    Gate -->|"Zod Validate"| Validator["Bounds & Freshness Check<br/>(-90<=lat<=90, -180<=lng<=180)"]
    Validator --> DBUpdate["Upsert driver_latest_locations<br/>(In-Memory Upsert)"]
    Validator --> History["Append driver_location_history<br/>(Pruned >7 days)"]
    DBUpdate --> Broadcast["io.to('ops_room').emit('driver.location_updated')"]
    Broadcast --> DispatcherMap["Dispatcher Live Map"]
```

### Rate Limiting & Scope Isolation
- Keyed by `targetDriverId` or `userId`.
- Cleaned up from memory when socket disconnects.
- Driver accounts may only submit telematics for their own linked driver record.

