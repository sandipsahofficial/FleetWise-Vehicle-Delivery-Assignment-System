# FleetWise Threat Model & Security Assessment

This document provides a structured security assessment of FleetWise using the **STRIDE** methodology (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) and documents accepted residual risks.

---

## 1. System Scope & Assets

Key assets requiring protection:
1. **Cryptographic Secrets**: JWT signing keys, OTP HMAC secret, database encryption keys.
2. **Customer Privacy**: Recipient names, emails, phones, physical street addresses.
3. **Operational Integrity**: Vehicle and driver assignment state machines, odometer logs, maintenance status.
4. **Audit Trail**: Immutable accountability records of all status and assignment transitions.

---

## 2. STRIDE Threat Analysis & Mitigations

### 1. Spoofing
- **Threat**: Attackers forging driver identity or dispatching unauthorized orders.
- **Mitigation**:
  - Stateless Bearer JWT tokens signed with HMAC-SHA256.
  - Driver role scoping ensures drivers can only submit GPS telematics and view orders explicitly matching their `driver_id`.
  - In non-test environments, fallback headers (`X-User-Role`) are strictly ignored.

### 2. Tampering
- **Threat**: Tampering with customer OTPs or photo proofs to fraudulently claim delivery completion.
- **Mitigation**:
  - Customer OTPs are never stored in plain text. Stored as HMAC-SHA256 digests.
  - Photo proofs undergo magic-byte binary header inspection (`image/jpeg`, `image/png`, `image/webp`).
  - Odometer readings enforce atomic monotonic checks (`new_odometer >= current_odometer`).

### 3. Repudiation
- **Threat**: Disputed deliveries or unauthorized overrides of maintenance lockouts.
- **Mitigation**:
  - Centralized, append-only `audit_logs` table recording `user_id`, `username`, `role`, `action`, `entity_id`, IP, user agent, and timestamp.
  - Overdue maintenance overrides require an explicit justification string of at least 10 characters, logged irrevocably.

### 4. Information Disclosure
- **Threat**: Public tracking link leaking customer home addresses or driver personal details.
- **Mitigation**:
  - Public tracking API (`GET /api/track/:token`) enforces strict data minimization: full pickup and dropoff street addresses are omitted, returning only high-level city/area coordinates and driver position.
  - Logger configuration redacts authorization tokens, passwords, OTPs, recipient emails, and customer names before stdout emission.

### 5. Denial of Service
- **Threat**: Brute-forcing passwords or exhausting server resources with massive report exports.
- **Mitigation**:
  - Tiered Express rate limiting: strict authentication limit (10 attempts / 15 min), general API limiter (120 req/min), and tracking limiter (30 req/min).
  - Streaming CSV reports enforce an upfront `COUNT(*)` check and reject queries matching >5,000 rows with HTTP 413 Payload Too Large.
  - Uploaded photo proofs capped at 5MB with immediate filesystem cleanup if database transaction fails.

### 6. Elevation of Privilege
- **Threat**: Driver account accessing admin diagnostics or dispatcher customer lists.
- **Mitigation**:
  - Declarative role-based access control middleware (`requireRole(['admin'])`).
  - Drivers attempting to access reports, notification outbox, customer contacts, or admin health receive `403 Forbidden`.

---

## 3. Residual Risks & Accepted Trade-offs

The following items represent conscious architectural trade-offs and residual risks in the current single-instance design:

1. **Refresh Token in `localStorage`**:
   - *Risk*: Refresh tokens stored in browser `localStorage` are vulnerable if a Cross-Site Scripting (XSS) vulnerability exists in frontend dependencies.
   - *Mitigation*: Strict Helmet Content Security Policy (`defaultSrc: 'self'`), single-use refresh token rotation with immediate reuse detection and revocation.
   - *Future Work*: Migrate refresh token storage to `HttpOnly`, `SameSite=Strict`, `Secure` cookies.

2. **Absence of Multi-Factor Authentication (MFA/2FA)**:
   - *Risk*: Administrative or dispatcher accounts compromised via credential stuffing can manage fleet assets without a secondary verification step.
   - *Mitigation*: Strong password entropy rules in production and aggressive brute-force rate limiting.
   - *Future Work*: Implement TOTP (Time-Based One-Time Password) or WebAuthn / FIDO2 keys for privileged roles.

3. **In-Memory Rate Limiting & Socket State**:
   - *Risk*: Rate limit counters and Socket.IO active room subscriptions are held in single-process memory. If the node restarts, rate limit counters reset.
   - *Mitigation*: FleetWise is explicitly architected and documented as a single-instance service.
   - *Future Work*: Add Redis-backed rate limiting and socket adapter when scaling out.

4. **Bearer Tracking Link Sharing**:
   - *Risk*: Any party possessing the unauthenticated tracking URL UUID can view coarse delivery status and live driver position until delivery completion or manual revocation.
   - *Mitigation*: Data minimization ensures street addresses and OTPs are never revealed; tracking links expire automatically upon delivery and can be revoked by dispatchers.

5. **EXIF Stripping Limited to JPEG Format**:
   - *Risk*: EXIF metadata stripping is currently applied to JPEG uploads via binary buffer scanning. PNG or WebP files with embedded metadata chunks (e.g. eXIf) are not stripped.
   - *Mitigation*: In production deployments, drivers predominantly capture mobile camera photos encoded as JPEG.
   - *Future Work*: Integrate full multi-format metadata stripping before writing to disk.

6. **SQLite Single-Instance SPOF**:
   - *Risk*: A physical host failure or volume unmount causes temporary downtime until Fly.io or the host orchestrator restarts the Machine.
   - *Mitigation*: Documented automated backup (`scripts/backup.js`) with integrity verification and offline recovery runbook (`docs/deployment-flyio.md`).

