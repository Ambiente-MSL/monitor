FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    META_SYNC_AUTOSTART=0 \
    WEB_CONCURRENCY=2 \
    GUNICORN_THREADS=8 \
    GUNICORN_TIMEOUT=120

WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

# Porta interna do backend
EXPOSE 3001

# O scheduler roda no servico worker; o backend web atende apenas a API.
CMD ["sh", "-c", "exec gunicorn -b 0.0.0.0:3001 -w ${WEB_CONCURRENCY:-2} -k gthread --threads ${GUNICORN_THREADS:-8} --timeout ${GUNICORN_TIMEOUT:-120} server:app"]
