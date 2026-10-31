# FleetWise Changelog

All notable changes to the FleetWise platform are documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-31 - Phase 4A: Production Readiness, Deployment & Observability

### Added
- **Production Startup Validation**: Centralized Zod-based configuration schema with mutual exclusivity, minimum 32-character requirement, and placeholder rejection for `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `OTP_HMAC_SECRET`.
- **Liveness & Readiness Probes**:
  - `GET /health`: Liveness probe reporting process status, database connection, and system uptime.
  - `GET /ready`: Readiness probe verifying SQLite responsiveness and background outbox worker state with minimal public exposure.
- **Request Observability & Distributed Tracing**:
  - Request ID middleware extracting incoming `X-Request-ID` or generating a `crypto.randomUUID()`.
  - Injected request context into Pino structured logs and response headers.
  - Redaction of authentication tokens, passwords, OTPs, hashes, and PII across all log outputs.
- **Offline Backup & Disaster Recovery**:
  - `scripts/backup.js`: SQLite hot snapshot via `VACUUM INTO`, PRAGMA integrity verification, proofs archiving, and automated retention cleanup.
  - `scripts/restore.js`: Offline CLI restoration utility verifying snapshot integrity before atomic database and proofs file replacement.
- **Graceful Shutdown**: Intercepts `SIGINT` and `SIGTERM` with 10-second hard fallback timeout; closes HTTP server, active Socket.IO connections, outbox worker, and SQLite database cleanly.
- **Multi-Stage Containerization**: Minimalist Alpine-based production Docker image with non-root security context (`USER node`) and persistent volume support.
- **CI/CD Pipeline**: GitHub Actions matrix workflow running Node 22 and 24 with syntax linting (`node --check`), security audit (`npm audit`), test runner, and Docker build verification.
- **Dependabot Integration**: Automated weekly dependency update scans for npm packages and GitHub Actions.

---

## [0.9.0] - 2026-10-31 - Phase 3B: Operations, Routing, Outbox & Maintenance

### Added
- **Distance & ETA Routing Engine**: Pluggable routing interface supporting Haversine calculation and OpenStreetMap OSRM HTTP routing with timeout fallbacks.
- **Transactional Outbox Worker**:
  - At-least-once transactional notification pipeline with exponential backoff and crash recovery.
  - Pluggable delivery channels for Email (SMTP/Console), SMS, and WhatsApp.
  - Customer contact management (`GET/PUT /deliveries/:id/contact`) with explicit opt-in consent and zero PII audit logging.
- **Preventative Vehicle Maintenance & Overdue Override**:
  - Scheduled maintenance based on mileage or due dates with dashboard warning alerts.
  - Dispatcher/Admin assignment override with mandatory audit reason logging (`ASSIGNMENT_OVERDUE_OVERRIDE`).
  - Suggestion ranking penalty for overdue vehicles.
- **Odometer Tracking**: Monotonic mileage updates and telemetry tracking across delivery completion.
- **Streaming Operational Reports**:
  - Memory-efficient CSV exports for deliveries, driver performance, vehicle utilization, and audit trail.
  - Safety cap enforcing HTTP 413 Payload Too Large on exports exceeding 5,000 rows.

---

## [0.8.0] - 2026-10-30 - Phase 3A: Driver PWA, Proof of Delivery & Customer Tracking

### Added
- **Driver Mobile Progressive Web App**:
  - Dedicated mobile web interface (`/driver`) with static shell offline caching via Service Worker.
  - Real-time geolocation broadcasting using `navigator.geolocation` with toggle controls.
- **Proof of Delivery Engine**:
  - Cryptographically secure 6-digit OTP delivery completion with server-side HMAC-SHA256 verification and 5-attempt brute-force lockout.
  - Photo upload proof with magic byte signature verification (JPEG, PNG, WebP), EXIF stripping, 5MB limit, and orphan file rollback cleanup.
- **Public Customer Tracking Portal**:
  - Privacy-preserving public tracking view (`/track/:token`) displaying obfuscated city-level destination, live driver coordinates, and ETA.
  - Strict data minimization: no customer addresses, OTPs, or internal identifiers exposed.

---

## [0.5.0] - 2026-10-30 - Phase 2: Real-Time Telematics & WebSockets

### Added
- **Socket.IO Integration**: JWT handshake authentication with auto-disconnection on token expiration.
- **Room Isolation**: Role-based rooms (`ops_room`, driver-specific rooms) ensuring drivers only receive events for their own assigned deliveries.
- **Live Fleet Telematics**:
  - REST and WebSocket location publishing endpoints with rate limiting, bounding-box sanity checks, and stale timestamp rejection.
  - Time-based location history retention pruning.
- **Interactive Dispatcher Map**: Real-time Leaflet map rendering driver positions with XSS-safe popup sanitization.

---

## [0.2.0] - 2026-10-29 - Phase 1 & 1.5: Production Foundation & Security Hardening

### Added
- **Dual-Mode Authentication Bridge**:
  - Bearer JWT authentication with single-use refresh token rotation and SHA-256 hash storage.
  - Role-Based Access Control (`admin`, `dispatcher`, `driver`).
  - Strict production enforcement rejecting unauthenticated requests and disabling legacy test headers outside `NODE_ENV=test`.
- **Brute-Force Protection**: IP-based rate limiting on authentication and sensitive endpoints.
- **Atomic Concurrency Control**: SQLite `BEGIN IMMEDIATE` transactions preventing double-booking of vehicles or drivers during simultaneous assignments.
- **OpenAPI 3.0 Documentation**: Interactive Swagger UI documentation served at `/api/docs`.
