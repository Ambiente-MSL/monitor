# MSL Monitor - Dashboard de Insights Sociais

Dashboard para monitorar métricas orgânicas e pagas de Facebook e Instagram, com relatórios, exportações e visual moderno.

## Principais recursos
- Integração com a Meta Graph API
- Dashboards de Instagram, Facebook e Ads
- Gráficos interativos, mapas e nuvem de palavras
- Exportação de dados (CSV, XLSX, PDF)
- Filtros de período e comparativos
- Cache em memória + Postgres com scheduler
- Autenticação com papéis (analista/admin)
- Docker para produção

## Stack
- Frontend: React (Create React App), React Router, SWR, Recharts, date-fns, PostCSS
- Backend: Python + Flask, Flask-CORS, APScheduler, Facebook Business SDK, Requests
- Banco: PostgreSQL
- Infra: Gunicorn + Nginx + Docker Compose

## Estrutura do projeto
- `src/` - frontend React
- `backend/` - API Flask, jobs e scheduler
- `deploy/backend.env` - variáveis de produção (Docker)
- `docker-compose.yml` - stack completa
- `docs/` - documentação interna

## Rodar localmente

### Backend
```
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate
pip install -r requirements.txt
```

Crie `backend/.env` com pelo menos:
```
META_GRAPH_VERSION=v23.0
META_SYSTEM_USER_TOKEN=SEU_TOKEN
META_APP_SECRET=SEU_SECRET
FACEBOOK_APP_ID=SEU_APP_ID
FACEBOOK_APP_SECRET=SEU_APP_SECRET
AUTH_SECRET_KEY=SEGREDO_FORTE
META_PAGE_ID=123
META_IG_USER_ID=123
META_AD_ACCOUNT_ID=act_123
FRONTEND_ORIGINS=http://localhost:3010
DATABASE_URL=postgresql://usuario:senha@localhost:5432/monitor_db
```

Ou use variáveis separadas:
```
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=monitor_db
DATABASE_USER=postgres
DATABASE_PASSWORD=senha
DATABASE_SSLMODE=disable
```

Rodar API:
```
python server.py
```
API em `http://localhost:3001`.

### Frontend
```
npm install
```

Crie `.env` na raiz:
```
PORT=3010
REACT_APP_API_URL=http://localhost:3001
REACT_APP_FACEBOOK_APP_ID=SEU_APP_ID
REACT_APP_FACEBOOK_CONFIG_ID=SEU_CONFIG_ID
```

Rodar:
```
npm start
```
App em `http://localhost:3010`.

## Banco de dados (Postgres)
1) Crie as tabelas:
```
psql "postgresql://usuario:senha@host:5432/monitor_db" -f backend/sql/app_tables.sql
```
2) Crie um usuário na tabela `app_users` ou via `/api/auth/register`.
3) Para atualizar/criar senha:
```
cd backend
python scripts/update_user_password.py usuario@empresa.com "NovaSenhaForte123"
python scripts/update_user_password.py admin@empresa.com "SenhaSecreta!" --nome "Administrador" --role admin --create
```

## Docker (produção ou staging)
1) Configure `deploy/backend.env` (não versionado) com suas variáveis.
   Use `deploy/backend.env.example` como base.
2) Suba a stack:
```
docker compose up -d --build --remove-orphans
```

Serviços:
- `backend` (Flask + Gunicorn)
- `worker` (scheduler `scheduler_runner.py`)
- `frontend` (build do React servido por Nginx)

## Deploy via GitHub Actions
O workflow em `.github/workflows/deploy.yml` faz deploy por SSH e roda:
```
git fetch origin main
git reset --hard origin/main
docker compose up -d --build --remove-orphans
```
Garanta que o repo no servidor esteja em `/root/monitor` (ou ajuste o workflow).

## Performance e cache
- O scheduler roda no serviço `worker` para manter cache e ingestões.
- Para evitar scheduler duplicado, mantenha `META_SYNC_AUTOSTART=0` no backend.
- Para alinhar o prewarm ao fuso, defina `CACHE_WARM_TZ=America/Sao_Paulo`.
- Para backfill de histórico: `python backend/jobs/backfill_instagram.py --ensure-standard`.
