# Deploying UniMart

The app is one Python process with a SQLite file. That shapes where it can run.

## Render (recommended — full app)

Render runs the `Dockerfile` in this repository, so the storefront, admin console,
accounts, checkout and payment review all work.

1. Create a free account at <https://render.com> and connect your GitHub.
2. **New → Web Service**, pick this repository.
3. Render detects `render.yaml` (or choose **Docker** manually).
4. Deploy. The first build takes a couple of minutes.
5. Open `https://<service>.onrender.com/` and `/admin/` (`admin` / `unimart123`).

Notes:

- Free instances sleep after ~15 minutes idle; the first request after that
  takes ~30 seconds.
- SQLite lives on the container filesystem, so data resets on redeploy/restart.
  Add a **Disk** mounted at `/app/data` if you need it to persist.
- Set a real admin password in `server.py` before making it public.

## Vercel (storefront preview only)

Vercel cannot run this backend: it is serverless and has no persistent process or
writable disk, so `python3 server.py` and SQLite do not fit.

A static preview is still possible — deploy only the front end:

    npx vercel --prod

with a `vercel.json` that builds a `dist/` containing `index.html`,
`checkout.html`, `css/`, `js/`, `assets/` and `admin/`.

What works there: browsing shelves, search, favourites, cart, currency switch.

What does not: accounts, checkout, payments and the admin console all call
`/api/*`, which does not exist on Vercel. The storefront detects this and falls
back to the built-in catalogue, but orders cannot be placed.

## Anywhere else

```bash
python3 server.py --bind 0.0.0.0 --port 8000
```

Works on any host that keeps a process alive (VPS, Railway, Fly.io, a Raspberry
Pi). A reverse proxy should terminate TLS in front of it.
