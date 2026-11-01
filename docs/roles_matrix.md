# FleetWise Role-Based Access Control (RBAC) Matrix

This document provides a comprehensive mapping of all API routes, HTTP methods, authorization requirements, and role-specific scoping rules across FleetWise.

---

## 1. Role Definitions

| Role | Description |
| :--- | :--- |
| **`public`** | Unauthenticated external callers (e.g., customers tracking deliveries, monitoring probes). |
| **`driver`** | Mobile delivery personnel. Restricted strictly to self-assigned deliveries, telematics submission for their own driver profile, and fuel logging for their assigned vehicle. |
| **`dispatcher`** | Operational coordinators. Manages delivery lifecycle, resource assignments, customer contacts, live telematics monitoring, and operational reporting. |
| **`admin`** | System administrators. Complete control over user provisioning, fleet asset CRUD, audit trails, and detailed system diagnostics. |

---

## 2. API Endpoint Matrix

| Method | Endpoint | Required Role(s) | Scoping & Behavioral Notes |
| :--- | :--- | :--- | :--- |
| **Authentication & Profile** | | | |
| `POST` | `/auth/login` | `public` | Rate limited by IP (10/15 min in prod). Returns access and refresh JWT pair. |
| `POST` | `/auth/refresh` | `public` | Submits single-use refresh token; rotates token pair immediately. |
| `GET` | `/auth/me` | `admin`, `dispatcher`, `driver` | Returns current user profile and role. |
| `POST` | `/auth/register` | `admin` | User provisioning. Enforces strong password rules. |
| `POST` | `/auth/logout` | `admin`, `dispatcher`, `driver` | Revokes the submitted refresh token. |
| **System Probes & Health** | | | |
| `GET` | `/health` | `public` | Minimal liveness probe. Returns `{ "status": "UP" }` or 503. |
| `GET` | `/ready` | `public` | Readiness probe. Checks DB and worker health. Returns `{ "ready": true }` or 503. |
| `GET` | `/api/admin/health` | `admin` | Detailed diagnostics (memory, uptime, node version, DB status). |
| **Vehicle Asset Management** | | | |
| `GET` | `/vehicles` | `admin`, `dispatcher` | Supports pagination (`page`, `limit`), `status`, and `type` filters. |
| `POST` | `/vehicles` | `admin` | Registers new vehicle asset. Capacity and type validated. |
| `GET` | `/vehicles/:id` | `admin`, `dispatcher` | Returns vehicle metadata and current assigned delivery. |
| `PUT` | `/vehicles/:id` | `admin` | Edits vehicle details. Blocked if vehicle is currently in active transit. |
| `DELETE` | `/vehicles/:id` | `admin` | Soft/hard delete. Blocked if vehicle has active delivery assignments. |
| `PATCH` | `/vehicles/:id/status` | `admin` | Updates status (`available`, `maintenance`, `inactive`). |
| **Driver Asset Management** | | | |
| `GET` | `/drivers` | `admin`, `dispatcher` | Lists fleet drivers with pagination and availability filters. |
| `POST` | `/drivers` | `admin` | Creates driver record. Unique phone and name validation. |
| `GET` | `/drivers/:id` | `admin`, `dispatcher` | Returns driver details and current assignment. |
| `PUT` | `/drivers/:id` | `admin` | Updates driver profile. Blocked if driver is in active transit. |
| `DELETE` | `/drivers/:id` | `admin` | Deletes driver. Blocked if actively assigned. |
| **Telematics & Location** | | | |
| `GET` | `/drivers/locations/latest` | `admin`, `dispatcher` | Returns latest GPS fix across entire active fleet. |
| `GET` | `/drivers/:id/locations/history` | `admin`, `dispatcher`, `driver` | Drivers can only access their own history (`id === socket.user.driver_id`). |
| `POST` | `/drivers/:id/location` | `admin`, `driver` | Drivers restricted to posting for their own driver ID. Rate-limited. |
| **Delivery Management & Assignment** | | | |
| `GET` | `/deliveries` | `admin`, `dispatcher`, `driver` | Dispatchers/Admins see all; Drivers see only orders assigned to them. |
| `POST` | `/deliveries` | `admin`, `dispatcher` | Creates pending delivery order. |
| `GET` | `/deliveries/:id` | `admin`, `dispatcher`, `driver` | Drivers can only fetch their own assigned delivery. |
| `PUT` | `/deliveries/:id` | `admin`, `dispatcher` | Updates delivery. Blocked once delivery is marked `delivered`. |
| `DELETE` | `/deliveries/:id` | `admin`, `dispatcher` | Deletes delivery. Blocked if actively in transit. |
| `POST` | `/deliveries/:id/assign` | `admin`, `dispatcher` | Atomic assignment. Enforces conflict and maintenance checks. |
| `PATCH` | `/deliveries/:id/status` | `admin`, `dispatcher`, `driver` | Driver can advance to `in_transit`. Driver is strictly blocked from PATCH to `delivered` (requires POD). Admin override requires reason. |
| **Customer Contact & GDPR Consent** | | | |
| `GET` | `/deliveries/:id/contact` | `admin`, `dispatcher` | Returns customer recipient contact. Drivers receive 403 Forbidden. |
| `PUT` | `/deliveries/:id/contact` | `admin`, `dispatcher` | Updates contact. Consent defaults to 0. Revoking cancels pending outbox rows. |
| `POST` | `/api/customers` | `admin`, `dispatcher` | Registers customer contact for delivery order. |
| `DELETE` | `/api/customers/:deliveryId` | `admin`, `dispatcher` | Anonymizes customer data (GDPR right to be forgotten). |
| **Public Tracking & Privacy** | | | |
| `POST` | `/deliveries/:id/tracking` | `admin`, `dispatcher` | Generates or regenerates signed tracking UUID. |
| `POST` | `/deliveries/:id/tracking/revoke` | `admin`, `dispatcher` | Immediately revokes active tracking link. |
| `GET` | `/api/track/:token` | `public` | Rate limited (30 req/min). Returns data-minimized live status. |
| `GET` | `/t/:token` | `public` | Public responsive tracking map interface. |
| **Proof of Delivery (POD)** | | | |
| `POST` | `/deliveries/:id/complete-otp` | `admin`, `dispatcher`, `driver` | Constant-time HMAC comparison. 5 failed attempts locks delivery. Releases resources atomically. |
| `POST` | `/deliveries/:id/complete-photo` | `admin`, `dispatcher`, `driver` | Magic-byte verified photo upload. Strips EXIF metadata. Releases resources atomically. |
| `POST` | `/deliveries/:id/otp/regenerate` | `admin`, `dispatcher` | Generates fresh OTP if customer lost message. |
| **Maintenance & Fuel Logging** | | | |
| `GET` | `/api/maintenance/schedules` | `admin`, `dispatcher` | Lists scheduled and completed maintenance intervals. |
| `POST` | `/api/maintenance/schedules` | `admin`, `dispatcher` | Schedules maintenance interval. |
| `GET` | `/api/maintenance/overdue` | `admin`, `dispatcher` | Returns list of vehicles exceeding maintenance limits. |
| `POST` | `/api/fuel-logs` | `admin`, `dispatcher`, `driver` | Monotonic odometer verification. Drivers can only log fuel for their currently assigned vehicle. |
| **Reporting & Operational Governance** | | | |
| `GET` | `/api/reports/deliveries` | `admin`, `dispatcher` | Streaming CSV report. Enforces HTTP 413 if query exceeds 5,000 rows. |
| `GET` | `/api/reports/drivers` | `admin`, `dispatcher` | Streaming CSV driver productivity metrics. |
| `GET` | `/api/reports/fleet` | `admin`, `dispatcher` | Streaming CSV fleet utilization report. |
| `GET` | `/api/reports/executive-summary/pdf`| `admin`, `dispatcher` | Executive PDF summary report. |
| `GET` | `/api/dashboard/stats` | `admin`, `dispatcher` | Aggregated dashboard KPI counters and status breakdowns. |
| `GET` | `/api/dashboard/suggestions` | `admin`, `dispatcher` | Scored recommendation engine for vehicle/driver matching. |
| `GET` | `/api/audit-logs` | `admin` | Immutable audit trail. Zero PII stored in log details. |
| `POST` | `/api/seed` | `admin` | Development demo seeding. Refused in production or when `ALLOW_DEMO_SEED !== 'true'`. |
