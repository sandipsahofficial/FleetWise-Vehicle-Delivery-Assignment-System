# Deploying FleetWise to Fly.io

This guide details deploying FleetWise on [Fly.io](https://fly.io) as a single-machine production service with persistent NVMe volume storage.

---

## 1. Prerequisites

- A Fly.io account and the `flyctl` CLI installed.
- Repository cloned locally with an active Docker environment.
- Review official Fly.io documentation and pricing:
  - [Fly.io Pricing Overview](https://fly.io/docs/about/pricing/)
  - [Fly.io Volumes Guide](https://fly.io/docs/machines/guides/volumes/)

---

## 2. Storage & Concurrency Architecture

> [!IMPORTANT]
> **Single-Instance NVMe Volume Mapping**:
> FleetWise uses `node:sqlite` in WAL (Write-Ahead Logging) mode. Fly.io Volumes are local NVMe slices pinned 1-to-1 to a single physical machine and host server.
> - **Concurrency isolation**: Attaching the volume to a single Machine prevents multi-node concurrent file-access conflicts (SQLite file locks cannot be shared safely over network mounts or multiple containers).
> - **Data safety**: A volume does not by itself prevent corruption from ungraceful application crashes or host power loss. SQLite WAL checkpoints mitigate crash recovery, but **regular offsite backups are mandatory** for disaster recovery.

---

## 3. Step-by-Step Deployment

### Step 1: Launch Application Configuration
Initialize the app without deploying immediately:
```bash
fly launch --no-deploy --name fleetwise-app
```

### Step 2: Provision a Persistent Volume
Create an NVMe volume in your target region (e.g. `iad` for US East):
```bash
fly volumes create fleetwise_data --size 1 --region iad
```

### Step 3: Configure `fly.toml`
Ensure your `fly.toml` matches the following configuration:

```toml
app = "fleetwise-app"
primary_region = "iad"

[build]

[mounts]
  source = "fleetwise_data"
  destination = "/data"
  initial_size = "1gb"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "get"
  path = "/health"
  timeout = "5s"

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "get"
  path = "/ready"
  timeout = "5s"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  DB_PATH = "/data/fleetwise.db"
  STORAGE_DIR = "/data/proofs"
  BACKUP_DIR = "/data/backups"
  CORS_ORIGIN = "*"
  NOTIFICATIONS_ENABLED = "false"
  LOG_LEVEL = "info"
```

### Step 4: Set Cryptographic Secrets
Generate strong, mutually distinct 32-byte hex secrets using `openssl rand -hex 32`:
```bash
fly secrets set \
  JWT_SECRET=$(openssl rand -hex 32) \
  JWT_REFRESH_SECRET=$(openssl rand -hex 32) \
  OTP_HMAC_SECRET=$(openssl rand -hex 32) \
  ADMIN_PASSWORD="YourStrongAdminPassword123!"
```

### Step 5: Deploy
Deploy the container to Fly.io:
```bash
fly deploy
```

---

## 4. Post-Deployment Verification (Smoke Test)

Run the automated smoke test suite against your live deployed instance:
```bash
SMOKE_ADMIN_PASSWORD="YourStrongAdminPassword123!" node scripts/smoke_test.js \
  --url https://fleetwise-app.fly.dev \
  --confirm
```

The script exercises:
1. Public liveness `/health` and `/ready` probes.
2. Admin authentication and JWT issuance.
3. Entity creation, delivery assignment, and status lifecycle.
4. Public tracking link data minimization (verifying no address or OTP leakage).
5. HMAC OTP generation and proof of delivery verification.
6. Resource pool release and automated test cleanup.

---

## 5. Disaster Recovery & Offline Restore Drill

### Scheduled Hot Backup
Execute atomic snapshots inside the container or via scheduled task:
```bash
fly ssh console -C "node scripts/backup.js --retention-days 14"
```

Download snapshot offsite:
```bash
fly sftp get /data/backups/ /local/offsite/backups/
```

### Offline Restoration Drill
If data recovery is required:
1. Stop the running machine to release SQLite locks:
   ```bash
   fly machine stop <machine-id>
   ```
2. Upload the verified snapshot:
   ```bash
   fly sftp put /local/offsite/backups/fleetwise-<timestamp>.db /data/backups/
   ```
3. Run the offline restoration script:
   ```bash
   fly ssh console -C "node scripts/restore.js /data/backups/fleetwise-<timestamp>.db --target-db /data/fleetwise.db --proofs /data/proofs"
   ```
4. Restart the machine and verify health:
   ```bash
   fly machine start <machine-id>
   curl -i https://fleetwise-app.fly.dev/health
   ```
