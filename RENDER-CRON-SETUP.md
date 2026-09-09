# Render Cron Setup — Narmada nightly R2 backup

The blueprint (`render.yaml`) already declares the cron job, but Render Cron
Jobs run in **fresh containers** and cannot read the web service's persistent
disk unless the disk is explicitly attached to the cron in the same region.
If Render's Blueprint auto-provisioning does not attach the disk (older Render
plans), set the cron up manually as described below.

## 1. Create the Cron Job in Render UI

- Dashboard → **New +** → **Cron Job**
- **Name:** `narmada-nightly-backup`
- **Region:** same as `narmada-backend` (Singapore, in current setup)
- **Branch:** `main`
- **Runtime:** `Node`
- **Build command:** `npm install`
- **Command:** `npm run backup`
- **Schedule:** `0 21 * * *` (UTC) → runs at 02:30 IST daily
- **Plan:** Starter

## 2. Attach the persistent disk

- On the same page, expand **Disk** → **Attach existing disk**
- Choose disk `narmada-data` (the one mounted by `narmada-backend`)
- **Mount Path:** `/opt/render/project/src/data`

  This is what our `DATA_DIR` env var points at.

  **If Render prevents sharing the disk across services** (some plans lock a
  disk to one service):

  - Option A — pause the web service just long enough for the cron to run
    (not viable for zero-downtime).
  - Option B — the cron reads from a **read replica** file. Not feasible for
    SQLite. In this case, run the backup **inside the web service** on a
    schedule via an in-process cron (`node-cron`). Add a follow-up ticket.
  - Option C (recommended) — upgrade to a plan that allows shared disks or
    use Render's newer "Persistent Disk on Cron" (available on Pro tier).

## 3. Environment variables

All values are **secrets** — set them in the cron job's Environment tab (do NOT
commit them).

| Key                              | Value                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                       | `production`                                                 |
| `DATA_DIR`                       | `/opt/render/project/src/data`                               |
| `DATABASE_PATH`                  | *(optional; defaults to `$DATA_DIR/data.db`)*                |
| `R2_ACCOUNT_ID`                  | Your Cloudflare account ID (find under R2 dashboard)         |
| `R2_ACCESS_KEY_ID`               | R2 access key                                                |
| `R2_SECRET_ACCESS_KEY`           | R2 secret key                                                |
| `R2_BUCKET_NAME`                 | `narmada-backups`                                            |
| `R2_ENDPOINT`                    | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`           |
| `R2_REGION`                      | `auto`                                                       |
| `BACKUP_ENCRYPTION_PASSPHRASE`   | Strong random passphrase (store securely in 1Password/Vault) |

**Recovery reminder:** the passphrase is the ONLY way to decrypt backups. Store
it separately from the R2 credentials — otherwise a single credential leak
could unlock the archives.

## 4. Optional: install `age` in the runtime image

The script prefers `age -p` for encryption. If Render's default Node image
doesn't ship `age`, the script falls back to `openssl aes-256-cbc -pbkdf2`
which is always available. To use `age`, add a custom **Dockerfile** to the
service that installs it before the Node build (`apk add age` on Alpine or
`apt-get install -y age` on Debian).

## 5. Verify

- Run the cron **manually once** from the Render dashboard.
- In R2, confirm an object appears at `s3://<bucket>/YYYY/MM/DD/data.db.gz.age`.
- On the web service DB, `SELECT * FROM backup_log ORDER BY id DESC LIMIT 5;`
  should show `status = 'success'`.

## 6. Recovery drill

```bash
# 1. Pull yesterday's backup
aws --endpoint-url "$R2_ENDPOINT" s3 cp \
    "s3://$R2_BUCKET_NAME/2026/09/09/data.db.gz.age" ./data.db.gz.age

# 2a. Decrypt with age
age -d -o data.db.gz data.db.gz.age

# 2b. …or with openssl (if the backup was created via the fallback)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in data.db.gz.age -out data.db.gz \
    -pass file:<(printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE")

# 3. Gunzip and inspect
gunzip data.db.gz
sqlite3 data.db "SELECT COUNT(*) FROM email_log;"
```

Do a recovery drill at least monthly. A backup that has never been restored is
not a backup.
