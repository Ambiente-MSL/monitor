CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'analista',
    nome TEXT NOT NULL,
    facebook_id TEXT UNIQUE,
    facebook_email TEXT,
    facebook_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx ON app_users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS app_users_facebook_id_idx ON app_users (facebook_id) WHERE facebook_id IS NOT NULL;

-- Tokens de autorização Meta vinculados ao usuário logado (para manter o fluxo antigo e registrar escopos aprovados)
CREATE TABLE IF NOT EXISTS meta_user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    facebook_user_id TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}'::text[],
    user_access_token TEXT NOT NULL,
    user_access_expires_at TIMESTAMPTZ,
    page_id TEXT NOT NULL DEFAULT '',
    page_access_token TEXT,
    instagram_user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_user_tokens_user_page_idx ON meta_user_tokens (user_id, page_id);
CREATE INDEX IF NOT EXISTS meta_user_tokens_facebook_idx ON meta_user_tokens (facebook_user_id);

CREATE TABLE IF NOT EXISTS ig_comments (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    media_id TEXT,
    username TEXT,
    text TEXT NOT NULL,
    like_count INTEGER DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ig_comments_daily (
    account_id TEXT NOT NULL,
    comment_date DATE NOT NULL,
    total_comments INTEGER NOT NULL DEFAULT 0,
    word_freq JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, comment_date)
);

-- Tabelas de cache (Instagram, Facebook e Ads)
CREATE TABLE IF NOT EXISTS ig_cache (
    cache_key TEXT PRIMARY KEY,
    resource TEXT NOT NULL,
    owner_id TEXT,
    since_ts BIGINT,
    until_ts BIGINT,
    since_date DATE,
    until_date DATE,
    extra JSONB,
    payload JSONB,
    fetched_at TIMESTAMPTZ,
    next_refresh_at TIMESTAMPTZ,
    ttl_hours INTEGER DEFAULT 24,
    last_refresh_reason TEXT,
    last_refresh_status TEXT,
    last_refresh_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fb_cache (LIKE ig_cache INCLUDING ALL);
CREATE TABLE IF NOT EXISTS ads_cache (LIKE ig_cache INCLUDING ALL);

-- Índices de performance para métricas/Instagram
CREATE INDEX IF NOT EXISTS metrics_daily_account_platform_date_idx
    ON metrics_daily (account_id, platform, metric_date);
CREATE INDEX IF NOT EXISTS metrics_daily_account_platform_key_date_idx
    ON metrics_daily (account_id, platform, metric_key, metric_date);

CREATE INDEX IF NOT EXISTS metrics_daily_rollup_account_platform_date_idx
    ON metrics_daily_rollup (account_id, platform, start_date, end_date);

CREATE INDEX IF NOT EXISTS ig_comments_account_ts_idx
    ON ig_comments (account_id, timestamp);

CREATE TABLE IF NOT EXISTS report_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    default_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
