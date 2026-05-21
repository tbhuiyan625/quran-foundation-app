# DeenCore Deployment Guide (Vercel frontend + Render backend)

This repo's app lives in the **`DEENCORE/`** subfolder:

- **Frontend** — Vite + React, at `DEENCORE/` (`src/`, `index.html`, `vite.config.js`, `package.json`).
- **Backend** — Express, at `DEENCORE/server/` with its own `package.json` so Render installs only backend deps.

Production split:

- **Render** hosts the **backend** and holds the Quran Foundation **secrets**.
- **Vercel** hosts the **frontend** and only knows the public backend URL via `VITE_API_URL`.

Everything below is wired by files in this PR:

| File | Role |
|---|---|
| `render.yaml` | Render blueprint (root=`DEENCORE/server`, build=`npm install`, start=`node index.js`, health=`/api/health`). |
| `DEENCORE/vercel.json` | Vercel config (`vite` framework, `dist` output, SPA rewrites). |
| `DEENCORE/server/package.json` | Backend-only deps so Render installs lean. |
| `DEENCORE/.env.production.example` | Template for `VITE_API_URL` to paste into Vercel. |
| `DEENCORE/.env.example` | Frontend env template (no secrets allowed). |
| `DEENCORE/server/.env.example` | Backend env template (all DEENCORE secrets + `CORS_ORIGIN`). |

The deploy is almost all clicks — no editing.

---

## 1) Backend on Render

Render reads `render.yaml` automatically. The blueprint declares:

| Setting               | Value                            |
| --------------------- | -------------------------------- |
| **Name**              | `deencore-backend`               |
| **Runtime**           | Node 20                          |
| **Root Directory**    | `DEENCORE/server`                |
| **Build Command**     | `npm install`                    |
| **Start Command**     | `node index.js`                  |
| **Health Check Path** | `/api/health`                    |
| **Plan**              | Free                             |
| **Branch**            | `main`                           |

### Steps

1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect GitHub and select **`quranfoundationhackathon/quran-foundation-app`**.
3. Render detects `render.yaml`. Click **Apply**.
4. When prompted for the `sync: false` variables, paste:

   | Key                | Value                                                                                       |
   | ------------------ | ------------------------------------------------------------------------------------------- |
   | `QF_CLIENT_ID`     | *your DEENCORE client id*                                                                   |
   | `QF_CLIENT_SECRET` | *your DEENCORE client secret*                                                               |
   | `CORS_ORIGIN`      | `*` for now — tighten to your Vercel URL after step 2 (e.g. `https://deencore.vercel.app`)  |

5. Click **Deploy**. First build takes ~2 minutes.
6. Copy the live URL Render gives you, e.g. `https://deencore-backend.onrender.com`.
7. Verify:
   - `https://<your-backend>.onrender.com/api/health` → JSON with `"status": "ok"` and `"credentials_configured": true`.

> Free tier sleeps after ~15 min idle. First request after sleep is ~30–60s.

### Backend env vars (Render → Environment)

| Key                | Required | Value                                                |
| ------------------ | -------- | ---------------------------------------------------- |
| `QF_CLIENT_ID`     | ✅       | (secret)                                             |
| `QF_CLIENT_SECRET` | ✅       | (secret)                                             |
| `QF_AUTH_URL`      | optional | Pre-live: `https://prelive-oauth2.quran.foundation` &nbsp;·&nbsp; Production: `https://oauth2.quran.foundation` |
| `QF_API_BASE`      | optional | Pre-live: `https://apis-prelive.quran.foundation` &nbsp;·&nbsp; Production: `https://apis.quran.foundation` |
| `PORT`             | auto     | Render injects this                                  |
| `CORS_ORIGIN`      | ✅       | `https://<your-frontend>.vercel.app` (or `*` to start) |
| `NODE_VERSION`     | preset   | `20`                                                 |

---

## 2) Frontend on Vercel

`DEENCORE/vercel.json` already locks the config:

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "outputDirectory": "dist"
}
```

### Steps

1. Go to https://vercel.com/new.
2. Import **`quranfoundationhackathon/quran-foundation-app`**.
3. **Important — set Root Directory:**
   - Click **Edit** next to "Root Directory" → choose **`DEENCORE`** → Continue.
   - (Without this, Vercel will look for `package.json` at the repo root and fail.)
4. Confirm auto-detected settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
5. Expand **Environment Variables** and add for **Production** (and Preview if desired):

   | Key            | Value                                       |
   | -------------- | ------------------------------------------- |
   | `VITE_API_URL` | `https://deencore-backend.onrender.com` *(no trailing slash; use the URL from Render step 6)* |

6. Click **Deploy**. First build takes ~1 minute.
7. Copy the Vercel URL, e.g. `https://deencore.vercel.app`.

### After the frontend is live: lock down CORS

8. Back in Render → `deencore-backend` → **Environment** → edit `CORS_ORIGIN`:
   - Change from `*` to `https://deencore.vercel.app` (comma-separate any custom domains).
   - Save. Render redeploys automatically.

---

## 3) Secret-handling rules (enforced by this repo)

- DEENCORE secrets (`QF_CLIENT_ID`, `QF_CLIENT_SECRET`) **only** in:
  - `DEENCORE/server/.env` locally (gitignored).
  - Render Environment Variables in production.
- The frontend **never** sees them. The browser only knows `VITE_API_URL`.
- Vite refuses to inline anything that does not start with `VITE_`; nothing in `DEENCORE/src/` reads `QF_*`.

---

## 4) Local development

```bash
# 1. Backend
cd DEENCORE
cp server/.env.example server/.env   # fill in real QF credentials
npm install
npm run server                       # http://localhost:3001

# 2. Frontend (separate terminal, same DEENCORE/ dir)
npm run dev                          # http://localhost:5173
# The frontend auto-targets http://localhost:3001 in dev mode.
```

## 5) Local production smoke test

```bash
cd DEENCORE
npm install
npm run build
QF_CLIENT_ID=... QF_CLIENT_SECRET=... PORT=8080 node server/index.js
# Open http://localhost:8080/api/health
```

---

## 6) Final test checklist

After both services are live:

- [ ] `GET https://<backend>.onrender.com/api/health` returns `200` with `credentials_configured: true`.
- [ ] `GET https://<backend>.onrender.com/api/chapters` returns 114 chapters.
- [ ] `https://<frontend>.vercel.app` loads the UI.
- [ ] Open DevTools → Network: API requests go to `<backend>.onrender.com`, not `localhost`.
- [ ] No CORS errors in the browser console.
- [ ] Surah selection, translations, audio, prayer times, and search all work.
- [ ] `view-source:` of the Vercel page shows **no** `QF_CLIENT_ID` / `QF_CLIENT_SECRET` strings.

---

## 7) GitHub Pages note

This branch removes `.github/workflows/deploy.yml` (the GitHub Pages action) because:

- It conflicts with the Vercel/Render split deploy (two deployments racing on every push).
- The hardcoded `base: '/quran-foundation-app/'` in `vite.config.js` was only needed for GH Pages and breaks Vercel routes. It is now `VITE_BASE_PATH || '/'`.

If you want GitHub Pages **back** alongside Vercel:

1. Restore `.github/workflows/deploy.yml`.
2. In that workflow, add `env: VITE_BASE_PATH: /quran-foundation-app/` before `npm run build`.

---

## 8) Common gotchas

- **`VITE_API_URL` changes need a rebuild.** Vercel auto-rebuilds when you change env vars in Production scope.
- **No trailing slash on `VITE_API_URL`.** The frontend strips one anyway, but cleaner to omit.
- **Render free instances sleep.** Use a cron pinger (e.g. `cron-job.org` → `/api/health` every 10 min) during the demo.
- **Token errors after deploy.** Hit `/api/health` first — if `credentials_configured: false`, env vars are missing or are still placeholders.
- **Vercel build fails with "no package.json".** You forgot step 2.3 — set Root Directory to `DEENCORE`.
