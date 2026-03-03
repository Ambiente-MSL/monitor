# MSL Monitor

Dashboard para metricas de Instagram, Facebook e Ads com backend Flask, frontend React e worker de sincronizacao.

## Arquitetura
- `frontend`: React (build estatico servido por Nginx)
- `backend`: Flask + Gunicorn (API)
- `worker`: scheduler (`python scheduler_runner.py`)
- `postgres`: recomendado como servico gerenciado no Dokploy

## Padrao de deploy (Dokploy)
Este repositorio esta preparado para o modelo abaixo:
1. Criar `1` servico PostgreSQL no Dokploy (gerenciado)
2. Criar `1` app Docker Compose com `frontend + backend + worker`
3. Apontar backend/worker para o host interno do Postgres gerenciado

## Variaveis obrigatorias no Dokploy
Configure no app Compose (backend e worker):

```env
DATABASE_HOST=<host interno do servico postgres>
DATABASE_PORT=5432
DATABASE_NAME=monitor
DATABASE_USER=<usuario interno do postgres>
DATABASE_PASSWORD=<senha interna do postgres>
DATABASE_SSLMODE=disable

AUTH_SECRET_KEY=<chave forte>
FRONTEND_ORIGINS=https://seu-dominio.com
FRONTEND_ORIGIN=https://seu-dominio.com

META_GRAPH_VERSION=v23.0
META_SYSTEM_USER_TOKEN=<token meta>
META_APP_SECRET=<app secret meta>
META_PAGE_ID=<id pagina>
META_IG_USER_ID=<id instagram>
META_AD_ACCOUNT_ID=act_<id ads>

FACEBOOK_APP_ID=<app id>
FACEBOOK_APP_SECRET=<app secret>
```

Configure no build do frontend:

```env
# Recomendado: vazio para usar mesma origem e proxy /api do nginx
REACT_APP_API_URL=

# Opcional: se preencher, use dominio base sem /api
# Exemplo valido: https://monitor.mslestrategia.com.br

REACT_APP_FACEBOOK_APP_ID=<app id>
REACT_APP_FACEBOOK_CONFIG_ID=<config id>
REACT_APP_LEGAL_BASE_URL=https://seu-dominio.com
```

## Subir no Dokploy
1. Conecte o provider (GitHub/GitLab) e selecione este repositorio.
2. Escolha deploy por `docker-compose.yml` na raiz.
3. Cadastre as variaveis acima.
4. Crie dominio apenas para o servico `frontend` (porta interna `80`).
5. Deploy.

## Banco de dados
Se o banco estiver vazio, aplique schema:

```bash
psql "postgresql://usuario:senha@host:5432/monitor" -f backend/sql/app_tables.sql
```

Para criar/atualizar senha de usuario:

```bash
cd backend
python scripts/update_user_password.py usuario@empresa.com "NovaSenhaForte123"
python scripts/update_user_password.py admin@empresa.com "SenhaSecreta!" --nome "Administrador" --role admin --create
```

## Restaurar dados antigos (`monitor_db` -> `monitor`)
Fluxo recomendado:
1. Pare `backend` e `worker`.
2. Faça backup do banco `monitor` atual.
3. Restaure dump/export antigo no banco `monitor` do Dokploy.
4. Rode deploy novamente no app.

## Rodar localmente (sem Dokploy)
Backend:
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Frontend:
```bash
npm install
npm start
```

## Observacoes
- O login retornar HTML `404 Not Found` indica erro de rota/proxy/API, nao erro de senha.
- O frontend deve chamar `/api/*` no mesmo dominio quando `REACT_APP_API_URL` estiver vazio.
- O scheduler deve rodar apenas no `worker`.
