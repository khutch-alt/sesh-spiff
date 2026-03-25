# Sesh SPIFF App — Railway Deployment Guide

## Quick Deploy to Railway

### 1. Push to GitHub
Create a new GitHub repo and push the project files:
```bash
git init
git add -A
git commit -m "Sesh SPIFF App v2"
git remote add origin https://github.com/YOUR_USERNAME/sesh-spiff.git
git push -u origin main
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `sesh-spiff` repository
4. Railway will auto-detect the Dockerfile and start building

### 3. Set Environment Variables
In the Railway dashboard for your service, go to **Variables** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `JWT_SECRET` | `your-strong-random-secret` | **Required** — change from default |
| `DB_PATH` | `/app/data/spiff.db` | Already set in Dockerfile |
| `PORT` | `8000` | Railway sets this automatically |

### 4. Add Persistent Volume (Important!)
SQLite data will be lost on redeploy without a volume:
1. In Railway dashboard, click **"+ New"** → **"Volume"**
2. Mount path: `/app/data`
3. This persists the SQLite database across deploys

### 5. Generate a Domain
1. Go to **Settings** → **Networking** → **Generate Domain**
2. Railway gives you a `*.up.railway.app` URL
3. Or add a custom domain (e.g., `spiff.seshbrands.com`)

## Demo Accounts (seeded on first start)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@sesh.com | sesh2026 |
| Harbor Rep | rep@harbor.com | harbor2026 |
| Snowball Rep | rep@snowball.com | snowball2026 |

## Architecture

- **Backend**: FastAPI (Python) with SQLite
- **Frontend**: Vanilla JS (served by the same FastAPI process)
- **Auth**: HMAC-signed tokens (7-day expiry)
- Everything runs in a single process/container

## Cost

Railway Hobby plan: **~$5/month** for low-traffic usage (demo/small team).

## Future: Postgres Migration

For production scale, swap SQLite for Postgres:
1. Add a Railway Postgres service
2. Set `DATABASE_URL` environment variable
3. Update `api_server.py` to use `psycopg2` or `asyncpg` instead of `sqlite3`
