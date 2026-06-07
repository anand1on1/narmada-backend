# Narmada Mobility — Backend (Render.com)

Express + SQLite backend that powers the admin panel, products API, contact form, and sitemap generator for the Narmada Mobility website hosted on GoDaddy.

## Quick deploy

1. Push this folder to a GitHub repo (private is fine).
2. Sign in to [render.com](https://render.com), click **New + → Blueprint**, pick this repo.
3. Render detects `render.yaml` and creates the service automatically.
4. Wait ~5 min for the first build. You get a URL like `https://narmada-backend.onrender.com`.
5. Paste that URL into your GoDaddy `config.js` (see `RENDER-DEPLOY-GUIDE.md`).

See `RENDER-DEPLOY-GUIDE.md` for the full step-by-step.

## Local development

```bash
npm install
npm run dev
```

Backend + frontend both run at http://localhost:5000.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | 5000 | Render sets this automatically |
| `NODE_ENV` | yes | production | Render sets this from render.yaml |
| `ALLOWED_ORIGINS` | yes | (empty = block all browsers) | Comma-separated list of allowed frontend origins, e.g. `https://narmadamobility.com,https://www.narmadamobility.com` |
| `ADMIN_USERNAME` | yes | narmadamobility123 | Admin panel username |
| `ADMIN_PASSWORD` | yes | `Mausami@@2026 ` | Admin password (note trailing space) |
| `DATA_DIR` | no | `.` | Where SQLite stores `data.db`. Render mounts a persistent disk at `/opt/render/project/src/data`. |

## API endpoints

Public:
- `GET /healthz` — health check
- `GET /api/products` — list products (supports `?brand=`, `?category=`, `?q=`)
- `GET /api/products/:slug` — single product
- `GET /api/settings/fx` — USD/INR rate
- `GET /api/site/meta` — site metadata
- `POST /api/contact` — submit contact form
- `GET /sitemap.xml`, `GET /robots.txt`

Admin (requires `x-admin-token` header from `/api/admin/login`):
- `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`
- `GET/POST/PATCH/DELETE /api/admin/products[/:id]`
- `POST /api/admin/upload-image`
- `GET /api/admin/contacts`, `PATCH /api/admin/contacts/:id`
- `GET/PATCH /api/admin/settings`
- `POST /api/admin/sitemap/regenerate`, `GET /api/admin/sitemap/status`, `GET /api/admin/sitemap/download`

## Contact

- WhatsApp: +91 79090 83806
- Email: sales@Narmadamobility.com
