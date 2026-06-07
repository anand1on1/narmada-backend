# Narmada Mobility — Full Setup Guide
## GoDaddy (frontend + admin UI) + Render.com (backend + database)

This setup lets your admin panel work even on GoDaddy's shared Linux hosting (which has no Node.js). You'll deploy two pieces:

| Piece | Where | Cost |
|---|---|---|
| Frontend (website + admin UI) | GoDaddy `public_html/` | included in your existing plan |
| Backend (API + SQLite database + admin auth) | Render.com Singapore | $7/mo (Starter plan — required for persistent data) |

> **Why Starter and not Free?** Render's free plan has no persistent disk — your products and contacts would be wiped on every restart (every ~15 min of inactivity). The $7/mo Starter plan gives you a 1 GB persistent disk that survives restarts and redeploys.

---

## STEP 1 — Push backend to GitHub

1. Sign in to [github.com](https://github.com) (create a free account if needed).
2. Click **New repository** → name it `narmada-backend` → **Private** → Create.
3. On your laptop, unzip `narmada-render-backend.zip` to a folder.
4. From terminal (or GitHub Desktop):
   ```
   cd narmada-render-backend
   git init
   git add .
   git commit -m "Initial backend"
   git branch -M main
   git remote add origin https://github.com/<your-username>/narmada-backend.git
   git push -u origin main
   ```

> Don't want to use git? Just upload the unzipped folder to your repo via the GitHub web UI ("Add file → Upload files").

---

## STEP 2 — Create the Render service

1. Sign up at [render.com](https://render.com) (free account; you pay only for the service plan).
2. Connect your GitHub account (Render asks once during signup).
3. Click **New +** → **Blueprint**.
4. Pick the `narmada-backend` repo. Render will detect `render.yaml` and propose creating the service automatically.
5. Click **Apply** → wait ~5 min for the first build.
6. When it's done, you'll get a public URL like:
   ```
   https://narmada-backend.onrender.com
   ```
   **Copy this URL — you'll paste it into config.js in the next step.**

7. Confirm it's live: open `https://narmada-backend.onrender.com/healthz` → should print `{"ok":true,...}`.

> Render auto-redeploys whenever you push to GitHub `main` branch.

---

## STEP 3 — Upload frontend to GoDaddy

1. Unzip `narmada-mobility-godaddy.zip` on your laptop.
2. **Edit `config.js`** in the unzipped folder. Change the one line to:
   ```js
   window.__API_BASE__ = "https://narmada-backend.onrender.com";
   ```
   (Use your actual Render URL from Step 2.)

3. Open GoDaddy cPanel → File Manager → `public_html/`.
4. Delete any existing `index.html` / "Coming Soon" page.
5. Upload all the files (including the edited `config.js` and the hidden `.htaccess`).
   - Tip: zip the edited folder again and use cPanel's "Extract" feature for faster upload.
6. cPanel → **SSL/TLS Status** → tick your domain → **Run AutoSSL** (free Let's Encrypt cert).

Visit your domain — it should load, and you should be able to:
- Browse all 20 brand pages
- Submit the contact form (saves to the Render database)
- Log into admin at `https://yourdomain.com/#/admin/login`

Admin login:
- Username: `narmadamobility123`
- Password: `Mausami@@2026 ` (note the trailing space)

---

## STEP 4 — Tell Render about your real domain (CORS)

The `render.yaml` already lists `https://narmadamobility.com` and `https://www.narmadamobility.com` as allowed origins. If your live domain is different:

1. Render dashboard → your `narmada-backend` service → **Environment**.
2. Edit `ALLOWED_ORIGINS` → set to `https://yourdomain.com,https://www.yourdomain.com`.
3. Save → Render auto-restarts in ~30 sec.

---

## What if Render is down or slow?

- **Free tier sleeps after 15 min of inactivity.** First request after sleep takes ~30 sec to wake. Starter ($7/mo) stays awake — recommended for production.
- **Cold-start tip:** Set a free uptime monitor like [betterstack.com](https://betterstack.com) or [uptimerobot.com](https://uptimerobot.com) to ping `https://narmada-backend.onrender.com/healthz` every 5 minutes. Keeps the server warm even on the free plan.

---

## Backup your database

Your products and contacts live in `/opt/render/project/src/data/data.db` on Render. To download a backup:

1. Render dashboard → your service → **Shell** tab.
2. Run:
   ```
   cat data/data.db | base64
   ```
3. Copy the printed text, paste into a file on your laptop named `backup.b64`, then:
   ```
   base64 -d backup.b64 > data.db
   ```

Or schedule a weekly backup using Render's built-in disk snapshot (Dashboard → Disk → Snapshots).

---

## Troubleshooting

**Admin login says "Network error"**
→ Check browser console (F12). If you see a CORS error, your domain isn't in `ALLOWED_ORIGINS`. Fix in Render Environment tab.

**Contact form does nothing**
→ Open browser console. Check `config.js` was edited correctly and `window.__API_BASE__` matches your Render URL.

**`/api/products` returns 404 on the deployed site**
→ Your `config.js` still says `""`. Edit it to point at the Render URL.

**Render build fails with "better-sqlite3" error**
→ Render dashboard → Build & Deploy → **Clear build cache & deploy**. Usually fixes native module rebuilds.

---

## Costs at a glance

| Item | Cost |
|---|---|
| GoDaddy Web Hosting Linux | (your existing plan) |
| Render Starter plan | $7/mo (~₹585/mo) |
| Render free tier (if you don't need persistent data) | $0 |
| GitHub private repo | Free |
| Let's Encrypt SSL on GoDaddy | Free |
| **Total recurring (production)** | **~₹585/mo on top of GoDaddy** |

---

## Contact

- WhatsApp: +91 79090 83806
- Email: sales@Narmadamobility.com
- Admin: https://yourdomain.com/#/admin/login
