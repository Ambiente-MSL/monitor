# Contextualizacao e revisao do sistema Monitor

## Objetivo do produto
- Dashboard web para acompanhar desempenho de Facebook, Instagram e Ads.
- Foco em indicadores diarios, comparativos por periodo e exportacao de relatorios.
- Integracao com Meta Graph API e cache para reduzir latencia e custo.

## Arquitetura (alto nivel)
- Frontend: React SPA (React Router, Recharts, date-fns).
- Backend: Flask (Python) com API REST.
- Banco: Postgres (usuarios, contas conectadas, cache, relatorios, comentarios IG).
- Jobs: processos de ingestao/refresh para dados do Instagram.

## Fluxos principais
### Autenticacao
- Login via email/senha e via Facebook.
- Token salvo em localStorage e validado em `/api/auth/session`.
- Rotas privadas sao protegidas no frontend pelo `AuthProvider`.

### Contas conectadas
- Contas manuais em `/api/accounts`.
- Descoberta automatica via Meta em `/api/accounts/discover`.
- Seletor de contas usa query param `account` e persiste no localStorage.

### Dashboards e filtros
- Filtro por periodo usa `since` e `until` em Unix seconds.
- Presets (7d, 1m, 3m, 6m, 1y) + intervalo customizado.
- Ads usa datas ISO `yyyy-MM-dd`.

### Cache de dados
- Frontend: cache local por pagina em `localStorage` (expira no fim do dia).
- Backend: cache em Postgres com TTL configuravel.
- Fallback para ultimo cache em caso de erro do Meta.

### Wordcloud de comentarios (Instagram)
- Endpoint `GET /api/instagram/comments/wordcloud`.
- Fonte: `ig_comments_daily` (agregado) com fallback para `ig_comments` (raw).
- Tokenizacao com stopwords e filtro de palavras curtas.

### Exportacao de relatorios
- Frontend gera CSV/XLSX/PDF.
- Consolidacao via chamadas a endpoints de Facebook, Instagram e Ads.

## Estrutura do repositorio (mapa rapido)
- `src/`: frontend React (pages, components, context, hooks, lib).
- `backend/`: Flask app, integracao Meta, cache, jobs e scheduler.
- `backend/sql/app_tables.sql`: schema base do Postgres.
- `backend/static/legal/`: termos e politicas.
- `docker-compose.yml` e Dockerfiles para deploy.

## Pontos de entrada recomendados
- Frontend: `src/router.jsx`, `src/App.jsx`, `src/context/AuthContext.jsx`,
  `src/context/AccountsContext.jsx`, `src/pages/InstagramDashboard.jsx`.
- Backend: `backend/server.py`, `backend/meta.py`, `backend/cache.py`,
  `backend/jobs/instagram_ingest.py`, `backend/sql/app_tables.sql`.

## Configuracao (env vars essenciais)
Frontend:
- `REACT_APP_API_URL` (base da API)
- `REACT_APP_FACEBOOK_APP_ID` e `REACT_APP_FACEBOOK_CONFIG_ID`
- `REACT_APP_LEGAL_BASE_URL` ou `REACT_APP_BACKEND_URL`

Backend:
- Auth: `AUTH_SECRET_KEY`, `AUTH_TOKEN_TTL_SECONDS`
- Meta: `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_GRAPH_VERSION`
- Cache: `META_CACHE_TTL_HOURS`, `CACHE_TABLE`
- DB: `DATABASE_URL` (ou host/user/password/port)

## Revisao tecnica (estado atual)
### Pontos positivos
- Separacao clara de camadas (frontend, backend, jobs).
- Cache local + backend reduz chamadas repetidas ao Meta.
- Dashboards com variedade de metricas e comparativos.

### Riscos e observacoes (tecnicos)
- Possivel travamento no carregamento de contas quando a descoberta retorna vazia
  e o loading nao e finalizado (ver `src/context/AccountsContext.jsx`).
- Exportacao de relatorios ignora conta selecionada no Facebook
  (pageId pode ficar undefined em `src/pages/Reports.jsx`).
- Exportacao usa fetch sem auth e sem validar status de resposta em alguns pontos,
  o que pode gerar dados vazios silenciosamente.
- Preview de PDF usa `innerHTML` com dados dinamicos, com risco de XSS se os dados
  puderem ser editados por usuarios.

### Desempenho percebido (UI)
- A pagina de Instagram passou a manter dados anteriores enquanto atualiza filtros,
  com timeout e retry para reduzir necessidade de clicar novamente.
- A validacao inicial de sessao exibe skeleton do dashboard ao inves de tela de
  carregamento bloqueante.

### Lacunas de testes
- Nao ha suite de testes automatizados para fluxos criticos (auth, dashboards,
  exportacao, integracao Meta).

## Historico recente de ajustes (working tree)
- Filtro de palavras curtas na wordcloud e stopwords adicionais no backend.
- Melhorias de loading e cache no dashboard do Instagram.
- Skeleton global no carregamento apos login.

## Proximos passos sugeridos
- Corrigir exportacao para respeitar conta ativa e validar status HTTP.
- Revisar uso de `innerHTML` em preview de PDF (sanitizar ou evitar).
- Adicionar testes basicos de login, filtros e exportacao.
