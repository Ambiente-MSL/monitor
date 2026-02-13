# backend/server.py
import os
import re
import time
import logging
import math
import secrets
import unicodedata
import uuid
import json
import threading
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Sequence, Union

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from psycopg2.extras import Json
import requests

from auth_utils import hash_password as _hash_password, verify_password as _verify_password
from cache import (
    get_cached_payload,
    get_latest_cached_payload,
    mark_cache_error,
    register_fetcher,
)
from uuid import uuid4
from meta import (
    MetaAPIError,
    ads_highlights,
    get_page_access_token,
    fb_audience,
    fb_page_window,
    fb_recent_posts,
    ig_audience,
    ig_organic_summary,
    ig_recent_posts,
    ig_recent_posts_insights,
    ig_window,
    normalize_ig_audience_timeframe,
    gget,
)
from ig_audience_snapshots import load_latest_snapshot, persist_audience_snapshot, resolve_snapshot_date
from jobs.instagram_ingest import ingest_account_range, daterange
from jobs.instagram_comments_ingest import ingest_account_comments
from scheduler import MetaSyncScheduler
from postgres_client import get_postgres_client
from db import execute, fetch_all, fetch_one

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


DEFAULT_DEV_ORIGINS = [
    "http://localhost:3010",
    "http://127.0.0.1:3010",
]
CONNECTED_ACCOUNTS_TABLE = os.getenv("CONNECTED_ACCOUNTS_TABLE", "connected_accounts")
META_TOKENS_TABLE = os.getenv("META_TOKENS_TABLE", "meta_user_tokens")
META_LOGIN_SCOPES = [
    scope.strip()
    for scope in (os.getenv("META_LOGIN_SCOPES") or "pages_read_engagement,pages_show_list,instagram_basic,email,public_profile").split(",")
    if scope.strip()
]
META_LOGIN_SCOPES_SET = {scope.lower() for scope in META_LOGIN_SCOPES}


def _resolve_allowed_origins() -> Union[str, List[str]]:
    raw_values = []
    env_multiple = os.getenv("FRONTEND_ORIGINS")
    env_single = os.getenv("FRONTEND_ORIGIN")
    if env_multiple:
        raw_values.append(env_multiple)
    if env_single:
        raw_values.append(env_single)

    if raw_values:
        normalized: List[str] = []
        for chunk in raw_values:
            pieces = [item.strip() for item in chunk.split(",")]
            for item in pieces:
                if item and item not in normalized:
                    normalized.append(item)
        if not normalized:
            return DEFAULT_DEV_ORIGINS
        if len(normalized) == 1:
            return normalized[0]
        return normalized

    return DEFAULT_DEV_ORIGINS


def _ensure_connected_accounts_table() -> None:
    """
    Garante que a tabela de contas conectadas exista para persistir contas manuais.
    """
    try:
        execute(
            f"""
            CREATE TABLE IF NOT EXISTS {CONNECTED_ACCOUNTS_TABLE} (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                facebook_page_id TEXT NOT NULL,
                instagram_user_id TEXT NOT NULL,
                ad_account_id TEXT NOT NULL,
                profile_picture_url TEXT,
                page_picture_url TEXT,
                source TEXT DEFAULT 'manual',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            """,
        )
        execute(
            f"CREATE INDEX IF NOT EXISTS {CONNECTED_ACCOUNTS_TABLE}_page_idx ON {CONNECTED_ACCOUNTS_TABLE} (facebook_page_id);"
        )
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao garantir tabela de contas conectadas: %s", err)


def _ensure_meta_tokens_table() -> None:
    """
    Garante que a tabela de tokens Meta exista para armazenar access_tokens aprovados no login.
    """
    try:
        execute(
            f"""
            CREATE TABLE IF NOT EXISTS {META_TOKENS_TABLE} (
                id UUID PRIMARY KEY,
                user_id UUID REFERENCES {APP_USERS_TABLE}(id) ON DELETE CASCADE,
                facebook_user_id TEXT NOT NULL,
                scopes TEXT[] NOT NULL DEFAULT '{{}}'::text[],
                user_access_token TEXT NOT NULL,
                user_access_expires_at TIMESTAMPTZ,
                page_id TEXT NOT NULL DEFAULT '',
                page_access_token TEXT,
                instagram_user_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """,
        )
        execute(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {META_TOKENS_TABLE}_user_page_idx ON {META_TOKENS_TABLE} (user_id, page_id);"
        )
        execute(
            f"CREATE INDEX IF NOT EXISTS {META_TOKENS_TABLE}_facebook_idx ON {META_TOKENS_TABLE} (facebook_user_id);"
        )
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao garantir tabela de tokens Meta: %s", err)


def _load_connected_accounts() -> List[Dict[str, Any]]:
    try:
        rows = fetch_all(f"SELECT * FROM {CONNECTED_ACCOUNTS_TABLE} ORDER BY label ASC")
        return [
            {
                "id": row.get("id"),
                "label": row.get("label"),
                "facebookPageId": row.get("facebook_page_id"),
                "instagramUserId": row.get("instagram_user_id"),
                "adAccountId": row.get("ad_account_id"),
                "profilePictureUrl": row.get("profile_picture_url"),
                "pagePictureUrl": row.get("page_picture_url"),
                "source": row.get("source") or "manual",
            }
            for row in rows
        ]
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao carregar contas persistidas: %s", err)
        return []


app = Flask(__name__)
CORS(
    app,
    resources={r"/api/*": {"origins": _resolve_allowed_origins()}},
    supports_credentials=True,
)
LEGAL_DOCS_DIR = os.path.join(app.root_path, "static", "legal")

AUTH_SECRET_KEY = (
    os.getenv("AUTH_SECRET_KEY")
    or os.getenv("APP_SECRET_KEY")
    or os.getenv("META_APP_SECRET")
)
if not AUTH_SECRET_KEY:
    AUTH_SECRET_KEY = "change-me"
    logger.warning("AUTH_SECRET_KEY not set; using insecure fallback token secret.")

AUTH_SERIALIZER = URLSafeTimedSerializer(AUTH_SECRET_KEY, salt="dashboardsocial-auth")
AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "86400"))

FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID")
FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET")
FACEBOOK_GRAPH_VERSION = os.getenv("FACEBOOK_GRAPH_VERSION", "v19.0")
FACEBOOK_GRAPH_BASE = f"https://graph.facebook.com/{FACEBOOK_GRAPH_VERSION}"

PAGE_ID = os.getenv("META_PAGE_ID")
IG_ID = os.getenv("META_IG_USER_ID")
ACT_ID = os.getenv("META_AD_ACCOUNT_ID")

# Constantes
MAX_DAYS_RANGE = int(os.getenv("MAX_DAYS_RANGE", "365"))  # Limite máximo de dias para requests
MIN_TIMESTAMP = 946684800  # 1 Jan 2000
DEFAULT_DAYS = 7
INSTAGRAM_METRICS_ALLOW_PARTIAL = os.getenv("INSTAGRAM_METRICS_ALLOW_PARTIAL", "1") != "0"
INSTAGRAM_METRICS_PARTIAL_MIN_RATIO = float(os.getenv("INSTAGRAM_METRICS_PARTIAL_MIN_RATIO", "0") or "0")
INSTAGRAM_METRICS_PARTIAL_MIN_DAYS = int(os.getenv("INSTAGRAM_METRICS_PARTIAL_MIN_DAYS", "1") or "1")
INSTAGRAM_METRICS_AUTO_BACKFILL = os.getenv("INSTAGRAM_METRICS_AUTO_BACKFILL", "0") != "0"
DEFAULT_REFRESH_RESOURCES = [
    "facebook_metrics",
    "facebook_posts",
    "instagram_metrics",
    "instagram_organic",
    "instagram_audience",
    "instagram_posts",
    "ads_highlights",
]

IG_METRICS_TABLE = "metrics_daily"
IG_METRICS_ROLLUP_TABLE = "metrics_daily_rollup"
IG_METRICS_DAILY_TABLE = "ig_metrics_daily"
IG_METRICS_COVERAGE_TABLE = "ig_metrics_coverage"
IG_METRICS_PLATFORM = "instagram"
IG_ROLLUP_BUCKETS = ("7d", "30d", "90d")
DEFAULT_CACHE_PLATFORM = "instagram"
IG_COMMENTS_TABLE = "ig_comments"
IG_COMMENTS_DAILY_TABLE = "ig_comments_daily"
APP_USERS_TABLE = "app_users"
REPORT_TEMPLATES_TABLE = "report_templates"
REPORTS_TABLE = "reports"
SOCIAL_COVERS_TABLE = "social_covers"
ALLOWED_COVER_PLATFORMS = {"instagram", "facebook", "ads"}
COVER_MAX_BYTES = int(os.getenv("COVER_MAX_BYTES", str(2 * 1024 * 1024)))  # 2 MB default
DEFAULT_USER_ROLE = os.getenv("DEFAULT_USER_ROLE", "analista")
WORDCLOUD_DEFAULT_TOP = 120
WORDCLOUD_MAX_TOP = 250
WORDCLOUD_MAX_RANGE_DAYS = 365
COMMENTS_INGEST_DEFAULT_DAYS = 30
COMMENTS_SEARCH_MAX_LIMIT = 200
FB_WORDCLOUD_MAX_POSTS = int(os.getenv("FB_WORDCLOUD_MAX_POSTS", "120"))
FB_WORDCLOUD_MAX_COMMENTS = int(os.getenv("FB_WORDCLOUD_MAX_COMMENTS", "4000"))
FB_WORDCLOUD_POST_LIMIT = int(os.getenv("FB_WORDCLOUD_POST_LIMIT", "50"))
FB_WORDCLOUD_COMMENT_LIMIT = int(os.getenv("FB_WORDCLOUD_COMMENT_LIMIT", "50"))
WORDCLOUD_MIN_TOKEN_LEN = 3
WORDCLOUD_STOPWORDS = {
    "a", "as", "o", "os", "um", "uma", "uns", "umas",
    "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "para", "por", "pra", "pro", "com", "sem", "que", "quem", "qual", "quais",
    "como", "onde", "quando", "porque", "pois", "isso", "isto", "aquele", "aquela",
    "aqueles", "aquelas", "este", "esta", "estes", "estas", "esse", "essa", "esses", "essas",
    "ele", "ela", "eles", "elas", "eu", "tu", "voce", "voces", "nos", "nosso", "nossa", "nossos", "nossas",
    "seu", "sua", "seus", "suas", "meu", "minha", "meus", "minhas", "dele", "dela", "deles", "delas",
    "mais", "menos", "muito", "muita", "muitos", "muitas", "todo", "toda", "todos", "todas",
    "ja", "foi", "era", "sao", "sou", "estou", "esta", "estao", "tem", "ter", "ser",
    "vai", "vao", "vou", "fui", "sido", "havia", "haviam",
    "bem", "mal", "sim", "nao", "opa", "ola", "oi", "alguem", "ninguem",
    "se", "so", "ta", "vc", "vcs", "ces",
    "the", "and", "for", "with", "you", "your", "yours", "from", "this", "that", "was", "are", "were", "been", "have", "has",
    "to", "of", "in", "on", "at", "by", "or", "an", "is", "be", "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs",
    "https", "http", "www"
}
EMAIL_VALIDATION_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VALID_USER_ROLES = {"analista", "admin"}

_ensure_connected_accounts_table()
_ensure_meta_tokens_table()


def validate_timestamp(ts: int, param_name: str = "timestamp") -> int:
    """
    Valida se um timestamp Unix está em um range válido.

    Args:
        ts: Timestamp Unix em segundos
        param_name: Nome do parâmetro (para mensagem de erro)

    Returns:
        int: Timestamp validado

    Raises:
        ValueError: Se timestamp for inválido
    """
    now = int(time.time())

    if ts < MIN_TIMESTAMP:
        raise ValueError(f"{param_name} muito antigo (antes de 2000)")

    if ts > now:
        raise ValueError(f"{param_name} não pode estar no futuro")

    return ts


def unix_range(args, default_days=DEFAULT_DAYS):
    """
    Extrai e valida range de datas dos parâmetros da request.

    Args:
        args: Request args (request.args)
        default_days: Número de dias padrão se não especificado

    Returns:
        tuple: (since, until) em Unix timestamp

    Raises:
        ValueError: Se range for inválido
    """
    now = int(time.time())

    # Obter until (padrão: agora)
    until_param = args.get("until")
    if until_param:
        try:
            until = int(until_param)
            until = validate_timestamp(until, "until")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid until parameter: {until_param}, using now. Error: {e}")
            until = now
    else:
        until = now

    # Obter since
    since_param = args.get("since")
    if since_param:
        try:
            since = int(since_param)
            since = validate_timestamp(since, "since")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid since parameter: {since_param}, using default. Error: {e}")
            since = until - (default_days * 86_400)
    else:
        since = until - (default_days * 86_400)

    # Validar ordem
    if since >= until:
        logger.warning(f"since ({since}) >= until ({until}), adjusting")
        since = until - (default_days * 86_400)

    # Validar range máximo (90 dias)
    range_days = (until - since) / 86_400
    if range_days > MAX_DAYS_RANGE:
        logger.warning(f"Range too large ({range_days:.1f} days), limiting to {MAX_DAYS_RANGE} days")
        since = until - (MAX_DAYS_RANGE * 86_400)

    # Garantir que since não seja negativo
    if since < MIN_TIMESTAMP:
        since = MIN_TIMESTAMP

    logger.info(f"Date range: {datetime.fromtimestamp(since)} to {datetime.fromtimestamp(until)} ({range_days:.1f} days)")

    return since, until


# ================= API Envelope (v2) =================
ENVELOPE_CACHE_SOURCES = {"cache", "stale", "refresh", "prime", "live", "cache-fallback", "db"}
SYNC_SOURCE_CACHE = {"cache", "stale", "cache-fallback"}
SYNC_SOURCE_LIVE = {"refresh", "prime", "live"}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resolve_cache_timezone() -> timezone:
    tz_name = os.getenv("CACHE_WARM_TZ") or os.getenv("INSTAGRAM_INGEST_TZ") or "America/Sao_Paulo"
    try:
        return ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        return timezone.utc


def _should_force_daily_refresh(fetched_at: Optional[str], tz: timezone) -> bool:
    if not fetched_at:
        return False
    fetched_dt = _parse_iso_datetime(fetched_at)
    if not fetched_dt:
        return False
    try:
        fetched_local = fetched_dt.astimezone(tz).date()
    except Exception:  # noqa: BLE001
        fetched_local = fetched_dt.date()
    today_local = datetime.now(tz).date()
    return fetched_local < today_local


def _map_sync_source(cache_meta: Optional[Dict[str, Any]]) -> str:
    if isinstance(cache_meta, dict):
        raw_source = cache_meta.get("source")
        source = str(raw_source) if raw_source is not None else ""
        if source == "db":
            return "db"
        if source in SYNC_SOURCE_CACHE:
            return "cache"
        if source in SYNC_SOURCE_LIVE:
            return "meta_live"
    return "meta_live"


def _build_sync_meta(cache_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    fetched_at = None
    expires_at = None
    is_stale = False
    if isinstance(cache_meta, dict):
        fetched_at = cache_meta.get("fetched_at") or cache_meta.get("cached_at")
        expires_at = cache_meta.get("next_refresh_at") or cache_meta.get("expires_at")
        if cache_meta.get("stale") is not None:
            is_stale = bool(cache_meta.get("stale"))

    expires_dt = _parse_iso_datetime(expires_at)
    if expires_dt is not None:
        is_stale = datetime.now(timezone.utc) > expires_dt

    return {
        "fetched_at": str(fetched_at) if fetched_at is not None else None,
        "is_stale": bool(is_stale),
        "expires_at": str(expires_at) if expires_at is not None else None,
    }

def _normalize_envelope_cache(cache_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    now_iso = _utc_now_iso()
    if not isinstance(cache_meta, dict):
        return {
            "source": "live",
            "stale": False,
            "fetched_at": now_iso,
            "next_refresh_at": None,
            "cache_key": None,
        }

    source = cache_meta.get("source") or "live"
    source_str = str(source)
    if source_str not in ENVELOPE_CACHE_SOURCES:
        source_str = "live"

    fetched_at = cache_meta.get("fetched_at") or now_iso
    next_refresh_at = cache_meta.get("next_refresh_at")
    cache_key = cache_meta.get("cache_key")

    return {
        "source": source_str,
        "stale": bool(cache_meta.get("stale", False)),
        "fetched_at": str(fetched_at) if fetched_at is not None else None,
        "next_refresh_at": str(next_refresh_at) if next_refresh_at is not None else None,
        "cache_key": str(cache_key) if cache_key is not None else None,
    }


def _build_api_error(
    message: str,
    code: Optional[Any] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "message": message,
        "code": str(code) if code is not None else "unknown",
        "details": details or {},
    }


def _build_api_envelope(
    data: Any,
    *,
    platform: str,
    account_id: str,
    since: Optional[int],
    until: Optional[int],
    timezone_name: str = "UTC",
    cache_meta: Optional[Dict[str, Any]] = None,
    error: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "data": data,
        "meta": {
            "platform": platform,
            "account_id": account_id,
            "since": since,
            "until": until,
            "timezone": timezone_name,
            "source": _map_sync_source(cache_meta),
            "sync": _build_sync_meta(cache_meta),
            "cache": _normalize_envelope_cache(cache_meta),
        },
        "error": error,
    }


def _meta_api_error_details(err: MetaAPIError) -> Dict[str, Any]:
    return {
        "graph": {
            "status": err.status,
            "code": err.code,
            "type": err.error_type,
        }
    }


ADS_PERMISSION_ERROR_CODES = {10, 102, 190, 200}
ADS_RATE_LIMIT_ERROR_CODES = {4, 17, 32, 613}


def _ads_error_payload(code: str, message: Optional[str] = None) -> Dict[str, Any]:
    payload = {"code": code}
    if message:
        payload["message"] = message
    return payload


def _ads_meta_payload(cache_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    now_iso = _utc_now_iso()
    if not isinstance(cache_meta, dict):
        return {
            "status": "live",
            "fetched_at": None,
            "source": "meta_live",
            "sync": _build_sync_meta(cache_meta),
        }
    status = str(cache_meta.get("source") or "live")
    fetched_at = cache_meta.get("fetched_at") or now_iso
    return {
        "status": status,
        "fetched_at": str(fetched_at) if fetched_at is not None else None,
        "source": _map_sync_source(cache_meta),
        "sync": _build_sync_meta(cache_meta),
    }


def _ads_envelope(
    data: Any,
    *,
    cache_meta: Optional[Dict[str, Any]] = None,
    error: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "data": data,
        "error": error,
        "meta": _ads_meta_payload(cache_meta),
    }


def _ads_error_code_from_meta(err: MetaAPIError) -> str:
    code = None
    try:
        if err.code is not None:
            code = int(err.code)
    except (TypeError, ValueError):
        code = None
    if err.status in (401, 403):
        return "PERMISSION_DENIED"
    if err.status == 429:
        return "RATE_LIMIT"
    if err.status >= 500:
        return "INTEGRATION_ERROR"
    if code in ADS_PERMISSION_ERROR_CODES:
        return "PERMISSION_DENIED"
    if code in ADS_RATE_LIMIT_ERROR_CODES:
        return "RATE_LIMIT"
    if err.error_type in ("timeout", "request_exception"):
        return "INTEGRATION_ERROR"
    return "INTEGRATION_ERROR"


def _ads_payload_has_data(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    totals = payload.get("totals") or {}
    for key in ("spend", "impressions", "reach", "clicks"):
        try:
            if float(totals.get(key) or 0) > 0:
                return True
        except (TypeError, ValueError):
            continue
    for list_key in (
        "campaigns",
        "spend_series",
        "creatives",
        "actions",
        "video_ads",
        "spend_by_region",
        "spend_by_city",
    ):
        value = payload.get(list_key)
        if isinstance(value, list) and value:
            return True
    demographics = payload.get("demographics") or {}
    for demo_key in ("byGender", "byAge", "byAgeGender", "topSegments"):
        value = demographics.get(demo_key)
        if isinstance(value, list) and value:
            return True
    return False


def _duration(since_ts: int, until_ts: int) -> int:
    return max(1, until_ts - since_ts)


def strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def sanitize_wordcloud_token(token: str) -> Optional[str]:
    if not token:
        return None
    candidate = str(token).strip().lower()
    if not candidate:
        return None
    cleaned = "".join(ch for ch in candidate if ch.isalpha())
    if len(cleaned) < WORDCLOUD_MIN_TOKEN_LEN:
        return None
    base = strip_accents(cleaned)
    if cleaned in WORDCLOUD_STOPWORDS or base in WORDCLOUD_STOPWORDS:
        return None
    return cleaned


def tokenize_wordcloud_text(text: str) -> List[str]:
    if not text:
        return []
    lowered = text.lower()
    lowered = re.sub(r"https?://\S+|www\.\S+", " ", lowered)
    lowered = lowered.replace("&amp;", " ")
    lowered = re.sub(r"\s+", " ", lowered)
    tokens = lowered.split()
    words: List[str] = []
    for token in tokens:
        if not token:
            continue
        if token.startswith("@"):
            continue
        if token.startswith("#"):
            token = token[1:]
        sanitized = sanitize_wordcloud_token(token)
        if sanitized:
            words.append(sanitized)
    return words


def _parse_graph_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    candidate = str(value).replace("Z", "+00:00")
    if len(candidate) > 5 and candidate[-5] in {"+", "-"} and ":" not in candidate[-5:]:
        candidate = f"{candidate[:-2]}:{candidate[-2:]}"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def fetch_facebook_comments_for_wordcloud(
    page_id: str,
    since_dt: datetime,
    until_dt: datetime,
) -> Dict[str, Any]:
    token = get_page_access_token(page_id)
    since_ts = int(since_dt.timestamp())
    until_ts = int(until_dt.timestamp())
    comments: List[Dict[str, Any]] = []
    posts_scanned = 0
    comments_scanned = 0
    truncated = False
    after: Optional[str] = None

    while True:
        params = {
            "limit": FB_WORDCLOUD_POST_LIMIT,
            "fields": (
                "id,created_time,"
                f"comments.limit({FB_WORDCLOUD_COMMENT_LIMIT}){{id,message,created_time,from,like_count}}"
            ),
            "since": since_ts,
            "until": until_ts,
        }
        if after:
            params["after"] = after

        payload = gget(f"/{page_id}/posts", params=params, token=token)
        data = payload.get("data") or []
        if not isinstance(data, list) or not data:
            break

        for post in data:
            posts_scanned += 1
            comments_edge = (post.get("comments") or {}).get("data") or []
            for comment in comments_edge:
                created_at = _parse_graph_timestamp(comment.get("created_time"))
                if created_at and (created_at < since_dt or created_at > until_dt):
                    continue
                text = str(comment.get("message") or "").strip()
                if not text:
                    continue
                comments.append({
                    "id": comment.get("id"),
                    "text": text,
                    "timestamp": created_at.isoformat() if created_at else None,
                    "username": ((comment.get("from") or {}).get("name") or ""),
                    "like_count": int(comment.get("like_count") or 0),
                })
                comments_scanned += 1
                if comments_scanned >= FB_WORDCLOUD_MAX_COMMENTS:
                    truncated = True
                    break

            if comments_scanned >= FB_WORDCLOUD_MAX_COMMENTS or posts_scanned >= FB_WORDCLOUD_MAX_POSTS:
                if posts_scanned >= FB_WORDCLOUD_MAX_POSTS:
                    truncated = True
                break

        if comments_scanned >= FB_WORDCLOUD_MAX_COMMENTS or posts_scanned >= FB_WORDCLOUD_MAX_POSTS:
            break

        paging = payload.get("paging") or {}
        cursors = paging.get("cursors") or {}
        after = cursors.get("after")
        if not after:
            break

    return {
        "comments": comments,
        "meta": {
            "posts_scanned": posts_scanned,
            "comments_scanned": comments_scanned,
            "truncated": truncated,
        },
    }


def fetch_comments_for_wordcloud(
    client,
    account_id: str,
    since_iso: Optional[str],
    until_iso: Optional[str],
) -> List[Dict[str, Any]]:
    page_size = 1000
    offset = 0
    rows: List[Dict[str, Any]] = []
    while True:
        query = (
            client.table(IG_COMMENTS_TABLE)
            .select("id,text,timestamp,created_at,username,like_count")
            .eq("account_id", account_id)
        )
        if since_iso:
            query = query.gte("timestamp", since_iso).gte("created_at", since_iso)
        if until_iso:
            query = query.lte("timestamp", until_iso).lte("created_at", until_iso)
        response = (
            query.order("timestamp", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        data = getattr(response, "data", None) or []
        if not data:
            break
        rows.extend(data)
        if len(data) < page_size:
            break
        offset += page_size
    return rows


def fetch_daily_wordcloud(
    client,
    account_id: str,
    since_iso: Optional[str],
    until_iso: Optional[str],
) -> Dict[str, Any]:
    """
    Lê agregados diários de comentários e word_freq da tabela ig_comments_daily.
    """
    query = client.table(IG_COMMENTS_DAILY_TABLE).select("comment_date,total_comments,word_freq").eq("account_id", account_id)
    if since_iso:
        query = query.gte("comment_date", since_iso.split("T")[0])
    if until_iso:
        query = query.lte("comment_date", until_iso.split("T")[0])
    response = query.order("comment_date", desc=False).execute()
    if response.error:
        raise RuntimeError(response.error.get("message") or "failed to load ig_comments_daily")
    rows = response.data or []

    counter: Counter[str] = Counter()
    total_comments = 0
    for row in rows:
        total_comments += int(row.get("total_comments") or 0)
        freq_payload = row.get("word_freq")
        if not freq_payload:
            continue
        if isinstance(freq_payload, str):
            try:
                freq_payload = json.loads(freq_payload)
            except Exception:
                freq_payload = {}
        if isinstance(freq_payload, dict):
            for word, value in freq_payload.items():
                try:
                    sanitized = sanitize_wordcloud_token(word)
                    if not sanitized:
                        continue
                    counter[sanitized] += int(value or 0)
                except Exception:
                    continue

    return {"words": counter, "total_comments": total_comments}


def fetch_facebook_metrics(
    page_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    _extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if since_ts is None or until_ts is None:
        raise ValueError("since_ts e until_ts são obrigatórios para facebook_metrics")

    lite = bool(_extra and _extra.get("lite"))
    include_post_insights = False if lite else None
    cur = fb_page_window(page_id, since_ts, until_ts, include_post_insights=include_post_insights)
    prev = fb_page_window(
        page_id,
        since_ts - _duration(since_ts, until_ts),
        since_ts,
        include_post_insights=include_post_insights,
    )

    def pct(current, previous):
        return round(((current - previous) / previous) * 100, 2) if previous and previous > 0 and current is not None else None

    engagement_cur = cur.get("engagement") or {}
    engagement_prev = prev.get("engagement") or {}
    video_cur = cur.get("video") or {}
    video_prev = prev.get("video") or {}
    video_engagement_cur = (video_cur.get("engagement") or {}) if isinstance(video_cur, dict) else {}
    video_engagement_prev = (video_prev.get("engagement") or {}) if isinstance(video_prev, dict) else {}
    video_engagement_cur_total = video_engagement_cur.get("total")
    video_engagement_prev_total = video_engagement_prev.get("total")
    page_overview_cur = cur.get("page_overview") or {}
    page_overview_prev = prev.get("page_overview") or {}
    page_interactions_follow_type_cur = cur.get("page_interactions_by_follow_type") or {}

    metrics = [
        {
            "key": "reach",
            "label": "Alcance organico",
            "value": cur.get("reach"),
            "deltaPct": pct(cur.get("reach"), prev.get("reach")),
        },
        {
            "key": "post_engagement_total",
            "label": "Engajamento post",
            "value": engagement_cur.get("total"),
            "deltaPct": pct(engagement_cur.get("total"), engagement_prev.get("total")),
            "breakdown": {
                "reactions": engagement_cur.get("reactions"),
                "comments": engagement_cur.get("comments"),
                "shares": engagement_cur.get("shares"),
            },
        },
        {
            "key": "engaged_users",
            "label": "Usuarios engajados",
            "value": cur.get("post_engaged"),
            "deltaPct": pct(cur.get("post_engaged"), prev.get("post_engaged")),
        },
        {
            "key": "page_views",
            "label": "Visualizacoes da pagina",
            "value": page_overview_cur.get("page_views"),
            "deltaPct": pct(page_overview_cur.get("page_views"), page_overview_prev.get("page_views")),
        },
        {
            "key": "content_activity",
            "label": "Interacoes totais",
            "value": page_overview_cur.get("content_activity"),
            "deltaPct": pct(page_overview_cur.get("content_activity"), page_overview_prev.get("content_activity")),
        },
        {
            "key": "cta_clicks",
            "label": "Cliques em CTA",
            "value": page_overview_cur.get("cta_clicks"),
            "deltaPct": pct(page_overview_cur.get("cta_clicks"), page_overview_prev.get("cta_clicks")),
        },
        {
            "key": "post_clicks",
            "label": "Cliques em posts",
            "value": cur.get("post_clicks"),
            "deltaPct": pct(cur.get("post_clicks"), prev.get("post_clicks")),
        },
        {
            "key": "followers_total",
            "label": "Seguidores da pagina",
            "value": page_overview_cur.get("followers_total"),
            "deltaPct": pct(page_overview_cur.get("followers_total"), page_overview_prev.get("followers_total")),
        },
        {
            "key": "followers_gained",
            "label": "Novos seguidores",
            "value": page_overview_cur.get("followers_gained"),
            "deltaPct": pct(page_overview_cur.get("followers_gained"), page_overview_prev.get("followers_gained")),
        },
        {
            "key": "followers_lost",
            "label": "Deixaram de seguir",
            "value": page_overview_cur.get("followers_lost"),
            "deltaPct": pct(page_overview_cur.get("followers_lost"), page_overview_prev.get("followers_lost")),
        },
        {
            "key": "net_followers",
            "label": "Crescimento liquido",
            "value": page_overview_cur.get("net_followers"),
            "deltaPct": pct(page_overview_cur.get("net_followers"), page_overview_prev.get("net_followers")),
        },
        {
            "key": "video_views_total",
            "label": "Video views",
            "value": page_overview_cur.get("video_views"),
            "deltaPct": pct(page_overview_cur.get("video_views"), page_overview_prev.get("video_views")),
        },
        {
            "key": "video_engagement_total",
            "label": "Videos (reacoes, comentarios, compartilhamentos)",
            "value": video_engagement_cur_total,
            "deltaPct": pct(video_engagement_cur_total, video_engagement_prev_total),
            "breakdown": {
                "reactions": video_engagement_cur.get("reactions"),
                "comments": video_engagement_cur.get("comments"),
                "shares": video_engagement_cur.get("shares"),
            },
        },
        {
            "key": "video_watch_time_total",
            "label": "Tempo total assistido",
            "value": video_cur.get("watch_time_total"),
            "deltaPct": pct(video_cur.get("watch_time_total"), video_prev.get("watch_time_total")),
        },
    ]

    breakdowns = {
        "engagement": {
            "reactions": engagement_cur.get("reactions"),
            "comments": engagement_cur.get("comments"),
            "shares": engagement_cur.get("shares"),
        },
        "page_interactions_follow_type": page_interactions_follow_type_cur,
        "video": {
            "watch_time_total": video_cur.get("watch_time_total"),
            "engagement": video_engagement_cur,
            "views": page_overview_cur.get("video_views"),
        },
    }

    page_overview = page_overview_cur
    net_followers_series = cur.get("net_followers_series") or []
    engagement_timeseries = cur.get("engagement_timeseries") or []

    return {
        "since": since_ts,
        "until": until_ts,
        "metrics": metrics,
        "breakdowns": breakdowns,
        "page_overview": page_overview,
        "net_followers_series": net_followers_series,
        "engagement_timeseries": engagement_timeseries,
        "page_interactions_by_follow_type": page_interactions_follow_type_cur,
        "post_engaged": cur.get("post_engaged"),
    }


def _enrich_facebook_metrics_payload(payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        return

    metrics: List[Dict[str, Any]] = payload.setdefault("metrics", [])
    metrics_by_key = {}
    for item in metrics:
        if isinstance(item, dict) and item.get("key"):
            metrics_by_key[item["key"]] = item

    page_overview = payload.get("page_overview") or {}
    video_data = payload.get("video") or {}
    breakdowns = payload.get("breakdowns") or {}
    interactions_follow_type = payload.get("page_interactions_by_follow_type")
    if not interactions_follow_type and isinstance(page_overview, dict):
        interactions_follow_type = page_overview.get("page_interactions_by_follow_type")
    video_breakdown = {}
    if isinstance(video_data, dict):
        video_breakdown = video_data.get("engagement") or {}
    if not video_breakdown and isinstance(breakdowns, dict):
        video_breakdown = (breakdowns.get("video") or {}).get("engagement") or {}

    if interactions_follow_type and isinstance(breakdowns, dict):
        breakdowns["page_interactions_follow_type"] = interactions_follow_type
        payload["breakdowns"] = breakdowns

    def ensure_metric(key: str, label: str, value: Optional[Any], breakdown: Optional[Dict[str, Any]] = None) -> None:
        if value in (None, "", []):
            return
        metric = metrics_by_key.get(key)
        if metric:
            if metric.get("value") in (None, "", "-"):
                metric["value"] = value
            if breakdown and not metric.get("breakdown"):
                metric["breakdown"] = breakdown
        else:
            entry = {
                "key": key,
                "label": label,
                "value": value,
                "deltaPct": None,
            }
            if breakdown:
                entry["breakdown"] = breakdown
            metrics.append(entry)
            metrics_by_key[key] = entry

    ensure_metric("video_views_total", "Video views", page_overview.get("video_views"))
    ensure_metric("engaged_users", "Usuarios engajados", payload.get("post_engaged"))
    ensure_metric(
        "video_engagement_total",
        "Videos (reacoes, comentarios, compartilhamentos)",
        (video_breakdown or {}).get("total"),
        {
            "reactions": (video_breakdown or {}).get("reactions"),
            "comments": (video_breakdown or {}).get("comments"),
            "shares": (video_breakdown or {}).get("shares"),
        },
    )
    ensure_metric("followers_total", "Seguidores da pagina", page_overview.get("followers_total"))
    ensure_metric("video_views_3s", "Video views (3s)", page_overview.get("video_views_3s"))
    ensure_metric(
        "video_views_10s",
        "Video views (10s)",
        page_overview.get("video_views_10s") or (video_data or {}).get("views_10s"),
    )
    ensure_metric(
        "video_views_30s",
        "Video views (30s)",
        page_overview.get("video_views_30s") or (video_data or {}).get("views_30s"),
    )
    ensure_metric(
        "video_avg_watch_time",
        "Tempo medio de visualizacao (s)",
        page_overview.get("avg_watch_time") or (video_data or {}).get("avg_watch_time"),
    )


def fetch_facebook_posts(
    page_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    limit = None
    if extra and "limit" in extra:
        try:
            limit = int(extra["limit"])
        except (TypeError, ValueError):
            limit = None
    limit = limit or 6
    return fb_recent_posts(page_id, limit, since_ts=since_ts, until_ts=until_ts)


def fetch_facebook_audience(
    page_id: str,
    _since_ts: Optional[int],
    _until_ts: Optional[int],
    _extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Fetcher para dados demográficos do Facebook"""
    return fb_audience(page_id)


def fetch_instagram_metrics(
    ig_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    _extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if since_ts is None or until_ts is None:
        raise ValueError("since_ts e until_ts são obrigatórios para instagram_metrics")

    cur = ig_window(ig_id, since_ts, until_ts)
    prev = ig_window(ig_id, since_ts - _duration(since_ts, until_ts), since_ts)

    def pct(current, previous):
        return round(((current - previous) / previous) * 100, 2) if previous and previous > 0 and current is not None else None

    engagement_rate_from_posts = None
    engagement_breakdown = {
        "likes": 0,
        "comments": 0,
        "shares": 0,
        "saves": 0,
        "total": 0,
        "reach": 0,
    }

    posts_details = cur.get("posts_detailed") or []
    posts_in_period = _extract_posts_in_period(posts_details, since_ts, until_ts)

    if posts_in_period:
        total_interactions = 0
        total_reach = 0
        for post in posts_in_period:
            likes = int(post.get("likes") or post.get("like_count") or 0)
            comments = int(post.get("comments") or post.get("comments_count") or 0)
            shares = int(post.get("shares") or 0)
            saves = int(post.get("saves") or 0)
            total_post_interactions = likes + comments + shares + saves
            total_interactions += total_post_interactions
            reach_value = int(post.get("reach") or 0)
            total_reach += reach_value

            engagement_breakdown["likes"] += likes
            engagement_breakdown["comments"] += comments
            engagement_breakdown["shares"] += shares
            engagement_breakdown["saves"] += saves
            engagement_breakdown["total"] += total_post_interactions
            engagement_breakdown["reach"] += reach_value

        if total_reach > 0:
            engagement_rate_from_posts = round((total_interactions / total_reach) * 100, 2)

    cur_profile = cur.get("profile") or {}
    prev_profile = prev.get("profile") or {}
    cur_posts = cur.get("posts") or {}
    prev_posts = prev.get("posts") or {}

    if engagement_rate_from_posts is None:
        engagement_rate_from_posts = round((cur["interactions"] / cur["reach"]) * 100, 2) if cur["reach"] else None
        engagement_breakdown = {
            "likes": cur.get("likes", 0),
            "comments": cur.get("comments", 0),
            "shares": cur.get("shares", 0),
            "saves": cur.get("saves", 0),
            "total": cur.get("interactions", 0),
            "reach": cur.get("reach", 0),
        }

    if (cur.get("reach") or 0) <= 0 and engagement_breakdown["reach"] > 0:
        cur["reach"] = engagement_breakdown["reach"]

    if (cur.get("interactions") or 0) <= 0 and engagement_breakdown["total"] > 0:
        cur["interactions"] = engagement_breakdown["total"]

    reach_series_raw = cur.get("reach_timeseries") or []
    reach_timeseries: List[Dict[str, Any]] = []
    for entry in reach_series_raw:
        value = entry.get("value")
        if value is None:
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(numeric_value):
            continue
        end_time = entry.get("end_time")
        start_time = entry.get("start_time")
        raw_ts = end_time or start_time
        normalized_date = None
        if raw_ts:
            normalized_input = raw_ts.replace("Z", "+00:00")
            try:
                normalized_date = datetime.fromisoformat(normalized_input).date().isoformat()
            except ValueError:
                try:
                    normalized_date = datetime.strptime(raw_ts, "%Y-%m-%dT%H:%M:%S%z").date().isoformat()
                except ValueError:
                    normalized_date = raw_ts[:10]
        if normalized_date is None and raw_ts is None:
            continue
        reach_timeseries.append(
            {
                "date": normalized_date or raw_ts,
                "end_time": end_time,
                "start_time": start_time,
                "value": int(round(numeric_value)),
            }
        )

    profile_views_series_raw = cur.get("profile_views_timeseries") or []
    profile_views_timeseries: List[Dict[str, Any]] = []
    for entry in profile_views_series_raw:
        value = entry.get("value")
        if value is None:
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(numeric_value):
            continue
        end_time = entry.get("end_time")
        start_time = entry.get("start_time")
        raw_ts = end_time or start_time or entry.get("date")
        normalized_date = None
        if raw_ts:
            normalized_input = str(raw_ts).replace("Z", "+00:00")
            try:
                normalized_date = datetime.fromisoformat(normalized_input).date().isoformat()
            except ValueError:
                try:
                    normalized_date = datetime.strptime(str(raw_ts), "%Y-%m-%dT%H:%M:%S%z").date().isoformat()
                except ValueError:
                    normalized_date = str(raw_ts)[:10]
        if normalized_date is None and raw_ts is None:
            continue
        profile_views_timeseries.append(
            {
                "date": normalized_date or raw_ts,
                "end_time": end_time,
                "start_time": start_time,
                "value": int(round(numeric_value)),
            }
        )

    video_views_series_raw = cur.get("video_views_timeseries") or []
    video_views_timeseries: List[Dict[str, Any]] = []
    for entry in video_views_series_raw:
        value = entry.get("value")
        if value is None:
            continue
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(numeric_value):
            continue
        end_time = entry.get("end_time")
        start_time = entry.get("start_time")
        raw_ts = end_time or start_time or entry.get("date")
        normalized_date = None
        if raw_ts:
            normalized_input = str(raw_ts).replace("Z", "+00:00")
            try:
                normalized_date = datetime.fromisoformat(normalized_input).date().isoformat()
            except ValueError:
                try:
                    normalized_date = datetime.strptime(str(raw_ts), "%Y-%m-%dT%H:%M:%S%z").date().isoformat()
                except ValueError:
                    normalized_date = str(raw_ts)[:10]
        if normalized_date is None and raw_ts is None:
            continue
        video_views_timeseries.append(
            {
                "date": normalized_date or raw_ts,
                "end_time": end_time,
                "start_time": start_time,
                "value": int(round(numeric_value)),
            }
        )

    metrics = [
        {"key": "followers_total", "label": "SEGUIDORES", "value": cur.get("follower_count_end"), "deltaPct": pct(cur.get("follower_count_end"), prev.get("follower_count_end"))},
        {
            "key": "reach",
            "label": "ALCANCE",
            "value": cur["reach"],
            "deltaPct": pct(cur["reach"], prev["reach"]),
            "timeseries": reach_timeseries,
        },
        {
            "key": "video_views",
            "label": "VISUALIZACOES",
            "value": cur.get("video_views"),
            "deltaPct": pct(cur.get("video_views"), prev.get("video_views")),
            "timeseries": video_views_timeseries or profile_views_timeseries,
        },
        {
            "key": "video_avg_watch_time",
            "label": "TEMPO MEDIO ASSISTIDO (s)",
            "value": cur.get("avg_watch_time"),
            "deltaPct": None,
        },
        {
            "key": "profile_views",
            "label": "VISITAS AO PERFIL",
            "value": cur.get("profile_views"),
            "deltaPct": pct(cur.get("profile_views"), prev.get("profile_views")),
            "timeseries": profile_views_timeseries,
        },
        {"key": "interactions", "label": "INTERACOES", "value": cur["interactions"], "deltaPct": pct(cur["interactions"], prev["interactions"])},
        {"key": "likes", "label": "CURTIDAS", "value": cur.get("likes"), "deltaPct": pct(cur.get("likes"), prev.get("likes")) if prev.get("likes") else None},
        {"key": "saves", "label": "SALVAMENTOS", "value": cur.get("saves"), "deltaPct": pct(cur.get("saves"), prev.get("saves")) if prev.get("saves") else None},
        {"key": "shares", "label": "COMPARTILHAMENTOS", "value": cur.get("shares"), "deltaPct": pct(cur.get("shares"), prev.get("shares")) if prev.get("shares") else None},
        {"key": "comments", "label": "COMENTARIOS", "value": cur.get("comments"), "deltaPct": pct(cur.get("comments"), prev.get("comments")) if prev.get("comments") else None},
        {
            "key": "engagement_rate",
            "label": "TAXA ENGAJAMENTO",
            "value": engagement_rate_from_posts,
            "deltaPct": None,
            "breakdown": engagement_breakdown,
        },
        {
            "key": "follower_growth",
            "label": "CRESCIMENTO DE SEGUIDORES",
            "value": cur.get("follower_growth"),
            "deltaPct": None,
        },
    ]
    follower_counts = {
        "start": cur.get("follower_count_start"),
        "end": cur.get("follower_count_end"),
        "follows": cur.get("follows"),
        "unfollows": cur.get("unfollows"),
    }

    followers_gain_series = _load_followers_gain_series_from_db(
        ig_id,
        _unix_to_date(since_ts),
        _unix_to_date(until_ts),
    )
    if not followers_gain_series:
        raw_gain_series = cur.get("followers_gain_series") or []
        if raw_gain_series:
            normalized_gain_series: List[Dict[str, Any]] = []
            for entry in raw_gain_series:
                metric_date = _isoformat_metric_date(
                    entry.get("date") or entry.get("end_time") or entry.get("start_time")
                )
                metric_value = _to_float(entry.get("value"))
                if metric_date is None or metric_value is None:
                    continue
                normalized_gain_series.append(
                    {
                        "date": metric_date,
                        "value": int(round(max(0.0, metric_value))),
                    }
                )
            normalized_gain_series.sort(key=lambda item: item["date"])
            followers_gain_series = normalized_gain_series
    if not followers_gain_series:
        follower_series_raw = cur.get("follower_series") or []
        if follower_series_raw:
            normalized_series: List[Dict[str, Any]] = []
            for entry in follower_series_raw:
                raw_date = entry.get("date") or entry.get("end_time") or entry.get("start_time")
                metric_date = _normalize_metric_date(raw_date)
                metric_value = _to_float(entry.get("value"))
                if metric_date is None or metric_value is None:
                    continue
                normalized_series.append({"metric_date": metric_date, "value": metric_value})
            normalized_series.sort(key=lambda item: item["metric_date"])
            previous_value = None
            for entry in normalized_series:
                gain_value = 0
                if previous_value is not None:
                    diff = entry["value"] - previous_value
                    if diff > 0 and math.isfinite(diff):
                        gain_value = diff
                previous_value = entry["value"]
                followers_gain_series.append(
                    {
                        "date": entry["metric_date"].isoformat(),
                        "value": int(round(gain_value)),
                    }
                )

    follows_total = _to_float(cur.get("follows"))
    previous_follows_total = _to_float(prev.get("follows")) if isinstance(prev, dict) else None
    followers_gained_total = None
    if follows_total is not None:
        followers_gained_total = follows_total
    elif followers_gain_series:
        total = 0.0
        has_value = False
        for entry in followers_gain_series:
            metric_value = _to_float(entry.get("value"))
            if metric_value is None:
                continue
            has_value = True
            total += max(0.0, metric_value)
        if has_value:
            followers_gained_total = total
    if followers_gained_total is None:
        follower_growth_value = _to_float(cur.get("follower_growth"))
        if follower_growth_value is not None and follower_growth_value >= 0:
            followers_gained_total = follower_growth_value

    if followers_gained_total is not None:
        followers_gained_total = int(round(followers_gained_total))

    metrics.append(
        {
            "key": "followers_gained",
            "label": "SEGUIDORES GANHOS",
            "value": followers_gained_total,
            "deltaPct": pct(follows_total, previous_follows_total)
            if follows_total is not None and previous_follows_total not in (None, 0)
            else None,
        }
    )

    top_posts = _build_top_posts_payload(posts_in_period)

    return {
        "since": since_ts,
        "until": until_ts,
        "metrics": metrics,
        "profile_visitors_breakdown": cur.get("profile_visitors_breakdown"),
        "follower_counts": follower_counts,
        "follower_series": cur.get("follower_series") or [],
        "followers_gain_series": followers_gain_series,
        "followers_gained_total": followers_gained_total,
        "top_posts": top_posts,
        "reach_timeseries": reach_timeseries,
        "profile_views_timeseries": profile_views_timeseries,
        "video_views_timeseries": video_views_timeseries or profile_views_timeseries,
    }


def fetch_instagram_organic(
    ig_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    _extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if since_ts is None or until_ts is None:
        raise ValueError("since_ts e until_ts sǭo obrigatórios para instagram_organic")
    data = ig_organic_summary(ig_id, since_ts, until_ts)
    data.update({"since": since_ts, "until": until_ts})
    return data


def fetch_instagram_audience(
    ig_id: str,
    _since_ts: Optional[int],
    _until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    timeframe = normalize_ig_audience_timeframe(extra.get("timeframe") if extra else None)
    since_ts = _since_ts
    until_ts = _until_ts

    use_snapshot = False
    if since_ts is not None and until_ts is not None:
        diff_days = int((until_ts - since_ts) / 86_400) + 1
        if diff_days > 7:
            use_snapshot = True

    if use_snapshot:
        target_date = resolve_snapshot_date(until_ts) if until_ts is not None else None
        snapshot = load_latest_snapshot(ig_id, "this_month", target_date=target_date)
        if snapshot:
            payload, snapshot_date = snapshot
            payload = dict(payload)
            payload.setdefault("snapshot_date", snapshot_date.isoformat())
            payload.setdefault("snapshot_timeframe", "this_month")
            return payload

    payload = ig_audience(ig_id, timeframe=timeframe)
    if isinstance(payload, dict):
        persist_audience_snapshot(ig_id, timeframe, payload)
    return payload


def fetch_instagram_posts(
    ig_id: str,
    _since_ts: Optional[int],
    _until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    limit = None
    if extra and "limit" in extra:
        try:
            limit = int(extra["limit"])
        except (TypeError, ValueError):
            limit = None
    limit = limit or 6
    return ig_recent_posts(ig_id, limit)


def fetch_instagram_posts_insights(
    ig_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if since_ts is None or until_ts is None:
        raise ValueError("since_ts e until_ts sao obrigatorios para instagram_posts_insights")
    limit = None
    if extra and "limit" in extra:
        try:
            limit = int(extra["limit"])
        except (TypeError, ValueError):
            limit = None
    limit = limit or 5
    return ig_recent_posts_insights(ig_id, limit=limit, since_ts=since_ts, until_ts=until_ts)


def _extract_posts_in_period(
    posts_details: Sequence[Dict[str, Any]],
    since_ts: int,
    until_ts: int,
) -> List[Dict[str, Any]]:
    posts_in_period: List[Dict[str, Any]] = []
    for post in posts_details:
        timestamp_unix = post.get("timestamp_unix")
        if timestamp_unix is None:
            timestamp_iso = post.get("timestamp")
            if timestamp_iso:
                try:
                    timestamp_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
                    timestamp_unix = int(timestamp_dt.timestamp())
                except ValueError:
                    timestamp_unix = None
        if timestamp_unix is not None and since_ts <= timestamp_unix <= until_ts:
            posts_in_period.append(post)
    return posts_in_period


def _serialize_top_post(post: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": post.get("id"),
        "timestamp": post.get("timestamp"),
        "permalink": post.get("permalink"),
        "mediaType": post.get("media_type"),
        "previewUrl": post.get("preview_url"),
        "reach": int(post.get("reach") or 0),
        "likes": int(post.get("likes") or post.get("like_count") or 0),
        "comments": int(post.get("comments") or post.get("comments_count") or 0),
        "shares": int(post.get("shares") or 0),
        "saves": int(post.get("saves") or 0),
        "interactions": int(post.get("interactions") or 0),
    }


def _build_top_posts_payload(posts_in_period: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    top_posts: Dict[str, List[Dict[str, Any]]] = {"reach": [], "engagement": [], "saves": []}
    if not posts_in_period:
        return top_posts

    sorted_by_reach = sorted(posts_in_period, key=lambda p: int(p.get("reach") or 0), reverse=True)
    sorted_by_engagement = sorted(posts_in_period, key=lambda p: int(p.get("interactions") or 0), reverse=True)
    sorted_by_saves = sorted(posts_in_period, key=lambda p: int(p.get("saves") or 0), reverse=True)

    top_posts["reach"] = [_serialize_top_post(post) for post in sorted_by_reach[:3]]
    top_posts["engagement"] = [_serialize_top_post(post) for post in sorted_by_engagement[:3]]
    top_posts["saves"] = [_serialize_top_post(post) for post in sorted_by_saves[:3]]
    return top_posts


def _fetch_top_posts_live(ig_id: str, since_ts: int, until_ts: int) -> Dict[str, List[Dict[str, Any]]]:
    try:
        snapshot = ig_window(ig_id, since_ts, until_ts)
    except MetaAPIError as err:
        logger.warning("Falha ao buscar posts da API para %s: %s", ig_id, err)
        return {"reach": [], "engagement": [], "saves": []}
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro inesperado ao buscar posts para %s", ig_id, exc_info=err)
        return {"reach": [], "engagement": [], "saves": []}
    posts_details = snapshot.get("posts_detailed") or []
    posts_in_period = _extract_posts_in_period(posts_details, since_ts, until_ts)
    return _build_top_posts_payload(posts_in_period)


def _ts_to_iso_date(ts: Optional[int]) -> Optional[str]:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def _iso_to_ts(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(dt.timestamp())


def _safe_int(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _unix_to_date(value: int) -> date:
    return datetime.fromtimestamp(value, tz=timezone.utc).date()


def _issue_auth_token(user_id: str) -> str:
    return AUTH_SERIALIZER.dumps({"sub": user_id})


def _decode_auth_token(token: str) -> Optional[str]:
    try:
        data = AUTH_SERIALIZER.loads(token, max_age=AUTH_TOKEN_TTL_SECONDS)
        return data.get("sub")
    except (BadSignature, SignatureExpired):
        return None


def _facebook_api_url(path: str) -> str:
    normalized = path if path.startswith("/") else f"/{path}"
    return f"{FACEBOOK_GRAPH_BASE}{normalized}"


def _parse_facebook_response(response) -> Dict[str, Any]:
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return {}


def _validate_facebook_access_token(access_token: str) -> Dict[str, Any]:
    if not access_token:
        raise ValueError("facebook access_token é obrigatório")
    if not FACEBOOK_APP_ID or not FACEBOOK_APP_SECRET:
        raise ValueError("FACEBOOK_APP_ID e FACEBOOK_APP_SECRET não configurados")

    app_token = f"{FACEBOOK_APP_ID}|{FACEBOOK_APP_SECRET}"
    try:
        debug_response = requests.get(
            _facebook_api_url("/debug_token"),
            params={"input_token": access_token, "access_token": app_token},
            timeout=10,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro ao chamar debug_token no Facebook")
        raise ValueError("Falha ao validar token com o Facebook") from err

    debug_body = _parse_facebook_response(debug_response)
    debug_data = debug_body.get("data") or {}
    if not debug_response.ok or not debug_data.get("is_valid"):
        error_message = None
        error_field = debug_data.get("error")
        if isinstance(error_field, dict):
            error_message = error_field.get("message")
        raise ValueError(error_message or "Token do Facebook inválido.")

    if str(debug_data.get("app_id")) != str(FACEBOOK_APP_ID):
        raise ValueError("Token do Facebook não pertence a este aplicativo.")

    expires_at = debug_data.get("expires_at")
    if expires_at and int(expires_at) < int(time.time()):
        raise ValueError("Token do Facebook expirado.")

    try:
        profile_response = requests.get(
            _facebook_api_url("/me"),
            params={
                "fields": "id,name,email",
                "access_token": access_token,
            },
            timeout=10,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro ao buscar perfil do Facebook")
        raise ValueError("Falha ao buscar perfil no Facebook.") from err

    profile_body = _parse_facebook_response(profile_response)
    if not profile_response.ok:
        error_message = None
        error_field = profile_body.get("error")
        if isinstance(error_field, dict):
            error_message = error_field.get("message")
        raise ValueError(error_message or "Token do Facebook não pôde ser validado.")

    email = str(profile_body.get("email") or "").strip().lower() or None
    facebook_id = str(debug_data.get("user_id") or profile_body.get("id") or "").strip()
    scopes_field = debug_data.get("scopes") or []
    normalized_scopes = []
    if isinstance(scopes_field, (list, tuple)):
        for scope in scopes_field:
            if scope:
                normalized_scopes.append(str(scope).strip())

    expires_at_dt = None
    if expires_at:
        try:
            expires_at_dt = datetime.fromtimestamp(int(expires_at), tz=timezone.utc)
        except Exception:
            expires_at_dt = None

    if not facebook_id:
        raise ValueError("Não foi possível identificar o usuário do Facebook.")

    if not email:
        logger.warning("Login com Facebook sem email retornado. Verifique permissão 'email' no app Meta/config.")

    return {
        "facebook_id": facebook_id,
        "email": email,
        "nome": profile_body.get("name"),
        "facebook_name": profile_body.get("name"),
        "scopes": normalized_scopes,
        "expires_at": expires_at_dt.isoformat() if expires_at_dt else None,
    }


def _extract_bearer_token(req) -> Optional[str]:
    header = req.headers.get("Authorization", "").strip()
    if header.lower().startswith("bearer "):
        candidate = header[7:].strip()
        if candidate:
            return candidate
    token = req.args.get("token")
    if token:
        return token.strip()
    return None


def _serialize_user_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "email": row.get("email"),
        "role": row.get("role"),
        "nome": row.get("nome"),
    }


def _exchange_long_lived_user_token(access_token: str) -> tuple[str, Optional[datetime]]:
    """
    Troca o token curto retornado pelo login do Facebook por um token de usuario long-lived (~60 dias).
    Mantem o token original se a troca falhar.
    """
    if not access_token:
        return "", None
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": FACEBOOK_APP_ID,
        "client_secret": FACEBOOK_APP_SECRET,
        "fb_exchange_token": access_token,
    }
    try:
        response = requests.get(_facebook_api_url("/oauth/access_token"), params=params, timeout=10)
    except Exception as err:  # noqa: BLE001
        logger.warning("Falha ao trocar token de usuario por long-lived: %s", err)
        return access_token, None

    body = _parse_facebook_response(response)
    token_value = body.get("access_token") if isinstance(body, dict) else None
    if not response.ok or not token_value:
        logger.warning("Nao foi possivel trocar o token do usuario: %s", body)
        return access_token, None

    expires_at = None
    expires_in = body.get("expires_in") if isinstance(body, dict) else None
    if expires_in:
        try:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        except Exception:
            expires_at = None

    return token_value, expires_at


def _fetch_user_pages_and_tokens(user_token: str) -> List[Dict[str, Any]]:
    """
    Lista paginas e tokens de pagina/Instagram a partir do token do usuario.
    """
    if not user_token:
        return []
    try:
        response = requests.get(
            _facebook_api_url("/me/accounts"),
            params={
                "access_token": user_token,
                "fields": "id,name,access_token,instagram_business_account{id,username,profile_picture_url}",
                "limit": 100,
            },
            timeout=15,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao buscar paginas com token do usuario Meta")
        raise ValueError("Nao foi possivel listar paginas com este token.") from err

    payload = _parse_facebook_response(response)
    if not response.ok:
        error_message = None
        error_field = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error_field, dict):
            error_message = error_field.get("message")
        raise ValueError(error_message or "Token nao autorizado para listar paginas.")

    pages: List[Dict[str, Any]] = []
    for item in payload.get("data", []):
        if not isinstance(item, dict):
            continue
        page_id = str(item.get("id") or "").strip()
        if not page_id:
            continue
        ig_info = item.get("instagram_business_account") or {}
        ig_id = ""
        ig_username = ""
        if isinstance(ig_info, dict):
            ig_id = str(ig_info.get("id") or "").strip()
            ig_username = str(ig_info.get("username") or "").strip()
        pages.append(
            {
                "id": page_id,
                "name": item.get("name"),
                "access_token": item.get("access_token"),
                "instagram_user_id": ig_id,
                "instagram_username": ig_username,
            }
        )
    return pages


def _persist_meta_user_token(
    user_id: str,
    facebook_user_id: str,
    scopes: Sequence[str],
    user_access_token: str,
    user_access_expires_at: Optional[datetime],
    page_access_token: Optional[str],
    page_id: Optional[str],
    instagram_user_id: Optional[str],
) -> Dict[str, Any]:
    if not user_id or not facebook_user_id or not user_access_token:
        raise ValueError("user_id, facebook_user_id e user_access_token sao obrigatorios")

    _ensure_meta_tokens_table()
    normalized_scopes = [scope.strip().lower() for scope in scopes if scope]
    normalized_page_id = (page_id or "").strip()
    normalized_instagram_id = (instagram_user_id or "").strip()
    params = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "facebook_user_id": facebook_user_id,
        "scopes": normalized_scopes,
        "user_access_token": user_access_token,
        "user_access_expires_at": user_access_expires_at,
        "page_id": normalized_page_id,
        "page_access_token": page_access_token or None,
        "instagram_user_id": normalized_instagram_id,
    }

    execute(
        f"""
        INSERT INTO {META_TOKENS_TABLE} (
            id, user_id, facebook_user_id, scopes, user_access_token, user_access_expires_at,
            page_id, page_access_token, instagram_user_id, created_at, updated_at
        ) VALUES (
            %(id)s, %(user_id)s, %(facebook_user_id)s, %(scopes)s, %(user_access_token)s, %(user_access_expires_at)s,
            %(page_id)s, %(page_access_token)s, %(instagram_user_id)s, NOW(), NOW()
        )
        ON CONFLICT (user_id, page_id) DO UPDATE SET
            facebook_user_id = EXCLUDED.facebook_user_id,
            scopes = EXCLUDED.scopes,
            user_access_token = EXCLUDED.user_access_token,
            user_access_expires_at = EXCLUDED.user_access_expires_at,
            page_access_token = EXCLUDED.page_access_token,
            instagram_user_id = EXCLUDED.instagram_user_id,
            updated_at = NOW();
        """,
        params,
    )

    response = {
        "user_id": user_id,
        "facebook_user_id": facebook_user_id,
        "page_id": normalized_page_id,
        "instagram_user_id": normalized_instagram_id,
        "scopes": normalized_scopes,
    }
    if user_access_expires_at:
        response["user_access_expires_at"] = user_access_expires_at
        response["user_access_expires_at_iso"] = user_access_expires_at.isoformat()
    return response


def _serialize_cover_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    updated_at = row.get("updated_at")
    if isinstance(updated_at, datetime):
        updated_at_iso = updated_at.isoformat()
    else:
        updated_at_iso = updated_at
    return {
        "id": row.get("id"),
        "account_id": row.get("account_id"),
        "platform": row.get("platform"),
        "url": row.get("storage_url"),
        "content_type": row.get("content_type"),
        "size_bytes": row.get("size_bytes"),
        "updated_at": updated_at_iso,
    }


def _fetch_facebook_page_info(page_id: str) -> Dict[str, Any]:
    if not page_id:
        raise ValueError("page_id is required")
    token = get_page_access_token(page_id)
    data = gget(
        f"/{page_id}",
        params={
            "fields": "id,name,picture{url,height,width}",
        },
        token=token,
    )
    picture = data.get("picture") or {}
    picture_data = picture.get("data") or {}
    return {
        "id": data.get("id") or page_id,
        "name": data.get("name"),
        "picture_url": picture_data.get("url"),
    }


def _fetch_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    normalized = email.strip().lower()
    if not normalized:
        return None
    return fetch_one(
        f"""
        SELECT id, email, role, nome, password_hash, facebook_id, facebook_email, facebook_name
        FROM {APP_USERS_TABLE}
        WHERE lower(email) = %(email)s
        LIMIT 1
        """,
        {"email": normalized},
    )


def _fetch_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    return fetch_one(
        f"""
        SELECT id, email, role, nome, password_hash, facebook_id, facebook_email, facebook_name
        FROM {APP_USERS_TABLE}
        WHERE id = %(user_id)s
        LIMIT 1
        """,
        {"user_id": user_id},
    )


def _fetch_user_by_facebook_id(facebook_id: str) -> Optional[Dict[str, Any]]:
    if not facebook_id:
        return None
    return fetch_one(
        f"""
        SELECT id, email, role, nome, password_hash, facebook_id, facebook_email, facebook_name
        FROM {APP_USERS_TABLE}
        WHERE facebook_id = %(facebook_id)s
        LIMIT 1
        """,
        {"facebook_id": facebook_id},
    )


def _authenticate_request(req):
    token = _extract_bearer_token(req)
    if not token:
        return None, (jsonify({"error": "missing token"}), 401)
    user_id = _decode_auth_token(token)
    if not user_id:
        return None, (jsonify({"error": "invalid or expired token"}), 401)
    user_row = _fetch_user_by_id(user_id)
    if not user_row:
        return None, (jsonify({"error": "user not found"}), 404)
    return user_row, None


def _create_app_user(email: str, password: str, nome: str, role: Optional[str] = None) -> str:
    user_id = str(uuid.uuid4())
    hashed = _hash_password(password)
    normalized_role = role or DEFAULT_USER_ROLE or "analista"
    execute(
        f"""
        INSERT INTO {APP_USERS_TABLE} (id, email, password_hash, role, nome, facebook_id, facebook_email, facebook_name)
        VALUES (%(id)s, %(email)s, %(password_hash)s, %(role)s, %(nome)s, %(facebook_id)s, %(facebook_email)s, %(facebook_name)s)
        """,
        {
            "id": user_id,
            "email": email,
            "password_hash": hashed,
            "role": normalized_role,
            "nome": nome,
            "facebook_id": None,
            "facebook_email": None,
            "facebook_name": None,
        },
    )
    return user_id


def _upsert_facebook_user(profile: Dict[str, Any]) -> Dict[str, Any]:
    facebook_id = str(profile.get("facebook_id") or profile.get("id") or "").strip()
    email = str(profile.get("email") or "").strip().lower()
    nome = str(profile.get("nome") or profile.get("name") or "").strip() or "Usuário Facebook"
    facebook_email = email or None
    facebook_name = str(profile.get("name") or profile.get("facebook_name") or nome).strip() or None

    existing_by_fb = _fetch_user_by_facebook_id(facebook_id)
    if existing_by_fb:
        execute(
            f"""
            UPDATE {APP_USERS_TABLE}
            SET
                email = COALESCE(%(email)s, email),
                facebook_email = %(facebook_email)s,
                facebook_name = COALESCE(%(facebook_name)s, facebook_name),
                nome = COALESCE(%(nome)s, nome),
                updated_at = NOW()
            WHERE id = %(user_id)s
            """,
            {
                "user_id": existing_by_fb["id"],
                "email": email or existing_by_fb.get("email"),
                "facebook_email": facebook_email,
                "facebook_name": facebook_name,
                "nome": nome,
            },
        )
        return _fetch_user_by_id(existing_by_fb["id"])

    existing_by_email = _fetch_user_by_email(email) if email else None
    if existing_by_email:
        execute(
            f"""
            UPDATE {APP_USERS_TABLE}
            SET
                facebook_id = %(facebook_id)s,
                facebook_email = %(facebook_email)s,
                facebook_name = COALESCE(%(facebook_name)s, facebook_name),
                nome = COALESCE(%(nome)s, nome),
                updated_at = NOW()
            WHERE id = %(user_id)s
            """,
            {
                "facebook_id": facebook_id,
                "facebook_email": facebook_email,
                "facebook_name": facebook_name,
                "nome": nome,
                "user_id": existing_by_email["id"],
            },
        )
        return _fetch_user_by_id(existing_by_email["id"])

    user_id = str(uuid.uuid4())
    placeholder_password = secrets.token_urlsafe(32)
    hashed = _hash_password(placeholder_password)
    execute(
        f"""
        INSERT INTO {APP_USERS_TABLE} (id, email, password_hash, role, nome, facebook_id, facebook_email, facebook_name)
        VALUES (%(id)s, %(email)s, %(password_hash)s, %(role)s, %(nome)s, %(facebook_id)s, %(facebook_email)s, %(facebook_name)s)
        """,
        {
            "id": user_id,
            "email": email,
            "password_hash": hashed,
            "role": DEFAULT_USER_ROLE or "analista",
            "nome": nome,
            "facebook_id": facebook_id,
            "facebook_email": facebook_email,
            "facebook_name": facebook_name,
        },
    )
    return _fetch_user_by_id(user_id)


def _list_app_users() -> List[Dict[str, Any]]:
    return (
        fetch_all(
            f"""
            SELECT id, email, role, nome, created_at, updated_at
            FROM {APP_USERS_TABLE}
            ORDER BY created_at DESC NULLS LAST
            """
        )
        or []
    )


def _update_app_user_role(user_id: str, role: str) -> None:
    execute(
        f"""
        UPDATE {APP_USERS_TABLE}
        SET role = %(role)s, updated_at = NOW()
        WHERE id = %(user_id)s
        """,
        {"role": role, "user_id": user_id},
    )


def _delete_app_user(user_id: str) -> None:
    execute(
        f"""
        DELETE FROM {APP_USERS_TABLE}
        WHERE id = %(user_id)s
        """,
        {"user_id": user_id},
    )


def _estimate_data_url_size_bytes(data_url: str) -> int:
    if not data_url:
        return 0
    if ";base64," in data_url:
        b64_part = data_url.split(",", 1)[1]
        padding = b64_part.count("=")
        return int(len(b64_part) * 3 / 4) - padding
    return len(data_url.encode("utf-8"))


def _fetch_social_cover(account_id: str, platform: str) -> Optional[Dict[str, Any]]:
    return fetch_one(
        f"""
        SELECT id, account_id, platform, storage_url, content_type, size_bytes, created_at, updated_at
        FROM {SOCIAL_COVERS_TABLE}
        WHERE account_id = %(account_id)s AND platform = %(platform)s
        LIMIT 1
        """,
        {"account_id": account_id, "platform": platform},
    )


def _upsert_social_cover(
    account_id: str,
    platform: str,
    storage_url: str,
    content_type: Optional[str],
    size_bytes: Optional[int],
) -> Dict[str, Any]:
    existing = _fetch_social_cover(account_id, platform)
    if existing:
        execute(
            f"""
            UPDATE {SOCIAL_COVERS_TABLE}
            SET storage_url = %(storage_url)s,
                content_type = %(content_type)s,
                size_bytes = %(size_bytes)s,
                updated_at = NOW()
            WHERE account_id = %(account_id)s AND platform = %(platform)s
            """,
            {
                "storage_url": storage_url,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "account_id": account_id,
                "platform": platform,
            },
        )
    else:
        execute(
            f"""
            INSERT INTO {SOCIAL_COVERS_TABLE} (account_id, platform, storage_url, content_type, size_bytes)
            VALUES (%(account_id)s, %(platform)s, %(storage_url)s, %(content_type)s, %(size_bytes)s)
            """,
            {
                "account_id": account_id,
                "platform": platform,
                "storage_url": storage_url,
                "content_type": content_type,
                "size_bytes": size_bytes,
            },
        )
    return _fetch_social_cover(account_id, platform) or {}


def _delete_social_cover(account_id: str, platform: str) -> None:
    execute(
        f"""
        DELETE FROM {SOCIAL_COVERS_TABLE}
        WHERE account_id = %(account_id)s AND platform = %(platform)s
        """,
        {"account_id": account_id, "platform": platform},
    )


def _normalize_metric_date(value: Optional[Any]) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            if "T" in candidate:
                return datetime.fromisoformat(candidate).date()
            return date.fromisoformat(candidate)
        except ValueError:
            return None
    return None


def _isoformat_metric_date(value: Optional[Any]) -> Optional[str]:
    metric_date = _normalize_metric_date(value)
    return metric_date.isoformat() if metric_date else None


def _ensure_instagram_daily_metrics(ig_id: str, start_date: date, end_date: date) -> None:
    client = get_postgres_client()
    if client is None:
        logger.debug("Banco n\u00e3o configurado; pulando _ensure_instagram_daily_metrics.")
        return

    response = (
        client.table(IG_METRICS_TABLE)
        .select("metric_date")
        .eq("account_id", ig_id)
        .eq("platform", IG_METRICS_PLATFORM)
        .gte("metric_date", start_date.isoformat())
        .lte("metric_date", end_date.isoformat())
        .execute()
    )
    if getattr(response, "error", None):
        logger.warning("Falha ao consultar %s: %s", IG_METRICS_TABLE, response.error)
        return

    existing_dates: set[date] = set()
    for row in response.data or []:
        normalized = _normalize_metric_date(row.get("metric_date"))
        if normalized is not None:
            existing_dates.add(normalized)
    missing_dates = [
        day
        for day in daterange(start_date, end_date)
        if day not in existing_dates
    ]
    if not missing_dates:
        return

    missing_start = missing_dates[0]
    missing_end = missing_dates[-1]
    logger.info(
        "Preenchendo lacunas Instagram %s (%s -> %s)",
        ig_id,
        missing_start,
        missing_end,
    )
    ingest_account_range(
        ig_id,
        missing_start,
        missing_end,
        refresh_rollup=True,
        warm_posts=False,
    )


_instagram_backfill_lock = threading.Lock()
_instagram_backfill_pending: set[str] = set()


def _schedule_instagram_metrics_backfill(ig_id: str, start_date: date, end_date: date) -> None:
    if not INSTAGRAM_METRICS_AUTO_BACKFILL:
        return
    if start_date > end_date:
        return
    key = f"{ig_id}|{start_date.isoformat()}|{end_date.isoformat()}"
    with _instagram_backfill_lock:
        if key in _instagram_backfill_pending:
            return
        _instagram_backfill_pending.add(key)

    def run() -> None:
        try:
            _ensure_instagram_daily_metrics(ig_id, start_date, end_date)
        finally:
            with _instagram_backfill_lock:
                _instagram_backfill_pending.discard(key)

    threading.Thread(target=run, daemon=True).start()


def _load_metrics_map(ig_id: str, start_date: date, end_date: date) -> Dict[str, List[Dict[str, Any]]]:
    client = get_postgres_client()
    if client is None:
        return {}

    response = (
        client.table(IG_METRICS_TABLE)
        .select("metric_key,metric_date,value,metadata")
        .eq("account_id", ig_id)
        .eq("platform", IG_METRICS_PLATFORM)
        .gte("metric_date", start_date.isoformat())
        .lte("metric_date", end_date.isoformat())
        .execute()
    )
    if getattr(response, "error", None):
        logger.warning("Falha ao carregar %s: %s", IG_METRICS_TABLE, response.error)
        return {}

    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in response.data or []:
        metric_dt = _normalize_metric_date(row.get("metric_date"))
        if metric_dt is None:
            continue
        grouped[row["metric_key"]].append(
            {
                "metric_date": metric_dt,
                "value": row.get("value"),
                "metadata": row.get("metadata"),
            }
        )

    for entries in grouped.values():
        entries.sort(key=lambda item: item["metric_date"])

    return grouped


def _load_followers_gain_series_from_db(ig_id: str, start_date: date, end_date: date) -> List[Dict[str, Any]]:
    client = get_postgres_client()
    if client is None:
        return []

    response = (
        client.table(IG_METRICS_TABLE)
        .select("metric_key,metric_date,value")
        .eq("account_id", ig_id)
        .eq("platform", IG_METRICS_PLATFORM)
        .gte("metric_date", start_date.isoformat())
        .lte("metric_date", end_date.isoformat())
        .in_("metric_key", ["follows", "followers_delta", "followers_total"])
        .execute()
    )
    if getattr(response, "error", None):
        logger.warning("Falha ao carregar followers_gain_series: %s", response.error)
        return []

    series_by_key: Dict[str, List[Dict[str, Any]]] = {"follows": [], "followers_delta": [], "followers_total": []}
    for row in response.data or []:
        metric_key = row.get("metric_key")
        if metric_key not in series_by_key:
            continue
        metric_date = _normalize_metric_date(row.get("metric_date"))
        metric_value = _to_float(row.get("value"))
        if metric_date is None or metric_value is None:
            continue
        series_by_key[metric_key].append(
            {
                "date": metric_date.isoformat(),
                "value": int(round(metric_value)) if metric_key == "followers_total" else int(round(max(0, metric_value))),
            }
        )

    for entries in series_by_key.values():
        entries.sort(key=lambda item: item["date"])

    if series_by_key["follows"]:
        return series_by_key["follows"]
    if series_by_key["followers_delta"]:
        return series_by_key["followers_delta"]

    # Calcula crescimento diário a partir de followers_total se não houver dados diretos
    followers_total_series = series_by_key["followers_total"]
    if len(followers_total_series) >= 2:
        gain_series: List[Dict[str, Any]] = []
        for i in range(1, len(followers_total_series)):
            prev_entry = followers_total_series[i - 1]
            curr_entry = followers_total_series[i]
            diff = curr_entry["value"] - prev_entry["value"]
            gain_series.append({
                "date": curr_entry["date"],
                "value": max(0, diff),
            })
        return gain_series

    return []


def _load_instagram_rollups(ig_id: str, end_date: date) -> Dict[str, Dict[str, Any]]:
    client = get_postgres_client()
    if client is None:
        return {}

    response = (
        client.table(IG_METRICS_ROLLUP_TABLE)
        .select("metric_key,bucket,start_date,end_date,value_sum,value_avg,samples,payload")
        .eq("account_id", ig_id)
        .eq("platform", IG_METRICS_PLATFORM)
        .eq("end_date", end_date.isoformat())
        .in_("bucket", list(IG_ROLLUP_BUCKETS))
        .execute()
    )
    if getattr(response, "error", None):
        logger.warning("Falha ao carregar %s: %s", IG_METRICS_ROLLUP_TABLE, response.error)
        return {}

    rollups: Dict[str, Dict[str, Any]] = {}
    for row in response.data or []:
        bucket = str(row.get("bucket") or "")
        metric_key = str(row.get("metric_key") or "")
        if not bucket or not metric_key:
            continue
        entry: Dict[str, Any] = {
            "start_date": _isoformat_metric_date(row.get("start_date")),
            "end_date": _isoformat_metric_date(row.get("end_date")),
            "sum": _to_float(row.get("value_sum")),
            "avg": _to_float(row.get("value_avg")),
        }
        samples = row.get("samples")
        if samples is not None:
            try:
                entry["samples"] = int(samples)
            except (TypeError, ValueError):
                entry["samples"] = samples
        if row.get("payload") is not None:
            entry["payload"] = row["payload"]
        rollups.setdefault(bucket, {})[metric_key] = entry
    return rollups


def _coverage_summary(
    data: Dict[str, List[Dict[str, Any]]],
    requested_start: date,
    requested_end: date,
) -> Dict[str, Any]:
    requested_days = max(0, (requested_end - requested_start).days + 1)
    available_dates: set[date] = set()
    for entries in data.values():
        for entry in entries:
            metric_date = entry.get("metric_date")
            if isinstance(metric_date, date):
                available_dates.add(metric_date)

    covered_days = sum(1 for day in daterange(requested_start, requested_end) if day in available_dates)
    coverage_ratio = covered_days / requested_days if requested_days else 1.0
    first_available = min(available_dates) if available_dates else None
    last_available = max(available_dates) if available_dates else None

    return {
        "requested_since": requested_start.isoformat(),
        "requested_until": requested_end.isoformat(),
        "requested_days": requested_days,
        "covered_days": covered_days,
        "missing_days": max(0, requested_days - covered_days),
        "coverage_ratio": round(coverage_ratio, 4),
        "first_available_date": first_available.isoformat() if first_available else None,
        "last_available_date": last_available.isoformat() if last_available else None,
        "has_full_coverage": requested_days > 0 and covered_days == requested_days,
    }


def _upsert_instagram_metrics_coverage(
    client,
    account_id: str,
    start_date: date,
    end_date: date,
    days_expected: int,
    days_present: int,
    error_message: Optional[str] = None,
) -> None:
    if client is None:
        return
    payload = {
        "account_id": str(account_id),
        "date_from": start_date.isoformat(),
        "date_to": end_date.isoformat(),
        "days_expected": int(days_expected),
        "days_present": int(days_present),
        "last_backfill_at": datetime.now(timezone.utc).isoformat(),
        "last_error": error_message,
    }
    try:
        client.table(IG_METRICS_COVERAGE_TABLE).upsert(
            payload,
            on_conflict="account_id,date_from,date_to",
        ).execute()
    except Exception as err:  # noqa: BLE001
        logger.warning("Coverage upsert failed for %s: %s", account_id, err)


def compute_instagram_metrics_coverage(
    account_id: str,
    start_date: date,
    end_date: date,
    *,
    debug: bool = False,
    table_name: str = IG_METRICS_TABLE,
    platform: Optional[str] = IG_METRICS_PLATFORM,
    persist: bool = True,
) -> Dict[str, Any]:
    """
    Compute coverage for a date range.
    When debug is True, include missing_days list.
    """
    summary: Dict[str, Any] = {
        "account_id": str(account_id),
        "date_from": start_date.isoformat(),
        "date_to": end_date.isoformat(),
        "days_expected": 0,
        "days_present": 0,
    }

    if start_date > end_date:
        summary["error"] = "invalid_range"
        if debug:
            summary["missing_days"] = []
        return summary

    days_expected = (end_date - start_date).days + 1
    summary["days_expected"] = days_expected

    client = get_postgres_client()
    if client is None:
        summary["error"] = "postgres_not_configured"
        if debug:
            summary["missing_days"] = [
                day.isoformat() for day in daterange(start_date, end_date)
            ]
        return summary

    existing_dates: set[date] = set()
    error_message = None
    try:
        query = (
            client.table(table_name)
            .select("metric_date")
            .eq("account_id", account_id)
            .gte("metric_date", start_date.isoformat())
            .lte("metric_date", end_date.isoformat())
        )
        if platform and table_name == IG_METRICS_TABLE:
            query = query.eq("platform", platform)
        response = query.execute()
        for row in response.data or []:
            normalized = _normalize_metric_date(row.get("metric_date"))
            if normalized is not None:
                existing_dates.add(normalized)
    except Exception as err:  # noqa: BLE001
        error_message = str(err)
        logger.warning("Coverage query failed for %s: %s", table_name, err)

    days_present = len(existing_dates)
    summary["days_present"] = days_present
    summary["coverage_ratio"] = round(days_present / days_expected, 4) if days_expected else 1.0
    if error_message:
        summary["error"] = error_message
    if debug:
        summary["missing_days"] = [
            day.isoformat()
            for day in daterange(start_date, end_date)
            if day not in existing_dates
        ]

    if persist:
        _upsert_instagram_metrics_coverage(
            client,
            account_id,
            start_date,
            end_date,
            days_expected,
            days_present,
            error_message,
        )

    return summary


def _sum_metric(data: Dict[str, List[Dict[str, Any]]], metric_key: str) -> Optional[float]:
    values = [
        float(entry["value"])
        for entry in data.get(metric_key, [])
        if entry.get("value") is not None
    ]
    if not values:
        return None
    return sum(values)


def _latest_metric(data: Dict[str, List[Dict[str, Any]]], metric_key: str) -> Optional[float]:
    entries = data.get(metric_key, [])
    if not entries:
        return None
    return float(entries[-1]["value"]) if entries[-1].get("value") is not None else None


def _first_metric(data: Dict[str, List[Dict[str, Any]]], metric_key: str) -> Optional[float]:
    entries = data.get(metric_key, [])
    if not entries:
        return None
    return float(entries[0]["value"]) if entries[0].get("value") is not None else None


def _percentage_delta(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous in (None, 0):
        return None
    return round(((current - previous) / previous) * 100.0, 2)


def _combine_visitors(rows: Sequence[Dict[str, Any]]) -> Optional[Dict[str, int]]:
    totals = {"followers": 0.0, "non_followers": 0.0, "other": 0.0, "total": 0.0}
    for entry in rows:
        meta = entry.get("metadata") or {}
        for key in totals:
            value = meta.get(key)
            if value is None:
                continue
            try:
                totals[key] += float(value)
            except (TypeError, ValueError):
                continue
    if totals["total"] <= 0:
        return None
    return {key: int(round(val)) for key, val in totals.items()}


def _as_int(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    return int(round(value))


def _to_float(value: Optional[Any]) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_instagram_metrics_from_db(
    ig_id: str,
    since_ts: int,
    until_ts: int,
    *,
    allow_partial: bool = False,
    min_coverage_ratio: float = 0.0,
    min_coverage_days: int = 1,
) -> Optional[Dict[str, Any]]:
    client = get_postgres_client()
    if client is None:
        return None

    since_date = _unix_to_date(since_ts)
    until_date = _unix_to_date(until_ts)

    period_days = (until_date - since_date).days + 1
    previous_since = since_date - timedelta(days=period_days)
    previous_until = since_date - timedelta(days=1)
    current_data = _load_metrics_map(ig_id, since_date, until_date)
    if not current_data:
        return None
    previous_data = _load_metrics_map(ig_id, previous_since, previous_until) if previous_since <= previous_until else {}
    coverage = _coverage_summary(current_data, since_date, until_date)
    if coverage["covered_days"] == 0:
        return None
    require_full_coverage = os.getenv("INSTAGRAM_METRICS_REQUIRE_FULL_COVERAGE", "1") != "0"
    if not coverage.get("has_full_coverage"):
        if require_full_coverage and not allow_partial:
            return None
        if allow_partial:
            if coverage.get("covered_days", 0) < max(1, min_coverage_days):
                return None
            if coverage.get("coverage_ratio", 0) < min_coverage_ratio:
                return None

    reach_total = _sum_metric(current_data, "reach")
    reach_previous = _sum_metric(previous_data, "reach") if previous_data else None

    interactions_total = _sum_metric(current_data, "interactions")
    interactions_previous = _sum_metric(previous_data, "interactions") if previous_data else None

    likes_total = _sum_metric(current_data, "likes")
    likes_previous = _sum_metric(previous_data, "likes") if previous_data else None

    saves_total = _sum_metric(current_data, "saves")
    saves_previous = _sum_metric(previous_data, "saves") if previous_data else None

    shares_total = _sum_metric(current_data, "shares")
    shares_previous = _sum_metric(previous_data, "shares") if previous_data else None

    comments_total = _sum_metric(current_data, "comments")
    comments_previous = _sum_metric(previous_data, "comments") if previous_data else None

    follower_delta_rows = current_data.get("followers_delta", [])
    net_followers_growth: Optional[float] = None
    if follower_delta_rows:
        try:
            net_followers_growth = sum(
                float(entry["value"])
                for entry in follower_delta_rows
                if entry.get("value") is not None
            )
        except (TypeError, ValueError):
            net_followers_growth = None

    def _sum_positive_entries(rows: Sequence[Dict[str, Any]]) -> Optional[float]:
        total = 0.0
        has_value = False
        for entry in rows or []:
            metric_value = _to_float(entry.get("value"))
            if metric_value is None:
                continue
            has_value = True
            if metric_value > 0:
                total += metric_value
        return total if has_value else None

    def _sum_positive_diffs(rows: Sequence[Dict[str, Any]]) -> Optional[float]:
        total = 0.0
        previous = None
        has_value = False
        for entry in rows or []:
            metric_value = _to_float(entry.get("value"))
            if metric_value is None:
                continue
            if previous is not None:
                diff = metric_value - previous
                if diff > 0 and math.isfinite(diff):
                    total += diff
                has_value = True
            previous = metric_value
        return total if has_value else None

    followers_end = _latest_metric(current_data, "followers_total")
    followers_previous_end = _latest_metric(previous_data, "followers_total") if previous_data else None

    followers_start = _first_metric(current_data, "followers_start")
    if followers_start is None:
        followers_start = _latest_metric(previous_data, "followers_total") if previous_data else None

    follows_total = _sum_metric(current_data, "follows")
    unfollows_total = _sum_metric(current_data, "unfollows")
    previous_follows_total = _sum_metric(previous_data, "follows") if previous_data else None

    if net_followers_growth is None:
        if followers_start is not None and followers_end is not None:
            net_followers_growth = followers_end - followers_start
        elif follows_total is not None or unfollows_total is not None:
            net_followers_growth = (follows_total or 0.0) - (unfollows_total or 0.0)

    positive_delta_total = _sum_positive_entries(follower_delta_rows)
    series_gain_total = _sum_positive_diffs(current_data.get("followers_total", []))

    if follows_total is not None:
        followers_gained_total: Optional[float] = follows_total
    elif positive_delta_total is not None:
        followers_gained_total = positive_delta_total
    elif series_gain_total is not None:
        followers_gained_total = series_gain_total
    elif net_followers_growth is not None and net_followers_growth >= 0:
        followers_gained_total = net_followers_growth
    else:
        followers_gained_total = None

    engagement_rate = None
    if reach_total:
        engagement_rate = round((interactions_total / reach_total) * 100.0, 2)

    visitor_rows = current_data.get("profile_visitors_total", [])
    profile_visitors_breakdown = _combine_visitors(visitor_rows) if visitor_rows else None
    if profile_visitors_breakdown:
        profile_visitors_breakdown["source"] = IG_METRICS_TABLE

    follower_counts = {
        "start": _as_int(followers_start),
        "end": _as_int(followers_end),
        "follows": _as_int(follows_total),
        "unfollows": _as_int(unfollows_total),
    }

    follower_series = [
        {
            "date": entry["metric_date"].isoformat(),
            "value": _as_int(entry.get("value")),
        }
        for entry in current_data.get("followers_total", [])
        if entry.get("value") is not None
    ]

    def _build_followers_gain_series(metric_key: str) -> List[Dict[str, Any]]:
        series: List[Dict[str, Any]] = []
        for entry in current_data.get(metric_key, []):
            metric_date = _normalize_metric_date(entry.get("metric_date"))
            metric_value = _to_float(entry.get("value"))
            if metric_date is None or metric_value is None:
                continue
            series.append(
                {
                    "date": metric_date.isoformat(),
                    "value": int(round(max(0, metric_value))),
                }
            )
        series.sort(key=lambda item: item["date"])
        return series

    followers_gain_series = _build_followers_gain_series("follows")
    if not followers_gain_series:
        followers_gain_series = _build_followers_gain_series("followers_delta")

    # Se não houver dados diretos, calcula a partir de followers_total
    if not followers_gain_series and follower_series and len(follower_series) >= 2:
        sorted_series = sorted(follower_series, key=lambda x: x["date"])
        for i in range(1, len(sorted_series)):
            prev_value = sorted_series[i - 1].get("value")
            curr_value = sorted_series[i].get("value")
            if prev_value is not None and curr_value is not None:
                diff = curr_value - prev_value
                followers_gain_series.append({
                    "date": sorted_series[i]["date"],
                    "value": max(0, diff),
                })

    reach_timeseries = [
        {
            "date": entry["metric_date"].isoformat(),
            "value": _as_int(entry.get("value")),
        }
        for entry in current_data.get("reach", [])
        if entry.get("value") is not None
    ]
    profile_views_total = _sum_metric(current_data, "profile_views")
    profile_views_previous = _sum_metric(previous_data, "profile_views") if previous_data else None
    profile_views_timeseries = [
        {
            "date": entry["metric_date"].isoformat(),
            "value": _as_int(entry.get("value")),
        }
        for entry in current_data.get("profile_views", [])
        if entry.get("value") is not None
    ]
    video_views_total = _sum_metric(current_data, "video_views")
    video_views_previous = _sum_metric(previous_data, "video_views") if previous_data else None
    video_watch_time_total = _sum_metric(current_data, "video_watch_time_total")
    video_views_timeseries = [
        {
            "date": entry["metric_date"].isoformat(),
            "value": _as_int(entry.get("value")),
        }
        for entry in current_data.get("video_views", [])
        if entry.get("value") is not None
    ]

    def _sum_timeseries(series: Sequence[Dict[str, Any]]) -> int:
        total = 0
        for entry in series or []:
            if not isinstance(entry, dict):
                continue
            try:
                total += int(entry.get("value") or 0)
            except (TypeError, ValueError):
                continue
        return total

    resolved_video_views_total = video_views_total
    resolved_video_views_previous = video_views_previous
    resolved_video_views_timeseries = video_views_timeseries

    # Fallback: quando video_views estiver zerado/ausente mas há alcance (dataset antigo ou métrica indisponível),
    # usa reach como proxy para não retornar "0" na UI.
    if resolved_video_views_total in (None, 0) and _sum_timeseries(video_views_timeseries) > 0:
        resolved_video_views_total = float(_sum_timeseries(video_views_timeseries))
    if resolved_video_views_total in (None, 0) and reach_total not in (None, 0):
        resolved_video_views_total = reach_total
        resolved_video_views_previous = reach_previous
        if reach_timeseries:
            resolved_video_views_timeseries = reach_timeseries

    avg_watch_time_value = None
    if video_watch_time_total and resolved_video_views_total:
        try:
            avg_watch_time_value = float(video_watch_time_total) / float(resolved_video_views_total)
        except (TypeError, ValueError, ZeroDivisionError):
            avg_watch_time_value = None

    metrics_payload = [
        {
            "key": "followers_total",
            "label": "SEGUIDORES",
            "value": _as_int(followers_end),
            "deltaPct": _percentage_delta(followers_end, followers_previous_end),
        },
        {
            "key": "followers_gained",
            "label": "SEGUIDORES GANHOS",
            "value": _as_int(followers_gained_total),
            "deltaPct": _percentage_delta(follows_total, previous_follows_total)
            if follows_total is not None and previous_follows_total not in (None, 0)
            else None,
        },
        {
            "key": "reach",
            "label": "ALCANCE",
            "value": _as_int(reach_total),
            "deltaPct": _percentage_delta(reach_total, reach_previous),
            "timeseries": reach_timeseries,
        },
        {
            "key": "video_views",
            "label": "VISUALIZACOES",
            "value": _as_int(resolved_video_views_total if resolved_video_views_total is not None else profile_views_total),
            "deltaPct": _percentage_delta(
                resolved_video_views_total if resolved_video_views_total is not None else profile_views_total,
                resolved_video_views_previous if resolved_video_views_total is not None else profile_views_previous,
            ),
            "timeseries": resolved_video_views_timeseries or profile_views_timeseries,
        },
        {
            "key": "video_avg_watch_time",
            "label": "TEMPO MEDIO ASSISTIDO (s)",
            "value": avg_watch_time_value,
            "deltaPct": None,
        },
        {
            "key": "profile_views",
            "label": "VISITAS AO PERFIL",
            "value": _as_int(profile_views_total),
            "deltaPct": _percentage_delta(profile_views_total, profile_views_previous),
            "timeseries": profile_views_timeseries,
        },
        {
            "key": "interactions",
            "label": "INTERACOES",
            "value": _as_int(interactions_total),
            "deltaPct": _percentage_delta(interactions_total, interactions_previous),
        },
        {
            "key": "likes",
            "label": "CURTIDAS",
            "value": _as_int(likes_total),
            "deltaPct": _percentage_delta(likes_total, likes_previous),
        },
        {
            "key": "saves",
            "label": "SALVAMENTOS",
            "value": _as_int(saves_total),
            "deltaPct": _percentage_delta(saves_total, saves_previous),
        },
        {
            "key": "shares",
            "label": "COMPARTILHAMENTOS",
            "value": _as_int(shares_total),
            "deltaPct": _percentage_delta(shares_total, shares_previous),
        },
        {
            "key": "comments",
            "label": "COMENTARIOS",
            "value": _as_int(comments_total),
            "deltaPct": _percentage_delta(comments_total, comments_previous),
        },
        {
            "key": "engagement_rate",
            "label": "TAXA ENGAJAMENTO",
            "value": engagement_rate,
            "deltaPct": None,
        },
        {
            "key": "follower_growth",
            "label": "CRESCIMENTO DE SEGUIDORES",
            "value": _as_int(followers_gained_total if followers_gained_total is not None else net_followers_growth),
            "deltaPct": _percentage_delta(follows_total, previous_follows_total)
            if follows_total is not None and previous_follows_total not in (None, 0)
            else None,
        },
    ]

    # Evita chamadas sincronas à Meta API no endpoint de métricas (isso derruba a performance).
    # O frontend já carrega posts via /api/instagram/posts quando necessário.
    top_posts_payload = {"reach": [], "engagement": [], "saves": []}

    response = {
        "since": since_ts,
        "until": until_ts,
        "metrics": metrics_payload,
        "profile_visitors_breakdown": profile_visitors_breakdown,
        "follower_counts": follower_counts,
        "follower_series": follower_series,
        "followers_gain_series": followers_gain_series,
        "followers_gained_total": _as_int(followers_gained_total),
        "top_posts": top_posts_payload,
        "reach_timeseries": reach_timeseries,
        "profile_views_timeseries": profile_views_timeseries,
        "video_views_timeseries": resolved_video_views_timeseries or profile_views_timeseries,
        "coverage": coverage,
    }
    rollups = _load_instagram_rollups(ig_id, until_date)
    if rollups:
        response["rollups"] = rollups
    response["cache"] = {
        "source": IG_METRICS_TABLE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "stale": False,
        "reason": "precomputed",
    }
    return response


def fetch_ads_highlights(
    act_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    _extra: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    until_iso = _ts_to_iso_date(until_ts)
    since_iso = _ts_to_iso_date(since_ts)

    if not since_iso or not until_iso:
        until_dt = datetime.now(timezone.utc).date()
        since_dt = until_dt - timedelta(days=7)
        since_iso = since_dt.isoformat()
        until_iso = until_dt.isoformat()

    data = ads_highlights(act_id, since_iso, until_iso)
    response = {"since": since_iso, "until": until_iso}
    response.update(data)
    return response


def meta_error_response(err: MetaAPIError):
    payload = {
        "error": err.args[0],
        "graph": {
            "status": err.status,
            "code": err.code,
            "type": err.error_type,
        },
    }
    return jsonify(payload), 502


def _serve_legal_document(filename: str):
    """
    Serve static legal documents without exigir autenticação.
    """
    file_path = os.path.join(LEGAL_DOCS_DIR, filename)
    if not os.path.isfile(file_path):
        return jsonify({"error": "document not found"}), 404
    return send_from_directory(LEGAL_DOCS_DIR, filename)


@app.get("/privacy-policy")
def privacy_policy_page():
    return _serve_legal_document("privacy_policy.html")


@app.get("/privacy-policy-en")
def privacy_policy_en_page():
    return _serve_legal_document("privacy_policy_en.html")


@app.get("/terms-of-service")
def terms_of_service_page():
    return _serve_legal_document("terms_of_service.html")


@app.post("/api/auth/register")
def auth_register() -> Any:
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    nome = str(payload.get("nome") or "").strip()

    if not email or not EMAIL_VALIDATION_RE.match(email):
        return jsonify({"error": "invalid email"}), 400
    if len(password) < 6:
        return jsonify({"error": "password must be at least 6 characters"}), 400
    if not nome:
        return jsonify({"error": "nome is required"}), 400

    if _fetch_user_by_email(email):
        return jsonify({"error": "email already registered"}), 409

    try:
        user_id = _create_app_user(email, password, nome)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to register user")
        return jsonify({"error": "could not register user"}), 500

    user_row = _fetch_user_by_id(user_id)
    token = _issue_auth_token(user_id)
    return jsonify({"token": token, "user": _serialize_user_row(user_row)}), 201


@app.post("/api/auth/login")
def auth_login() -> Any:
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    user_row = _fetch_user_by_email(email)
    if not user_row or not _verify_password(password, user_row.get("password_hash")):
        return jsonify({"error": "invalid credentials"}), 401

    token = _issue_auth_token(user_row["id"])
    return jsonify({"token": token, "user": _serialize_user_row(user_row)})


@app.post("/api/auth/facebook")
def auth_facebook() -> Any:
    payload = request.get_json(silent=True) or {}
    access_token = str(
        payload.get("access_token") or payload.get("accessToken") or ""
    ).strip()

    if not access_token:
        return jsonify({"error": "facebook access_token is required"}), 400

    try:
        profile = _validate_facebook_access_token(access_token)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro inesperado ao validar token do Facebook")
        return jsonify({"error": "could not validate facebook token"}), 502

    try:
        user_row = _upsert_facebook_user(profile)
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao criar/atualizar usuário do Facebook %s", profile)
        return jsonify({"error": "could not sign in with facebook"}), 500

    token = _issue_auth_token(user_row["id"])
    return jsonify({"token": token, "user": _serialize_user_row(user_row)})


@app.post("/api/auth/meta-token")
def auth_meta_token() -> Any:
    """
    Persiste o token do usuario Meta com escopos aprovados e salva o token de pagina/IG.
    Mantem o fluxo de login anterior (email/senha ou facebook) e adiciona um passo opcional
    para guardar o access_token com scopes limitados.
    """
    user, error = _authenticate_request(request)
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    access_token = str(payload.get("access_token") or payload.get("accessToken") or "").strip()
    preferred_page_id = str(payload.get("page_id") or payload.get("pageId") or "").strip()

    if not access_token:
        return jsonify({"error": "access_token is required"}), 400

    try:
        profile = _validate_facebook_access_token(access_token)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro inesperado ao validar token Meta para persistencia")
        return jsonify({"error": "could not validate meta token"}), 502

    scopes = [scope.lower() for scope in profile.get("scopes") or []]
    missing_scopes = sorted(scope for scope in META_LOGIN_SCOPES_SET if scope not in scopes)
    if missing_scopes:
        return jsonify({"error": f"scopes ausentes: {', '.join(missing_scopes)}"}), 400

    user_expires_at = None
    raw_expires = profile.get("expires_at")
    if raw_expires:
        try:
            user_expires_at = datetime.fromisoformat(str(raw_expires))
        except Exception:
            user_expires_at = None

    long_token, long_expires_at = _exchange_long_lived_user_token(access_token)
    effective_user_token = long_token or access_token
    if long_expires_at:
        user_expires_at = long_expires_at

    try:
        pages = _fetch_user_pages_and_tokens(effective_user_token)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao listar paginas para token do usuario %s", user.get("id"))
        return jsonify({"error": "could not fetch pages for this token"}), 502

    selected_page = None
    if preferred_page_id:
        for page in pages:
            if str(page.get("id")) == preferred_page_id:
                selected_page = page
                break
    if not selected_page and pages:
        selected_page = pages[0]

    if not selected_page or not selected_page.get("access_token"):
        return jsonify({"error": "nenhuma pagina com access_token retornada para este token"}), 400

    try:
        saved = _persist_meta_user_token(
            user["id"],
            profile.get("facebook_id") or profile.get("id") or "",
            scopes,
            effective_user_token,
            user_expires_at,
            selected_page.get("access_token"),
            selected_page.get("id") or "",
            selected_page.get("instagram_user_id") or "",
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao persistir token Meta do usuario %s", user.get("id"))
        return jsonify({"error": "could not persist meta token"}), 500

    response = {
        "pageId": saved.get("page_id"),
        "instagramUserId": saved.get("instagram_user_id"),
        "facebookUserId": saved.get("facebook_user_id"),
        "scopes": saved.get("scopes"),
        "userAccessExpiresAt": saved.get("user_access_expires_at_iso"),
    }
    return jsonify(response), 201


@app.get("/api/auth/session")
def auth_session() -> Any:
    token = _extract_bearer_token(request)
    if not token:
        return jsonify({"error": "missing token"}), 401

    user_id = _decode_auth_token(token)
    if not user_id:
        return jsonify({"error": "invalid or expired token"}), 401

    user_row = _fetch_user_by_id(user_id)
    if not user_row:
        return jsonify({"error": "user not found"}), 404

    return jsonify({"token": token, "user": _serialize_user_row(user_row)})


@app.get("/api/covers")
def get_social_cover() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error

    platform = str(request.args.get("platform") or "instagram").strip().lower()
    account_id = str(request.args.get("account_id") or request.args.get("accountId") or "").strip()
    if not account_id:
        return jsonify({"error": "account_id is required"}), 400
    if platform not in ALLOWED_COVER_PLATFORMS:
        return jsonify({"error": "invalid platform"}), 400

    try:
        cover_row = _fetch_social_cover(account_id, platform)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to fetch cover for %s/%s", platform, account_id)
        return jsonify({"error": "could not load cover"}), 500

    return jsonify({"cover": _serialize_cover_row(cover_row)})


@app.post("/api/covers")
def upsert_social_cover() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    platform = str(payload.get("platform") or "instagram").strip().lower()
    account_id = str(payload.get("account_id") or payload.get("accountId") or "").strip()
    data_url = str(payload.get("data_url") or payload.get("dataUrl") or "").strip()
    content_type = str(payload.get("content_type") or payload.get("contentType") or "").strip() or None
    size_bytes = payload.get("size_bytes") or payload.get("sizeBytes")

    if not account_id:
        return jsonify({"error": "account_id is required"}), 400
    if platform not in ALLOWED_COVER_PLATFORMS:
        return jsonify({"error": "invalid platform"}), 400
    if not data_url:
        return jsonify({"error": "data_url is required"}), 400
    if not data_url.startswith("data:image/"):
        return jsonify({"error": "data_url must be a data:image/* base64 string"}), 400

    estimated_size = _estimate_data_url_size_bytes(data_url)
    size_int = None
    try:
        if size_bytes is not None:
            size_int = int(size_bytes)
    except (TypeError, ValueError):
        size_int = None
    size_int = size_int or estimated_size
    if size_int > COVER_MAX_BYTES:
        return jsonify({"error": f"imagem excede o limite de {COVER_MAX_BYTES // 1024} KB"}), 400

    if not content_type:
        match = re.match(r"data:(.*?);base64,", data_url)
        if match:
            content_type = match.group(1)

    try:
        cover_row = _upsert_social_cover(
            account_id=account_id,
            platform=platform,
            storage_url=data_url,
            content_type=content_type,
            size_bytes=size_int,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to save cover for %s/%s", platform, account_id)
        return jsonify({"error": "could not save cover"}), 500

    return jsonify({"cover": _serialize_cover_row(cover_row)}), 201


@app.delete("/api/covers")
def delete_social_cover_route() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error

    platform = str(request.args.get("platform") or "instagram").strip().lower()
    account_id = str(request.args.get("account_id") or request.args.get("accountId") or "").strip()
    if not account_id:
        return jsonify({"error": "account_id is required"}), 400
    if platform not in ALLOWED_COVER_PLATFORMS:
        return jsonify({"error": "invalid platform"}), 400

    try:
        _delete_social_cover(account_id, platform)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to delete cover for %s/%s", platform, account_id)
        return jsonify({"error": "could not delete cover"}), 500

    return jsonify({"success": True})


@app.get("/api/admin/users")
def admin_list_users() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error
    if user.get("role") != "admin":
        return jsonify({"error": "forbidden"}), 403
    try:
        rows = _list_app_users()
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to fetch user list")
        return jsonify({"error": "could not load users"}), 500
    return jsonify({"users": rows})


@app.patch("/api/admin/users/<user_id>")
def admin_update_user(user_id: str) -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error
    if user.get("role") != "admin":
        return jsonify({"error": "forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    next_role = str(payload.get("role") or "").strip().lower()
    if next_role not in VALID_USER_ROLES:
        return jsonify({"error": "invalid role"}), 400
    if user_id == user.get("id"):
        return jsonify({"error": "cannot update own role"}), 400
    if not _fetch_user_by_id(user_id):
        return jsonify({"error": "user not found"}), 404

    try:
        _update_app_user_role(user_id, next_role)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to update role for %s", user_id)
        return jsonify({"error": "could not update role"}), 500
    return jsonify({"success": True})


@app.delete("/api/admin/users/<user_id>")
def admin_delete_user(user_id: str) -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error
    if user.get("role") != "admin":
        return jsonify({"error": "forbidden"}), 403
    if user_id == user.get("id"):
        return jsonify({"error": "cannot delete own user"}), 400
    if not _fetch_user_by_id(user_id):
        return jsonify({"error": "user not found"}), 404

    try:
        _delete_app_user(user_id)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to delete user %s", user_id)
        return jsonify({"error": "could not delete user"}), 500
    return jsonify({"success": True})


@app.get("/api/report-templates")
def list_report_templates() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error
    try:
        rows = fetch_all(
            f"""
            SELECT id, name, description, default_params, created_at
            FROM {REPORT_TEMPLATES_TABLE}
            ORDER BY created_at DESC NULLS LAST
            """
        ) or []
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to load report templates")
        return jsonify({"error": "could not load templates"}), 500
    return jsonify({"templates": rows})


@app.get("/api/reports")
def list_reports() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error
    try:
        rows = fetch_all(
            f"""
            SELECT id, name, template_id, params, created_by, created_at
            FROM {REPORTS_TABLE}
            ORDER BY created_at DESC NULLS LAST
            """
        ) or []
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to load reports")
        return jsonify({"error": "could not load reports"}), 500
    return jsonify({"reports": rows})


@app.post("/api/reports")
def create_report() -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    template_id = str(
        payload.get("template_id") or payload.get("templateId") or ""
    ).strip()
    params_payload = payload.get("params") or {}

    if not name:
        return jsonify({"error": "name is required"}), 400
    if not template_id:
        return jsonify({"error": "template_id is required"}), 400
    if not isinstance(params_payload, dict):
        params_payload = {}

    report_id = str(uuid.uuid4())
    try:
        execute(
            f"""
            INSERT INTO {REPORTS_TABLE} (id, name, template_id, params, created_by)
            VALUES (%(id)s, %(name)s, %(template_id)s, %(params)s, %(created_by)s)
            """,
            {
                "id": report_id,
                "name": name,
                "template_id": template_id,
                "params": Json(params_payload),
                "created_by": user.get("id"),
            },
        )
        created = fetch_one(
            f"""
            SELECT id, name, template_id, params, created_by, created_at
            FROM {REPORTS_TABLE}
            WHERE id = %(id)s
            """,
            {"id": report_id},
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to create report")
        return jsonify({"error": "could not create report"}), 500

    return jsonify({"report": created}), 201


@app.delete("/api/reports/<report_id>")
def delete_report(report_id: str) -> Any:
    user, error = _authenticate_request(request)
    if error:
        return error

    params = {"id": report_id}
    query = f"DELETE FROM {REPORTS_TABLE} WHERE id = %(id)s"
    if user.get("role") != "admin":
        query += " AND created_by = %(created_by)s"
        params["created_by"] = user.get("id")

    try:
        execute(query, params)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to delete report %s", report_id)
        return jsonify({"error": "could not delete report"}), 500

    return jsonify({"success": True})

@app.post("/api/instagram/comments/ingest")
def ingest_comments_api() -> Any:
    """
    Força ingestão de comentários do Instagram (últimos N dias) para um igUserId.
    Útil para popular a nuvem de palavras.
    """
    user, error = _authenticate_request(request)
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    ig_user_id = str(payload.get("igUserId") or payload.get("ig_user_id") or IG_ID or "").strip()
    days = int(payload.get("days") or COMMENTS_INGEST_DEFAULT_DAYS)
    days = max(1, min(90, days))

    if not ig_user_id:
        return jsonify({"error": "igUserId is required"}), 400

    try:
        medias, inserted, updated = ingest_account_comments(ig_user_id, days=days)
    except MetaAPIError as err:
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao ingerir comentários para %s", ig_user_id)
        return jsonify({"error": "could not ingest comments"}), 500

    return jsonify({
        "igUserId": ig_user_id,
        "days": days,
        "medias": medias,
        "inserted": inserted,
        "updated": updated,
    }), 202


@app.get("/api/facebook/metrics")
def facebook_metrics():
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500
    since, until = unix_range(request.args)
    force_refresh = request.args.get("force")
    force_refresh_flag = str(force_refresh).lower() in ("1", "true", "yes", "y")
    lite_param = request.args.get("lite")
    lite_flag = str(lite_param).lower() in ("1", "true", "yes", "y")
    extra = {"lite": True} if lite_flag else None

    def _extract_engagement_total(payload_obj):
        for metric in payload_obj.get("metrics") or []:
            if isinstance(metric, dict) and metric.get("key") == "post_engagement_total":
                try:
                    return float(metric.get("value") or 0)
                except (TypeError, ValueError):
                    return 0.0
        engagement = payload_obj.get("engagement") or {}
        if isinstance(engagement, dict):
            try:
                return float(engagement.get("total") or 0)
            except (TypeError, ValueError):
                return 0.0
        return 0.0

    def _extract_content_activity_total(payload_obj):
        for metric in payload_obj.get("metrics") or []:
            if isinstance(metric, dict) and metric.get("key") == "content_activity":
                try:
                    return float(metric.get("value") or 0)
                except (TypeError, ValueError):
                    return 0.0
        page_overview = payload_obj.get("page_overview") or {}
        if isinstance(page_overview, dict):
            try:
                return float(page_overview.get("content_activity") or 0)
            except (TypeError, ValueError):
                return 0.0
        return 0.0

    def _has_follow_type_breakdown(payload_obj):
        breakdown = payload_obj.get("page_interactions_by_follow_type")
        if not isinstance(breakdown, dict):
            overview = payload_obj.get("page_overview") or {}
            if isinstance(overview, dict):
                breakdown = overview.get("page_interactions_by_follow_type")
        if not isinstance(breakdown, dict):
            all_breakdowns = payload_obj.get("breakdowns") or {}
            if isinstance(all_breakdowns, dict):
                breakdown = all_breakdowns.get("page_interactions_follow_type")
        if not isinstance(breakdown, dict):
            return False
        try:
            followers = float(breakdown.get("followers") or 0)
        except (TypeError, ValueError):
            followers = 0.0
        try:
            non_followers = float(
                breakdown.get("non_followers")
                if breakdown.get("non_followers") is not None
                else (breakdown.get("nonFollowers") or 0),
            )
        except (TypeError, ValueError):
            non_followers = 0.0
        return followers > 0 or non_followers > 0
    try:
        if force_refresh_flag:
            payload = fetch_facebook_metrics(page_id, since, until, extra)
            meta = {
                "source": "live",
                "fetched_at": _utc_now_iso(),
                "next_refresh_at": None,
                "stale": False,
                "cache_key": None,
                "forced": True,
            }
        else:
            payload, meta = get_cached_payload(
                "facebook_metrics",
                page_id,
                since,
                until,
                extra=extra,
                fetcher=fetch_facebook_metrics,
                platform="facebook",
            )
    except MetaAPIError as err:
        mark_cache_error("facebook_metrics", page_id, since, until, extra, err.args[0], platform="facebook")
        payload = {
            "error": err.args[0],
            "graph": {
                "status": err.status,
                "code": err.code,
                "type": err.error_type,
            },
            "meta": {
                "source": _map_sync_source(None),
                "sync": _build_sync_meta(None),
            },
        }
        return jsonify(payload), 502
    except ValueError as err:
        payload = {
            "error": str(err),
            "meta": {
                "source": _map_sync_source(None),
                "sync": _build_sync_meta(None),
            },
        }
        return jsonify(payload), 400

    payload_obj = dict(payload or {})
    _enrich_facebook_metrics_payload(payload_obj)

    # Normaliza reach_timeseries sem forçar nova chamada à Meta API (evita bypass do cache).
    if not payload_obj.get("reach_timeseries"):
        page_overview = payload_obj.get("page_overview") or {}
        if isinstance(page_overview, dict) and isinstance(page_overview.get("reach_timeseries"), list):
            payload_obj["reach_timeseries"] = page_overview.get("reach_timeseries")
    if not payload_obj.get("engagement_timeseries"):
        page_overview = payload_obj.get("page_overview") or {}
        if isinstance(page_overview, dict) and isinstance(page_overview.get("engagement_timeseries"), list):
            payload_obj["engagement_timeseries"] = page_overview.get("engagement_timeseries")

    # Alguns caches antigos podem ter engajamento total mas sem série diária.
    # Para garantir o gráfico "Crescimento do conteúdo", força refresh quando necessário.
    if (
        not force_refresh_flag
        and not lite_flag
        and not payload_obj.get("engagement_timeseries")
        and _extract_engagement_total(payload_obj) > 0
    ):
        try:
            refreshed_payload, refreshed_meta = get_cached_payload(
                "facebook_metrics",
                page_id,
                since,
                until,
                extra=extra,
                fetcher=fetch_facebook_metrics,
                platform="facebook",
                force=True,
                refresh_reason="missing_engagement_timeseries",
            )
            payload_obj = dict(refreshed_payload or {})
            _enrich_facebook_metrics_payload(payload_obj)
            if not payload_obj.get("reach_timeseries"):
                page_overview = payload_obj.get("page_overview") or {}
                if isinstance(page_overview, dict) and isinstance(page_overview.get("reach_timeseries"), list):
                    payload_obj["reach_timeseries"] = page_overview.get("reach_timeseries")
            if not payload_obj.get("engagement_timeseries"):
                page_overview = payload_obj.get("page_overview") or {}
                if isinstance(page_overview, dict) and isinstance(page_overview.get("engagement_timeseries"), list):
                    payload_obj["engagement_timeseries"] = page_overview.get("engagement_timeseries")
            meta = refreshed_meta
        except Exception as refresh_err:  # noqa: BLE001
            logger.warning("Falha ao forçar refresh para completar engagement_timeseries: %s", refresh_err)
    if (
        not force_refresh_flag
        and not lite_flag
        and not _has_follow_type_breakdown(payload_obj)
        and (
            _extract_content_activity_total(payload_obj) > 0
            or _extract_engagement_total(payload_obj) > 0
        )
    ):
        try:
            refreshed_payload, refreshed_meta = get_cached_payload(
                "facebook_metrics",
                page_id,
                since,
                until,
                extra=extra,
                fetcher=fetch_facebook_metrics,
                platform="facebook",
                force=True,
                refresh_reason="missing_page_interactions_follow_type",
            )
            payload_obj = dict(refreshed_payload or {})
            _enrich_facebook_metrics_payload(payload_obj)
            if not payload_obj.get("reach_timeseries"):
                page_overview = payload_obj.get("page_overview") or {}
                if isinstance(page_overview, dict) and isinstance(page_overview.get("reach_timeseries"), list):
                    payload_obj["reach_timeseries"] = page_overview.get("reach_timeseries")
            if not payload_obj.get("engagement_timeseries"):
                page_overview = payload_obj.get("page_overview") or {}
                if isinstance(page_overview, dict) and isinstance(page_overview.get("engagement_timeseries"), list):
                    payload_obj["engagement_timeseries"] = page_overview.get("engagement_timeseries")
            meta = refreshed_meta
        except Exception as refresh_err:  # noqa: BLE001
            logger.warning("Falha ao forcar refresh para page_interactions_follow_type: %s", refresh_err)

    response = dict(payload_obj)
    response["cache"] = meta
    response["meta"] = {
        "source": _map_sync_source(meta),
        "sync": _build_sync_meta(meta),
    }
    response["error"] = None
    return jsonify(response)


@app.get("/api/facebook/page-info")
def facebook_page_info():
    user, error = _authenticate_request(request)
    if error:
        return error
    page_id = request.args.get("pageId") or PAGE_ID
    if not page_id:
        return jsonify({"error": "pageId is required"}), 400
    try:
        data = _fetch_facebook_page_info(page_id)
    except MetaAPIError as err:
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to fetch page info for %s", page_id)
        return jsonify({"error": "could not load page info"}), 500
    return jsonify({"page": data})


@app.get("/api/facebook/followers")
def facebook_followers():
    """
    Retorna apenas o total de seguidores da página do Facebook para o período solicitado.
    Consulta diretamente a Meta API sem usar o cache mantido no Postgres.
    """
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500
    since, until = unix_range(request.args)
    try:
        payload, meta = get_cached_payload(
            "facebook_metrics",
            page_id,
            since,
            until,
            fetcher=fetch_facebook_metrics,
            platform="facebook",
        )
    except MetaAPIError as err:
        mark_cache_error("facebook_metrics", page_id, since, until, None, err.args[0], platform="facebook")
        return meta_error_response(err)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    payload = dict(payload or {})
    _enrich_facebook_metrics_payload(payload)

    followers_metric = None
    for metric in payload.get("metrics") or []:
        if isinstance(metric, dict) and metric.get("key") == "followers_total":
            followers_metric = metric
            break

    if followers_metric is None:
        page_overview = payload.get("page_overview") or {}
        followers_value = page_overview.get("followers_total")
        followers_metric = {
            "key": "followers_total",
            "label": "Seguidores da pagina",
            "value": followers_value,
            "deltaPct": None,
        }

    response = {
        "since": payload.get("since") or since,
        "until": payload.get("until") or until,
        "followers": followers_metric,
    }
    response["cache"] = meta
    return jsonify(response)


@app.get("/api/facebook/reach")
def facebook_reach():
    """
    Retorna apenas a métrica de alcance da página do Facebook para o período solicitado.
    Consulta diretamente a Meta API sem usar o cache mantido no Postgres.
    """
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500
    since, until = unix_range(request.args)
    try:
        payload, meta = get_cached_payload(
            "facebook_metrics",
            page_id,
            since,
            until,
            fetcher=fetch_facebook_metrics,
            platform="facebook",
        )
    except MetaAPIError as err:
        mark_cache_error("facebook_metrics", page_id, since, until, None, err.args[0], platform="facebook")
        return meta_error_response(err)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    payload = dict(payload or {})
    _enrich_facebook_metrics_payload(payload)
    reach_metric = None
    for metric in payload.get("metrics") or []:
        if isinstance(metric, dict) and metric.get("key") == "reach":
            reach_metric = metric
            break

    response = {
        "since": payload.get("since") or since,
        "until": payload.get("until") or until,
        "reach": reach_metric,
    }
    response["cache"] = meta
    return jsonify(response)


@app.get("/api/facebook/posts")
def facebook_posts():
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500
    since, until = unix_range(request.args)
    limit_param = request.args.get("limit")
    try:
        limit = int(limit_param) if limit_param is not None else 6
    except ValueError:
        limit = 6
    payload: Any = None
    meta: Dict[str, Any] = {}
    try:
        payload, meta = get_cached_payload(
            "facebook_posts",
            page_id,
            since,
            until,
            extra={"limit": limit},
            fetcher=fetch_facebook_posts,
            platform="facebook",
        )
    except MetaAPIError as err:
        mark_cache_error("facebook_posts", page_id, since, until, {"limit": limit}, err.args[0], platform="facebook")
        fallback = get_latest_cached_payload(
            "facebook_posts",
            page_id,
            extra={"limit": limit},
            platform="facebook",
        )
        if not fallback:
            fallback = get_latest_cached_payload("facebook_posts", page_id, platform="facebook")
        if not fallback:
            return meta_error_response(err)
        payload, meta = fallback
        meta = dict(meta or {})
        meta["fallback_error"] = err.args[0] if err.args else "Meta API error"
        meta["fallback_reason"] = "meta_api_error"
        meta["requested_since"] = since
        meta["requested_until"] = until
        meta["requested_limit"] = limit
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em facebook_posts")
        fallback = get_latest_cached_payload(
            "facebook_posts",
            page_id,
            extra={"limit": limit},
            platform="facebook",
        )
        if not fallback:
            fallback = get_latest_cached_payload("facebook_posts", page_id, platform="facebook")
        if not fallback:
            return jsonify({"error": "Nao foi possivel carregar os posts do Facebook."}), 500
        payload, meta = fallback
        meta = dict(meta or {})
        meta["fallback_error"] = str(err)
        meta["fallback_reason"] = "unexpected_error"
        meta["requested_since"] = since
        meta["requested_until"] = until
        meta["requested_limit"] = limit

    if isinstance(payload, dict):
        response = dict(payload)
    elif isinstance(payload, list):
        response = {"posts": payload}
    else:
        response = {"posts": []}
    if "posts" not in response and isinstance(response.get("data"), list):
        response["posts"] = response.get("data")
    if not isinstance(response.get("posts"), list):
        response["posts"] = []
    response["cache"] = meta
    return jsonify(response)


@app.get("/api/facebook/audience")
def facebook_audience():
    """
    Retorna dados demográficos do Facebook (cidades, países, idade, gênero).
    Usa o cache armazenado no Postgres e fallback em caso de erro da API.
    """
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500
    force_refresh = request.args.get("force")
    force_refresh_flag = str(force_refresh).lower() in ("1", "true", "yes", "y")

    def _has_audience_values(payload_obj):
        if not isinstance(payload_obj, dict):
            return False
        totals = payload_obj.get("totals") or {}
        if isinstance(totals, dict):
            for key in ("cities", "ages", "gender"):
                try:
                    if float(totals.get(key) or 0) > 0:
                        return True
                except (TypeError, ValueError):
                    continue
        for key in ("cities", "ages", "gender"):
            rows = payload_obj.get(key) or []
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                try:
                    if float(row.get("value") or 0) > 0:
                        return True
                except (TypeError, ValueError):
                    continue
        return False

    try:
        payload, meta = get_cached_payload(
            "facebook_audience",
            page_id,
            None,
            None,
            fetcher=fetch_facebook_audience,
            force=force_refresh_flag,
            refresh_reason="forced" if force_refresh_flag else None,
            platform="facebook",
        )
        if not force_refresh_flag and not _has_audience_values(payload):
            refreshed_payload, refreshed_meta = get_cached_payload(
                "facebook_audience",
                page_id,
                None,
                None,
                fetcher=fetch_facebook_audience,
                force=True,
                refresh_reason="missing_audience_breakdown",
                platform="facebook",
            )
            payload = refreshed_payload
            meta = refreshed_meta
    except MetaAPIError as err:
        mark_cache_error("facebook_audience", page_id, None, None, None, err.args[0], platform="facebook")
        # Tentar fallback com último cache disponível
        fallback = get_latest_cached_payload("facebook_audience", page_id, platform="facebook")
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0]
            meta["fallback_reason"] = "meta_api_error"
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em facebook_audience")
        fallback = get_latest_cached_payload("facebook_audience", page_id, platform="facebook")
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return jsonify({"error": str(err)}), 500

    response = dict(payload)
    response["cache"] = meta
    return jsonify(response)


# ============== INSTAGRAM (ORGÂNICO) ==============

@app.get("/api/instagram/metrics")
def instagram_metrics():
    """
    Cards orgânicos (conta) — usa cache do Postgres antes de acessar a Graph API.
    """
    ig = request.args.get("igUserId", IG_ID)
    if not ig:
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig or ""),
            since=None,
            until=None,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                "META_IG_USER_ID is not configured",
                code="missing_account_id",
            ),
        )
        return jsonify(envelope), 500
    since, until = unix_range(request.args)
    force_refresh = request.args.get("force")
    force_refresh_flag = str(force_refresh).lower() in ("1", "true", "yes", "y")

    def _extract_reach_total(payload_obj):
        for metric in payload_obj.get("metrics") or []:
            if isinstance(metric, dict) and metric.get("key") == "reach":
                try:
                    return float(metric.get("value") or 0)
                except (TypeError, ValueError):
                    return 0.0
        return 0.0

    def _ensure_reach_timeseries(payload_obj):
        if payload_obj.get("reach_timeseries"):
            return
        for metric in payload_obj.get("metrics") or []:
            if isinstance(metric, dict) and metric.get("key") == "reach":
                series = metric.get("timeseries")
                if isinstance(series, list) and series:
                    payload_obj["reach_timeseries"] = series
                return

    allow_partial = INSTAGRAM_METRICS_ALLOW_PARTIAL
    min_ratio = INSTAGRAM_METRICS_PARTIAL_MIN_RATIO
    min_days = INSTAGRAM_METRICS_PARTIAL_MIN_DAYS

    try:
        db_payload = build_instagram_metrics_from_db(
            ig,
            since,
            until,
            allow_partial=allow_partial,
            min_coverage_ratio=min_ratio,
            min_coverage_days=min_days,
        )
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha ao montar métricas via %s", IG_METRICS_TABLE, exc_info=err)
        db_payload = None
    if db_payload:
        payload_obj = dict(db_payload)
        _ensure_reach_timeseries(payload_obj)
        coverage = payload_obj.get("coverage") if isinstance(payload_obj.get("coverage"), dict) else {}
        has_full_coverage = bool(coverage.get("has_full_coverage"))
        if not has_full_coverage:
            _schedule_instagram_metrics_backfill(ig, _unix_to_date(since), _unix_to_date(until))

        legacy_cache = payload_obj.get("cache") if isinstance(payload_obj.get("cache"), dict) else {}
        precomputed_cache = {
            "source": "db" if has_full_coverage else "db_partial",
            "stale": False,
            "fetched_at": legacy_cache.get("fetched_at") or _utc_now_iso(),
            "next_refresh_at": None,
            "cache_key": None,
            "partial": not has_full_coverage,
            "coverage": coverage,
        }
        envelope = _build_api_envelope(
            payload_obj,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=precomputed_cache,
            error=None,
        )
        return jsonify(envelope)

    try:
        payload, meta = get_cached_payload(
            "instagram_metrics",
            ig,
            since,
            until,
            fetcher=fetch_instagram_metrics,
            platform=DEFAULT_CACHE_PLATFORM,
            force=force_refresh_flag,
            refresh_reason="forced" if force_refresh_flag else None,
        )
    except MetaAPIError as err:
        mark_cache_error("instagram_metrics", ig, since, until, None, err.args[0], platform=DEFAULT_CACHE_PLATFORM)
        fallback = get_latest_cached_payload("instagram_metrics", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0]
            meta["fallback_reason"] = "meta_api_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    err.args[0] if err.args else "Meta API error",
                    code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                    details={
                        **_meta_api_error_details(err),
                        "fallback": True,
                        "fallback_reason": "meta_api_error",
                        "requested_since": since,
                        "requested_until": until,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                err.args[0] if err.args else "Meta API error",
                code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                details={
                    **_meta_api_error_details(err),
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                },
            ),
        )
        return jsonify(envelope), 502
    except ValueError as err:
        fallback = get_latest_cached_payload("instagram_metrics", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else str(err)
            meta["fallback_reason"] = "invalid_range"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    str(err),
                    code="invalid_range",
                    details={
                        "fallback": True,
                        "requested_since": since,
                        "requested_until": until,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                str(err),
                code="invalid_range",
                details={
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                },
            ),
        )
        return jsonify(envelope), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em instagram_metrics")
        fallback = get_latest_cached_payload("instagram_metrics", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    str(err),
                    code="unexpected_error",
                    details={
                        "fallback": True,
                        "requested_since": since,
                        "requested_until": until,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                str(err),
                code="unexpected_error",
                details={
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                },
            ),
        )
        return jsonify(envelope), 500

    payload_obj = dict(payload) if isinstance(payload, dict) else {"payload": payload}
    _ensure_reach_timeseries(payload_obj)

    # Alguns caches antigos podem ter alcance total mas sem série diária.
    # Para garantir o gráfico "Crescimento do perfil", força refresh quando necessário.
    if (
        not force_refresh_flag
        and not payload_obj.get("reach_timeseries")
        and _extract_reach_total(payload_obj) > 0
    ):
        try:
            refreshed_payload, refreshed_meta = get_cached_payload(
                "instagram_metrics",
                ig,
                since,
                until,
                fetcher=fetch_instagram_metrics,
                platform=DEFAULT_CACHE_PLATFORM,
                force=True,
                refresh_reason="missing_reach_timeseries",
            )
            payload_obj = dict(refreshed_payload) if isinstance(refreshed_payload, dict) else {"payload": refreshed_payload}
            meta = refreshed_meta
            _ensure_reach_timeseries(payload_obj)
        except Exception as refresh_err:  # noqa: BLE001
            logger.warning("Falha ao forçar refresh para completar reach_timeseries: %s", refresh_err)

    payload_obj["cache"] = meta
    envelope = _build_api_envelope(
        payload_obj,
        platform="instagram",
        account_id=str(ig),
        since=since,
        until=until,
        timezone_name="UTC",
        cache_meta=meta,
        error=None,
    )
    return jsonify(envelope)

@app.get("/api/instagram/organic")
def instagram_organic():
    """
    Resumo orgânico avançado: usa dados do cache antes de tocar a Graph API.
    """
    ig = request.args.get("igUserId", IG_ID)
    if not ig:
        return jsonify({"error": "META_IG_USER_ID is not configured"}), 500
    since, until = unix_range(request.args)
    try:
        payload, meta = get_cached_payload(
            "instagram_organic",
            ig,
            since,
            until,
            fetcher=fetch_instagram_organic,
            platform=DEFAULT_CACHE_PLATFORM,
        )
    except MetaAPIError as err:
        mark_cache_error("instagram_organic", ig, since, until, None, err.args[0], platform=DEFAULT_CACHE_PLATFORM)
        fallback = get_latest_cached_payload("instagram_organic", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0]
            meta["fallback_reason"] = "meta_api_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return meta_error_response(err)
    except ValueError as err:
        fallback = get_latest_cached_payload("instagram_organic", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else str(err)
            meta["fallback_reason"] = "invalid_range"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return jsonify({"error": str(err)}), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em instagram_organic")
        fallback = get_latest_cached_payload("instagram_organic", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return jsonify({"error": str(err)}), 500

    response = dict(payload)
    response["cache"] = meta
    return jsonify(response)

@app.get("/api/instagram/audience")
def instagram_audience():
    ig = request.args.get("igUserId", IG_ID)
    if not ig:
        return jsonify({"error": "META_IG_USER_ID is not configured"}), 500
    timeframe = normalize_ig_audience_timeframe(request.args.get("timeframe"))
    since_ts = _safe_int(request.args.get("since"))
    until_ts = _safe_int(request.args.get("until"))
    force_refresh = False
    if since_ts is not None and until_ts is not None:
        diff_days = int((until_ts - since_ts) / 86_400) + 1
        if diff_days > 7:
            force_refresh = True
    try:
        payload, meta = get_cached_payload(
            "instagram_audience",
            ig,
            since_ts,
            until_ts,
            extra={"timeframe": timeframe},
            fetcher=fetch_instagram_audience,
            force=force_refresh,
            platform=DEFAULT_CACHE_PLATFORM,
        )
    except MetaAPIError as err:
        mark_cache_error(
            "instagram_audience",
            ig,
            None,
            None,
            {"timeframe": timeframe},
            err.args[0],
            platform=DEFAULT_CACHE_PLATFORM,
        )
        fallback = get_latest_cached_payload(
            "instagram_audience",
            ig,
            extra={"timeframe": timeframe},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0]
            meta["fallback_reason"] = "meta_api_error"
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em instagram_audience")
        fallback = get_latest_cached_payload(
            "instagram_audience",
            ig,
            extra={"timeframe": timeframe},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            return jsonify(response)
        return jsonify({"error": str(err)}), 500
    response = dict(payload)
    response["cache"] = meta
    return jsonify(response)

@app.get("/api/instagram/posts")
def instagram_posts():
    ig = request.args.get("igUserId", IG_ID)
    if not ig:
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig or ""),
            since=None,
            until=None,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                "META_IG_USER_ID is not configured",
                code="missing_account_id",
            ),
        )
        return jsonify(envelope), 500
    limit_param = request.args.get("limit")
    try:
        limit = int(limit_param) if limit_param is not None else 6
    except ValueError:
        limit = 6
    force_refresh = request.args.get("force")
    force_refresh_flag = str(force_refresh).lower() in ("1", "true", "yes", "y")
    if not force_refresh_flag:
        latest = get_latest_cached_payload(
            "instagram_posts",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if latest:
            _, latest_meta = latest
            if _should_force_daily_refresh(latest_meta.get("fetched_at"), _resolve_cache_timezone()):
                force_refresh_flag = True
    try:
        payload, meta = get_cached_payload(
            "instagram_posts",
            ig,
            None,
            None,
            extra={"limit": limit},
            fetcher=fetch_instagram_posts,
            platform=DEFAULT_CACHE_PLATFORM,
            force=force_refresh_flag,
            refresh_reason="daily_refresh" if force_refresh_flag else None,
        )
    except MetaAPIError as err:
        mark_cache_error("instagram_posts", ig, None, None, {"limit": limit}, err.args[0], platform=DEFAULT_CACHE_PLATFORM)
        fallback = get_latest_cached_payload(
            "instagram_posts",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if not fallback:
            fallback = get_latest_cached_payload("instagram_posts", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else "Meta API error"
            meta["fallback_reason"] = "meta_api_error"
            meta["requested_limit"] = limit
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=None,
                until=None,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    err.args[0] if err.args else "Meta API error",
                    code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                    details={
                        **_meta_api_error_details(err),
                        "fallback": True,
                        "fallback_reason": "meta_api_error",
                        "requested_limit": limit,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=None,
            until=None,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                err.args[0] if err.args else "Meta API error",
                code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                details={
                    **_meta_api_error_details(err),
                    "fallback": False,
                    "requested_limit": limit,
                },
            ),
        )
        return jsonify(envelope), 502
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em instagram_posts")
        fallback = get_latest_cached_payload(
            "instagram_posts",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if not fallback:
            fallback = get_latest_cached_payload("instagram_posts", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            meta["requested_limit"] = limit
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=None,
                until=None,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    str(err),
                    code="unexpected_error",
                    details={
                        "fallback": True,
                        "requested_limit": limit,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=None,
            until=None,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                str(err),
                code="unexpected_error",
                details={
                    "fallback": False,
                    "requested_limit": limit,
                },
            ),
        )
        return jsonify(envelope), 500
    response = dict(payload)
    response["cache"] = meta
    envelope = _build_api_envelope(
        response,
        platform="instagram",
        account_id=str(ig),
        since=None,
        until=None,
        timezone_name="UTC",
        cache_meta=meta,
        error=None,
    )
    return jsonify(envelope)


@app.get("/api/instagram/posts/insights")
def instagram_posts_insights():
    ig = request.args.get("igUserId", IG_ID)
    if not ig:
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig or ""),
            since=None,
            until=None,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                "META_IG_USER_ID is not configured",
                code="missing_account_id",
            ),
        )
        return jsonify(envelope), 500
    since, until = unix_range(request.args)
    limit_param = request.args.get("limit")
    try:
        limit = int(limit_param) if limit_param is not None else 5
    except ValueError:
        limit = 5
    try:
        payload, meta = get_cached_payload(
            "instagram_posts_insights",
            ig,
            since,
            until,
            extra={"limit": limit},
            fetcher=fetch_instagram_posts_insights,
            platform=DEFAULT_CACHE_PLATFORM,
        )
    except MetaAPIError as err:
        mark_cache_error(
            "instagram_posts_insights",
            ig,
            since,
            until,
            {"limit": limit},
            err.args[0],
            platform=DEFAULT_CACHE_PLATFORM,
        )
        fallback = get_latest_cached_payload(
            "instagram_posts_insights",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if not fallback:
            fallback = get_latest_cached_payload("instagram_posts_insights", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else "Meta API error"
            meta["fallback_reason"] = "meta_api_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            meta["requested_limit"] = limit
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    err.args[0] if err.args else "Meta API error",
                    code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                    details={
                        **_meta_api_error_details(err),
                        "fallback": True,
                        "fallback_reason": "meta_api_error",
                        "requested_since": since,
                        "requested_until": until,
                        "requested_limit": limit,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                err.args[0] if err.args else "Meta API error",
                code=err.code if err.code is not None else (err.error_type or "meta_api_error"),
                details={
                    **_meta_api_error_details(err),
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                    "requested_limit": limit,
                },
            ),
        )
        return jsonify(envelope), 502
    except ValueError as err:
        fallback = get_latest_cached_payload(
            "instagram_posts_insights",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if not fallback:
            fallback = get_latest_cached_payload("instagram_posts_insights", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "invalid_range"
            meta["requested_since"] = since
            meta["requested_until"] = until
            meta["requested_limit"] = limit
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    str(err),
                    code="invalid_range",
                    details={
                        "fallback": True,
                        "requested_since": since,
                        "requested_until": until,
                        "requested_limit": limit,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                str(err),
                code="invalid_range",
                details={
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                    "requested_limit": limit,
                },
            ),
        )
        return jsonify(envelope), 400
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em instagram_posts_insights")
        fallback = get_latest_cached_payload(
            "instagram_posts_insights",
            ig,
            extra={"limit": limit},
            platform=DEFAULT_CACHE_PLATFORM,
        )
        if not fallback:
            fallback = get_latest_cached_payload("instagram_posts_insights", ig, platform=DEFAULT_CACHE_PLATFORM)
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            meta["requested_since"] = since
            meta["requested_until"] = until
            meta["requested_limit"] = limit
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _build_api_envelope(
                response,
                platform="instagram",
                account_id=str(ig),
                since=since,
                until=until,
                timezone_name="UTC",
                cache_meta=meta,
                error=_build_api_error(
                    str(err),
                    code="unexpected_error",
                    details={
                        "fallback": True,
                        "requested_since": since,
                        "requested_until": until,
                        "requested_limit": limit,
                    },
                ),
            )
            return jsonify(envelope)
        envelope = _build_api_envelope(
            None,
            platform="instagram",
            account_id=str(ig),
            since=since,
            until=until,
            timezone_name="UTC",
            cache_meta=None,
            error=_build_api_error(
                str(err),
                code="unexpected_error",
                details={
                    "fallback": False,
                    "requested_since": since,
                    "requested_until": until,
                    "requested_limit": limit,
                },
            ),
        )
        return jsonify(envelope), 500
    response = dict(payload)
    response["cache"] = meta
    envelope = _build_api_envelope(
        response,
        platform="instagram",
        account_id=str(ig),
        since=since,
        until=until,
        timezone_name="UTC",
        cache_meta=meta,
        error=None,
    )
    return jsonify(envelope)


def _parse_date_param(value: Optional[str]) -> date:
    if not value:
        raise ValueError("missing")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as err:  # pragma: no cover - defensive
        raise ValueError("invalid") from err


@app.get("/api/instagram/comments/wordcloud")
def instagram_comments_wordcloud():
    ig_user_id = request.args.get("igUserId", IG_ID)
    if not ig_user_id:
        return jsonify({"error": "Missing igUserId"}), 400

    top_param = request.args.get("top")
    top_n = WORDCLOUD_DEFAULT_TOP
    if top_param is not None:
        try:
            top_n = int(top_param)
        except ValueError:
            return jsonify({"error": "top must be an integer"}), 400
        top_n = max(1, min(WORDCLOUD_MAX_TOP, top_n))

    today_utc = datetime.now(timezone.utc).date()
    default_since = today_utc - timedelta(days=COMMENTS_INGEST_DEFAULT_DAYS)

    since_param = request.args.get("since")
    until_param = request.args.get("until")

    try:
        since_date = _parse_date_param(since_param) if since_param else default_since
    except ValueError:
        return jsonify({"error": "since must be in YYYY-MM-DD format"}), 400
    try:
        until_date = _parse_date_param(until_param) if until_param else today_utc
    except ValueError:
        return jsonify({"error": "until must be in YYYY-MM-DD format"}), 400

    if since_date > until_date:
        return jsonify({"error": "since cannot be after until"}), 400

    span_days = (until_date - since_date).days
    if span_days > WORDCLOUD_MAX_RANGE_DAYS:
        since_date = until_date - timedelta(days=WORDCLOUD_MAX_RANGE_DAYS)

    since_iso = datetime.combine(since_date, datetime.min.time()).replace(tzinfo=timezone.utc).isoformat()
    until_iso = datetime.combine(until_date, datetime.max.time()).replace(tzinfo=timezone.utc).isoformat()

    client = get_postgres_client()
    if client is None:
        return jsonify({"error": "Database client is not configured"}), 500

    try:
        # Primeiro tenta usar agregados diários
        daily = fetch_daily_wordcloud(client, ig_user_id, since_iso, until_iso)
        counter: Counter[str] = Counter(daily.get("words") or {})
        total_comments_daily = int(daily.get("total_comments") or 0)

        # Se não houver dados diários, busca comentários brutos
        if not counter:
            rows = fetch_comments_for_wordcloud(client, ig_user_id, since_iso, until_iso)
            for row in rows:
                tokens = tokenize_wordcloud_text(str((row or {}).get("text") or ""))
                if tokens:
                    counter.update(tokens)
            total_comments_daily = len(rows)

    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to fetch comments for wordcloud")
        return jsonify({"error": str(err)}), 500

    words_payload = [
        {"word": word, "count": count}
        for word, count in counter.most_common(top_n)
    ]

    response = {
        "igUserId": ig_user_id,
        "since": since_date.isoformat(),
        "until": until_date.isoformat(),
        "total_comments": total_comments_daily,
        "words": words_payload,
    }
    return jsonify(response)


@app.get("/api/instagram/comments/search")
def instagram_comments_search():
    ig_user_id = request.args.get("igUserId", IG_ID)
    if not ig_user_id:
        return jsonify({"error": "Missing igUserId"}), 400

    raw_word = request.args.get("word") or request.args.get("q") or ""
    sanitized_word = sanitize_wordcloud_token(raw_word)
    if not sanitized_word:
        return jsonify({"error": "word is required"}), 400

    today_utc = datetime.now(timezone.utc).date()
    default_since = today_utc - timedelta(days=COMMENTS_INGEST_DEFAULT_DAYS)

    since_param = request.args.get("since")
    until_param = request.args.get("until")

    try:
        since_date = _parse_date_param(since_param) if since_param else default_since
    except ValueError:
        return jsonify({"error": "since must be in YYYY-MM-DD format"}), 400
    try:
        until_date = _parse_date_param(until_param) if until_param else today_utc
    except ValueError:
        return jsonify({"error": "until must be in YYYY-MM-DD format"}), 400

    if since_date > until_date:
        return jsonify({"error": "since cannot be after until"}), 400

    span_days = (until_date - since_date).days
    if span_days > WORDCLOUD_MAX_RANGE_DAYS:
        since_date = until_date - timedelta(days=WORDCLOUD_MAX_RANGE_DAYS)

    limit_param = request.args.get("limit")
    offset_param = request.args.get("offset")
    try:
        limit = int(limit_param) if limit_param is not None else 50
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400
    try:
        offset = int(offset_param) if offset_param is not None else 0
    except ValueError:
        return jsonify({"error": "offset must be an integer"}), 400
    limit = max(1, min(COMMENTS_SEARCH_MAX_LIMIT, limit))
    offset = max(0, offset)

    since_iso = datetime.combine(since_date, datetime.min.time()).replace(tzinfo=timezone.utc).isoformat()
    until_iso = datetime.combine(until_date, datetime.max.time()).replace(tzinfo=timezone.utc).isoformat()

    client = get_postgres_client()
    if client is None:
        return jsonify({"error": "Database client is not configured"}), 500

    try:
        rows = fetch_comments_for_wordcloud(client, ig_user_id, since_iso, until_iso)
        matches: List[Dict[str, Any]] = []
        total_occurrences = 0
        for row in rows:
            text = str((row or {}).get("text") or "")
            tokens = tokenize_wordcloud_text(text)
            if not tokens:
                continue
            occurrences = sum(1 for token in tokens if token == sanitized_word)
            if occurrences <= 0:
                continue
            total_occurrences += occurrences
            matches.append({
                "id": row.get("id"),
                "text": text,
                "timestamp": row.get("timestamp"),
                "username": row.get("username"),
                "like_count": row.get("like_count") or 0,
                "occurrences": occurrences,
            })
        matches.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
        total_comments = len(matches)
        sliced = matches[offset: offset + limit]
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to search comments for wordcloud")
        return jsonify({"error": str(err)}), 500

    return jsonify({
        "igUserId": ig_user_id,
        "word": sanitized_word,
        "since": since_date.isoformat(),
        "until": until_date.isoformat(),
        "total_comments": total_comments,
        "total_occurrences": total_occurrences,
        "limit": limit,
        "offset": offset,
        "comments": sliced,
    })


@app.get("/api/facebook/comments/wordcloud")
def facebook_comments_wordcloud():
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500

    top_param = request.args.get("top")
    top_n = WORDCLOUD_DEFAULT_TOP
    if top_param is not None:
        try:
            top_n = int(top_param)
        except ValueError:
            return jsonify({"error": "top must be an integer"}), 400
        top_n = max(1, min(WORDCLOUD_MAX_TOP, top_n))

    today_utc = datetime.now(timezone.utc).date()
    default_since = today_utc - timedelta(days=COMMENTS_INGEST_DEFAULT_DAYS)

    since_param = request.args.get("since")
    until_param = request.args.get("until")

    try:
        since_date = _parse_date_param(since_param) if since_param else default_since
    except ValueError:
        return jsonify({"error": "since must be in YYYY-MM-DD format"}), 400
    try:
        until_date = _parse_date_param(until_param) if until_param else today_utc
    except ValueError:
        return jsonify({"error": "until must be in YYYY-MM-DD format"}), 400

    if since_date > until_date:
        return jsonify({"error": "since cannot be after until"}), 400

    span_days = (until_date - since_date).days
    if span_days > WORDCLOUD_MAX_RANGE_DAYS:
        since_date = until_date - timedelta(days=WORDCLOUD_MAX_RANGE_DAYS)

    since_dt = datetime.combine(since_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    until_dt = datetime.combine(until_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    try:
        payload = fetch_facebook_comments_for_wordcloud(page_id, since_dt, until_dt)
        comments = payload.get("comments") or []
        meta = payload.get("meta") or {}
        counter: Counter[str] = Counter()
        for comment in comments:
            tokens = tokenize_wordcloud_text(str(comment.get("text") or ""))
            if tokens:
                counter.update(tokens)
    except MetaAPIError as err:
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to fetch Facebook comments for wordcloud")
        return jsonify({"error": str(err)}), 500

    words_payload = [
        {"word": word, "count": count}
        for word, count in counter.most_common(top_n)
    ]

    response = {
        "pageId": page_id,
        "since": since_date.isoformat(),
        "until": until_date.isoformat(),
        "total_comments": len(comments),
        "words": words_payload,
        "meta": meta,
    }
    return jsonify(response)


@app.get("/api/facebook/comments/search")
def facebook_comments_search():
    page_id = request.args.get("pageId", PAGE_ID)
    if not page_id:
        return jsonify({"error": "META_PAGE_ID is not configured"}), 500

    raw_word = request.args.get("word") or request.args.get("q") or ""
    sanitized_word = sanitize_wordcloud_token(raw_word)
    if not sanitized_word:
        return jsonify({"error": "word is required"}), 400

    today_utc = datetime.now(timezone.utc).date()
    default_since = today_utc - timedelta(days=COMMENTS_INGEST_DEFAULT_DAYS)

    since_param = request.args.get("since")
    until_param = request.args.get("until")

    try:
        since_date = _parse_date_param(since_param) if since_param else default_since
    except ValueError:
        return jsonify({"error": "since must be in YYYY-MM-DD format"}), 400
    try:
        until_date = _parse_date_param(until_param) if until_param else today_utc
    except ValueError:
        return jsonify({"error": "until must be in YYYY-MM-DD format"}), 400

    if since_date > until_date:
        return jsonify({"error": "since cannot be after until"}), 400

    span_days = (until_date - since_date).days
    if span_days > WORDCLOUD_MAX_RANGE_DAYS:
        since_date = until_date - timedelta(days=WORDCLOUD_MAX_RANGE_DAYS)

    limit_param = request.args.get("limit")
    offset_param = request.args.get("offset")
    try:
        limit = int(limit_param) if limit_param is not None else 50
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400
    try:
        offset = int(offset_param) if offset_param is not None else 0
    except ValueError:
        return jsonify({"error": "offset must be an integer"}), 400
    limit = max(1, min(COMMENTS_SEARCH_MAX_LIMIT, limit))
    offset = max(0, offset)

    since_dt = datetime.combine(since_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    until_dt = datetime.combine(until_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    try:
        payload = fetch_facebook_comments_for_wordcloud(page_id, since_dt, until_dt)
        comments = payload.get("comments") or []
        meta = payload.get("meta") or {}
        matches: List[Dict[str, Any]] = []
        total_occurrences = 0
        for comment in comments:
            text = str(comment.get("text") or "")
            tokens = tokenize_wordcloud_text(text)
            if not tokens:
                continue
            occurrences = sum(1 for token in tokens if token == sanitized_word)
            if occurrences <= 0:
                continue
            total_occurrences += occurrences
            matches.append({
                "id": comment.get("id"),
                "text": text,
                "timestamp": comment.get("timestamp"),
                "username": comment.get("username"),
                "like_count": comment.get("like_count") or 0,
                "occurrences": occurrences,
            })
        matches.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
        total_comments = len(matches)
        sliced = matches[offset: offset + limit]
    except MetaAPIError as err:
        return meta_error_response(err)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to search Facebook comments for wordcloud")
        return jsonify({"error": str(err)}), 500

    return jsonify({
        "pageId": page_id,
        "word": sanitized_word,
        "since": since_date.isoformat(),
        "until": until_date.isoformat(),
        "total_comments": total_comments,
        "total_occurrences": total_occurrences,
        "limit": limit,
        "offset": offset,
        "comments": sliced,
        "meta": meta,
    })


@app.post("/api/instagram/comments/ingest")
def instagram_comments_ingest_http():
    expected_token = os.getenv("CRON_TOKEN")
    provided_token = request.args.get("token") or request.headers.get("X-Cron-Token")
    if expected_token and expected_token != provided_token:
        return jsonify({"error": "invalid token"}), 403

    ig_user_id = request.args.get("igUserId", IG_ID)
    if not ig_user_id:
        return jsonify({"error": "Missing igUserId"}), 400

    days_param = request.args.get("days")
    try:
        days = int(days_param) if days_param is not None else COMMENTS_INGEST_DEFAULT_DAYS
    except ValueError:
        return jsonify({"error": "days must be an integer"}), 400
    days = max(1, min(WORDCLOUD_MAX_RANGE_DAYS, days))

    try:
        medias_scanned, inserted, updated = ingest_account_comments(ig_user_id, days)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to ingest comments for %s", ig_user_id)
        return jsonify({"error": str(err)}), 500

    return jsonify({
        "igUserId": ig_user_id,
        "days": days,
        "medias_scanned": medias_scanned,
        "inserted": inserted,
        "updated": updated,
    })

@app.get("/api/ads/highlights")
def ads_high():
    act = request.args.get("actId", ACT_ID)
    if not act:
        envelope = _ads_envelope(
            None,
            cache_meta=None,
            error=_ads_error_payload(
                "INTEGRATION_ERROR",
                "META_AD_ACCOUNT_ID is not configured",
            ),
        )
        return jsonify(envelope)

    since_param = request.args.get("since")
    until_param = request.args.get("until")
    since_ts = _iso_to_ts(since_param)
    until_ts = _iso_to_ts(until_param)

    if since_ts is None or until_ts is None:
        until_date = datetime.now(timezone.utc).date()
        since_date = until_date - timedelta(days=7)
        since_ts = _iso_to_ts(since_date.isoformat())
        until_ts = _iso_to_ts(until_date.isoformat())

    try:
        payload, meta = get_cached_payload(
            "ads_highlights",
            act,
            since_ts,
            until_ts,
            fetcher=fetch_ads_highlights,
            platform="ads",
        )
        if (
            isinstance(payload, dict)
            and (not payload.get("spend_series") or not payload.get("campaigns"))
        ):
            payload, meta = get_cached_payload(
                "ads_highlights",
                act,
                since_ts,
                until_ts,
                fetcher=fetch_ads_highlights,
                platform="ads",
                force=True,
                refresh_reason="backfill_spend_series_campaigns",
            )
    except MetaAPIError as err:
        mark_cache_error("ads_highlights", act, since_ts, until_ts, None, err.args[0], platform="ads")
        fallback = get_latest_cached_payload("ads_highlights", act, platform="ads")
        error_payload = _ads_error_payload(
            _ads_error_code_from_meta(err),
            err.args[0] if err.args else None,
        )
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else "Meta API error"
            meta["fallback_reason"] = "meta_api_error"
            meta["requested_since"] = since_ts
            meta["requested_until"] = until_ts
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _ads_envelope(response, cache_meta=meta, error=error_payload)
            return jsonify(envelope)
        envelope = _ads_envelope(None, cache_meta=None, error=error_payload)
        return jsonify(envelope)
    except ValueError as err:
        fallback = get_latest_cached_payload("ads_highlights", act, platform="ads")
        error_payload = _ads_error_payload("INTEGRATION_ERROR", str(err))
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = err.args[0] if err.args else str(err)
            meta["fallback_reason"] = "invalid_range"
            meta["requested_since"] = since_ts
            meta["requested_until"] = until_ts
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _ads_envelope(response, cache_meta=meta, error=error_payload)
            return jsonify(envelope)
        envelope = _ads_envelope(None, cache_meta=None, error=error_payload)
        return jsonify(envelope)
    except Exception as err:  # noqa: BLE001
        logger.exception("Falha inesperada em ads_highlights")
        fallback = get_latest_cached_payload("ads_highlights", act, platform="ads")
        error_payload = _ads_error_payload("INTEGRATION_ERROR", str(err))
        if fallback:
            payload, meta = fallback
            meta = dict(meta or {})
            meta["fallback_error"] = str(err)
            meta["fallback_reason"] = "unexpected_error"
            meta["requested_since"] = since_ts
            meta["requested_until"] = until_ts
            response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
            response["cache"] = meta
            envelope = _ads_envelope(response, cache_meta=meta, error=error_payload)
            return jsonify(envelope)
        envelope = _ads_envelope(None, cache_meta=None, error=error_payload)
        return jsonify(envelope)

    response = dict(payload) if isinstance(payload, dict) else {"payload": payload}
    response["cache"] = meta
    if not _ads_payload_has_data(response):
        envelope = _ads_envelope(
            None,
            cache_meta=meta,
            error=_ads_error_payload(
                "NO_DATA",
                "Nenhum dado disponivel para o periodo",
            ),
        )
        return jsonify(envelope)
    envelope = _ads_envelope(response, cache_meta=meta, error=None)
    return jsonify(envelope)


@app.get("/api/accounts/discover")
def discover_accounts():
    """
    Descobre automaticamente todas as contas conectadas ao token do System User.
    Retorna paginas do Facebook, perfis do Instagram e contas de anuncios, alem
    de uma lista normalizada pronta para preencher o seletor no frontend.
    """
    def _normalize_ad_id(raw: Optional[str]) -> str:
        if not raw:
            return ""
        raw_str = str(raw).strip()
        if not raw_str:
            return ""
        return raw_str if raw_str.startswith("act_") else f"act_{raw_str}"

    try:
        # 1. Buscar todas as páginas que o usuário administra
        pages_response = gget("/me/accounts", params={
            "fields": (
                "id,name,access_token,category,tasks,"
                "instagram_business_account{id,username,name,profile_picture_url,followers_count},"
                "ads_accounts{id,account_id,name,account_status,currency,timezone_name}"
            )
        })

        pages = []
        instagram_accounts = []
        normalized_accounts = []

        if pages_response and "data" in pages_response:
            for page in pages_response["data"]:
                if not isinstance(page, dict):
                    continue

                page_id = page.get("id")
                page_name = page.get("name")
                if not page_id:
                    continue

                page_data = {
                    "id": page_id,
                    "name": page_name,
                    "category": page.get("category"),
                    "tasks": page.get("tasks", []),
                }
                pages.append(page_data)

                ig_account = page.get("instagram_business_account")
                ig_id = ""
                ig_username = ""
                if isinstance(ig_account, dict):
                    ig_id = ig_account.get("id") or ""
                    ig_username = ig_account.get("username") or ""
                    instagram_accounts.append({
                        "id": ig_account.get("id"),
                        "username": ig_account.get("username"),
                        "name": ig_account.get("name"),
                        "profilePictureUrl": ig_account.get("profile_picture_url"),
                        "followersCount": ig_account.get("followers_count"),
                        "linkedPageId": page_id,
                        "linkedPageName": page_name,
                    })

                ads_accounts_payload = page.get("ads_accounts")
                ads_accounts_data = []
                if isinstance(ads_accounts_payload, dict):
                    for ad in ads_accounts_payload.get("data", []):
                        if not isinstance(ad, dict):
                            continue
                        ad_id_norm = _normalize_ad_id(ad.get("id") or ad.get("account_id"))
                        if not ad_id_norm:
                            continue
                        ads_accounts_data.append({
                            "id": ad_id_norm,
                            "name": ad.get("name"),
                            "accountId": ad.get("account_id"),
                            "accountStatus": ad.get("account_status"),
                            "currency": ad.get("currency"),
                            "timezoneName": ad.get("timezone_name"),
                        })

                normalized_accounts.append({
                    "id": f"page-{page_id}",
                    "label": page_name or page_id,
                    "facebookPageId": page_id,
                    "instagramUserId": ig_id,
                    "instagramUsername": ig_username,
                    "adAccountId": ads_accounts_data[0]["id"] if ads_accounts_data else "",
                    "adAccounts": ads_accounts_data,
                })

        # 2. Buscar todas as contas de anúncios
        adaccounts_response = gget("/me/adaccounts", params={
            "fields": "id,name,account_status,currency,timezone_name,business"
        })

        ad_accounts = []
        if adaccounts_response and "data" in adaccounts_response:
            for adaccount in adaccounts_response["data"]:
                if not isinstance(adaccount, dict):
                    continue
                ad_id_norm = _normalize_ad_id(adaccount.get("id") or adaccount.get("account_id"))
                if not ad_id_norm:
                    continue
                ad_accounts.append({
                    "id": ad_id_norm,
                    "name": adaccount.get("name"),
                    "accountStatus": adaccount.get("account_status"),
                    "currency": adaccount.get("currency"),
                    "timezoneName": adaccount.get("timezone_name"),
                })

        return jsonify({
            "pages": pages,
            "instagramAccounts": instagram_accounts,
            "adAccounts": ad_accounts,
            "accounts": normalized_accounts,
            "persistedAccounts": _load_connected_accounts(),
            "totalPages": len(pages),
            "totalInstagram": len(instagram_accounts),
            "totalAdAccounts": len(ad_accounts),
        })

    except MetaAPIError as err:
        logger.error(f"Meta API error in discover_accounts: {err}")
        return jsonify({
            "error": err.args[0],
            "graph": {
                "status": err.status,
                "code": err.code,
                "type": err.error_type,
            },
        }), 502
    except Exception as err:
        logger.exception("Unexpected error in discover_accounts")
        return jsonify({"error": str(err)}), 500


def _persist_connected_account(payload: Dict[str, Any], *, account_id: Optional[str] = None) -> Dict[str, Any]:
    _ensure_connected_accounts_table()
    account_id = account_id or str(uuid4())
    params = {
        "id": account_id,
        "label": payload.get("label"),
        "facebook_page_id": payload.get("facebookPageId") or payload.get("facebook_page_id"),
        "instagram_user_id": payload.get("instagramUserId") or payload.get("instagram_user_id"),
        "ad_account_id": payload.get("adAccountId") or payload.get("ad_account_id"),
        "profile_picture_url": payload.get("profilePictureUrl") or payload.get("profile_picture_url"),
        "page_picture_url": payload.get("pagePictureUrl") or payload.get("page_picture_url"),
    }
    execute(
        f"""
        INSERT INTO {CONNECTED_ACCOUNTS_TABLE} (
            id, label, facebook_page_id, instagram_user_id, ad_account_id,
            profile_picture_url, page_picture_url, source, created_at, updated_at
        ) VALUES (
            %(id)s, %(label)s, %(facebook_page_id)s, %(instagram_user_id)s, %(ad_account_id)s,
            %(profile_picture_url)s, %(page_picture_url)s, 'manual', NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            facebook_page_id = EXCLUDED.facebook_page_id,
            instagram_user_id = EXCLUDED.instagram_user_id,
            ad_account_id = EXCLUDED.ad_account_id,
            profile_picture_url = EXCLUDED.profile_picture_url,
            page_picture_url = EXCLUDED.page_picture_url,
            updated_at = NOW();
        """,
        params,
    )
    return {
        "id": account_id,
        "label": params["label"],
        "facebookPageId": params["facebook_page_id"],
        "instagramUserId": params["instagram_user_id"],
        "adAccountId": params["ad_account_id"],
        "profilePictureUrl": params["profile_picture_url"],
        "pagePictureUrl": params["page_picture_url"],
        "source": "manual",
    }


@app.get("/api/accounts")
def list_connected_accounts():
    user, error = _authenticate_request(request)
    if error:
        return error
    try:
        rows = fetch_all(f"SELECT * FROM {CONNECTED_ACCOUNTS_TABLE} ORDER BY label ASC")
    except Exception as err:  # noqa: BLE001
        logger.error("Failed to list connected accounts: %s", err)
        return jsonify({"error": "could not list accounts"}), 500
    payload = []
    for row in rows:
        payload.append({
            "id": row.get("id"),
            "label": row.get("label"),
            "facebookPageId": row.get("facebook_page_id"),
            "instagramUserId": row.get("instagram_user_id"),
            "adAccountId": row.get("ad_account_id"),
            "profilePictureUrl": row.get("profile_picture_url"),
            "pagePictureUrl": row.get("page_picture_url"),
            "source": row.get("source") or "manual",
        })
    return jsonify({"accounts": payload})


@app.post("/api/accounts")
def create_connected_account():
    user, error = _authenticate_request(request)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    required = ["label", "facebookPageId", "instagramUserId", "adAccountId"]
    for field in required:
        if not body.get(field):
            return jsonify({"error": f"{field} is required"}), 400
    try:
        account = _persist_connected_account(body)
        return jsonify({"account": account}), 201
    except Exception as err:  # noqa: BLE001
        logger.error("Failed to create connected account: %s", err)
        return jsonify({"error": "could not create account"}), 500


@app.put("/api/accounts/<account_id>")
def update_connected_account(account_id: str):
    user, error = _authenticate_request(request)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    if not body.get("label"):
        return jsonify({"error": "label is required"}), 400
    try:
        account = _persist_connected_account(body, account_id=account_id)
        return jsonify({"account": account})
    except Exception as err:  # noqa: BLE001
        logger.error("Failed to update connected account %s: %s", account_id, err)
        return jsonify({"error": "could not update account"}), 500


@app.delete("/api/accounts/<account_id>")
def delete_connected_account(account_id: str):
    user, error = _authenticate_request(request)
    if error:
        return error
    try:
        execute(f"DELETE FROM {CONNECTED_ACCOUNTS_TABLE} WHERE id = %(id)s", {"id": account_id})
    except Exception as err:  # noqa: BLE001
        logger.error("Failed to delete connected account %s: %s", account_id, err)
        return jsonify({"error": "could not delete account"}), 500
    return jsonify({"success": True})


@app.post("/api/sync/refresh")
def manual_refresh():
    body = request.get_json(silent=True) or {}
    resources = body.get("resources") or DEFAULT_REFRESH_RESOURCES
    if not isinstance(resources, list):
        return jsonify({"error": "resources must be a list"}), 400

    account = body.get("account") or {}
    page_id = body.get("pageId") or account.get("facebookPageId") or PAGE_ID
    ig_id = body.get("igUserId") or account.get("instagramUserId") or IG_ID
    ad_id = body.get("actId") or account.get("adAccountId") or ACT_ID
    limit_override = _safe_int(body.get("limit")) or 6

    since_ts = _safe_int(body.get("since"))
    until_ts = _safe_int(body.get("until"))

    if since_ts is None or until_ts is None:
        until_ts = int(time.time())
        since_ts = until_ts - (DEFAULT_DAYS * 86_400)

    results: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, Any]] = []

    def add_error(resource: str, message: str, details: Optional[Dict[str, Any]] = None) -> None:
        payload = {"resource": resource, "error": message}
        if details:
            payload.update(details)
        errors.append(payload)

    for resource in resources:
        owner_id = None
        since_arg = None
        until_arg = None
        extra = None
        fetcher = None

        if resource == "facebook_metrics":
            owner_id = page_id
            since_arg = since_ts
            until_arg = until_ts
            fetcher = fetch_facebook_metrics
        elif resource == "facebook_posts":
            owner_id = page_id
            extra = {"limit": limit_override}
            fetcher = fetch_facebook_posts
        elif resource == "instagram_metrics":
            owner_id = ig_id
            since_arg = since_ts
            until_arg = until_ts
            fetcher = fetch_instagram_metrics
        elif resource == "instagram_organic":
            owner_id = ig_id
            since_arg = since_ts
            until_arg = until_ts
            fetcher = fetch_instagram_organic
        elif resource == "instagram_audience":
            owner_id = ig_id
            fetcher = fetch_instagram_audience
        elif resource == "instagram_posts":
            owner_id = ig_id
            extra = {"limit": limit_override}
            fetcher = fetch_instagram_posts
        elif resource == "instagram_posts_insights":
            owner_id = ig_id
            since_arg = since_ts
            until_arg = until_ts
            extra = {"limit": limit_override}
            fetcher = fetch_instagram_posts_insights
        elif resource == "ads_highlights":
            owner_id = ad_id
            since_arg = since_ts
            until_arg = until_ts
            fetcher = fetch_ads_highlights
        else:
            add_error(resource, "Unsupported resource")
            continue

        if not owner_id:
            add_error(resource, "Missing identifier")
            continue

        try:
            _, meta = get_cached_payload(
                resource,
                owner_id,
                since_arg,
                until_arg,
                extra=extra,
                fetcher=fetcher,
                force=True,
                refresh_reason="manual",
                platform=platform,
            )
            results[resource] = {"cache": meta}
        except MetaAPIError as err:
            mark_cache_error(resource, owner_id, since_arg, until_arg, extra, err.args[0], platform=platform)
            add_error(
                resource,
                err.args[0],
                {"status": err.status, "code": err.code, "type": err.error_type},
            )
        except Exception as err:  # noqa: BLE001
            add_error(resource, str(err))

    status = 207 if errors else 200
    return jsonify({
        "results": results,
        "errors": errors,
        "resources": resources,
        "since": since_ts,
        "until": until_ts,
    }), status

register_fetcher("facebook_metrics", fetch_facebook_metrics)
register_fetcher("facebook_posts", fetch_facebook_posts)
register_fetcher("facebook_audience", fetch_facebook_audience)
register_fetcher("instagram_metrics", fetch_instagram_metrics)
register_fetcher("instagram_organic", fetch_instagram_organic)
register_fetcher("instagram_audience", fetch_instagram_audience)
register_fetcher("instagram_posts", fetch_instagram_posts)
register_fetcher("instagram_posts_insights", fetch_instagram_posts_insights)
register_fetcher("ads_highlights", fetch_ads_highlights)

_sync_scheduler: Optional[MetaSyncScheduler] = None
if os.getenv("META_SYNC_AUTOSTART", "1") != "0":
    should_start_scheduler = True
    if app.debug:
        should_start_scheduler = os.getenv("WERKZEUG_RUN_MAIN") == "true"
    if should_start_scheduler:
        _sync_scheduler = MetaSyncScheduler()
        _sync_scheduler.start()


if __name__ == "__main__":
    debug_env = os.getenv("FLASK_DEBUG")
    debug_mode = True
    if debug_env is not None:
        debug_mode = debug_env.lower() not in {"0", "false", "no"}
    run_host = os.getenv("FLASK_RUN_HOST") or os.getenv("HOST") or "0.0.0.0"
    run_port = int(os.getenv("PORT", "3001"))
    app.run(host=run_host, port=run_port, debug=debug_mode)
