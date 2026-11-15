# UniMart — single-process app. SQLite is created on first boot.
FROM python:3.12-slim

WORKDIR /app

# Only what the server needs at runtime.
COPY server.py ./
COPY index.html checkout.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY admin ./admin
COPY data/seed_catalog.json ./data/seed_catalog.json

ENV PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

CMD ["python3", "server.py", "--bind", "0.0.0.0"]
