import copy
import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

from psycopg2.extras import Json

from postgres_client import get_postgres_client

PostgresClient = Any

logger = logging.getLogger(__name__)

# Registrador de recursos -> fetchers
FETCHERS: Dict[str, Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any]] = {}

def _resolve_cache_table() -> str:
    explicit = os.getenv("CACHE_TABLE")
    if explicit:
        return explicit
    for key, value in os.environ.items():
        if key.endswith("CACHE_TABLE") and value:
            return value
    return "ig_cache"


DEFAULT_CACHE_TABLE = _resolve_cache_table()
DEFAULT_TTL_HOURS = int(os.getenv("META_CACHE_TTL_HOURS", "24"))
DAY_SECONDS = 86_400
CACHE_NAMESPACE = os.getenv("META_CACHE_NAMESPACE", "").strip() or "default"

PLATFORM_TABLES: Dict[str, str] = {
    "instagram": DEFAULT_CACHE_TABLE or "ig_cache",
    "facebook": "fb_cache",
    "ads": "ads_cache",
}

_refresh_lock = threading.Lock()
_refreshing_keys: set[str] = set()


def get_table_name(platform: Optional[str] = "instagram") -> str:
    """
    Retorna o nome da tabela de cache conforme a plataforma solicitada.
    Fallback para a tabela de Instagram quando plataforma não for reconhecida.
    """
    key = (platform or "instagram").lower()
    return PLATFORM_TABLES.get(key, PLATFORM_TABLES["instagram"])


def register_fetcher(
    resource: str,
    fetcher: Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any],
) -> None:
    FETCHERS[resource] = fetcher


def get_fetcher(resource: str) -> Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any]:
    fetcher = FETCHERS.get(resource)
    if not fetcher:
        raise KeyError(f"Nenhum fetcher registrado para o recurso '{resource}'")
    return fetcher


def _normalize_ts(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bucket_ts(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    return value - (value % DAY_SECONDS)


def _ts_to_date(ts: Optional[int]) -> Optional[str]:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def _make_extra(extra: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not extra:
        return None
    # Garantir ordenaçãoo consistente ao criar chaves
    return json.loads(json.dumps(extra, sort_keys=True))


def _sanitize_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if isinstance(value, dict):
        return {key: _sanitize_json(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_sanitize_json(item) for item in value]
    return value


def _compute_cache_key(
    resource: str,
    owner_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
) -> str:
    extra_str = json.dumps(extra, sort_keys=True, separators=(",", ":")) if extra else ""
    base = f"{CACHE_NAMESPACE}|{resource}|{owner_id}|{since_ts or ''}|{until_ts or ''}|{extra_str}"
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]
    parts = [
        resource,
        owner_id or "na",
        str(since_ts or "na"),
        str(until_ts or "na"),
        digest,
    ]
    return "|".join(parts)


def _parse_dt(value: Optional[Any]) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None


def _format_timestamp(value: Optional[Any]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def _clone_payload(payload: Any) -> Any:
    try:
        return copy.deepcopy(payload)
    except Exception:  # noqa: BLE001
        return payload


def _get_postgres_client() -> Optional[PostgresClient]:
    return get_postgres_client()


def _select_entry(client: PostgresClient, table_name: str, cache_key: str) -> Optional[Dict[str, Any]]:
    try:
        response = client.table(table_name).select("*").eq("cache_key", cache_key).limit(1).execute()
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao consultar cache no Postgres: %s", err)
        return None

    data = getattr(response, "data", None) or []
    return data[0] if data else None


def _persist_entry(client: PostgresClient, table_name: str, record: Dict[str, Any]) -> None:
    serialized = dict(record)
    extra_value = serialized.get("extra")
    if extra_value is not None:
        serialized["extra"] = Json(_sanitize_json(extra_value))
    payload_value = serialized.get("payload")
    if payload_value is not None:
        serialized["payload"] = Json(_sanitize_json(payload_value))
    try:
        client.table(table_name).upsert(serialized, on_conflict="cache_key").execute()
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao persistir cache no Postgres: %s", err)
        raise


def get_latest_cached_payload(
    resource: str,
    owner_id: Optional[str],
    extra: Optional[Dict[str, Any]] = None,
    platform: str = "instagram",
) -> Optional[Tuple[Any, Dict[str, Any]]]:
    """
    Recupera a entrada mais recente armazenada no cache para o recurso/owner fornecido.

    Args:
        resource: Nome do recurso (por exemplo, "instagram_metrics").
        owner_id: Identificador do recurso (por exemplo, ID do Instagram).
        extra: Parâmetros extras que compõem a chave (opcional).

    Returns:
        Tuple contendo (payload, metadata) ou None caso não exista cache disponível.
    """
    db_client = _get_postgres_client()
    if db_client is None:
        return None

    table_name = get_table_name(platform)
    query = (
        db_client.table(table_name)
        .select("*")
        .eq("resource", resource)
    )
    if owner_id:
        query = query.eq("owner_id", owner_id)

    normalized_extra = _make_extra(extra)
    if normalized_extra:
        query = query.eq("extra", Json(_sanitize_json(normalized_extra)))

    try:
        response = query.order("fetched_at", desc=True).limit(1).execute()
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao recuperar cache mais recente para %s/%s: %s", resource, owner_id, err)
        return None

    data = getattr(response, "data", None) or []
    if not data:
        return None

    record = data[0]
    payload = _clone_payload(record.get("payload"))
    metadata = _build_metadata(record, stale=True, source="cache-fallback")
    metadata["fallback"] = True
    metadata["platform"] = platform
    return payload, metadata


def _build_metadata(record: Dict[str, Any], stale: bool, source: str) -> Dict[str, Any]:
    return {
        "cache_key": record.get("cache_key"),
        "fetched_at": _format_timestamp(record.get("fetched_at")),
        "next_refresh_at": _format_timestamp(record.get("next_refresh_at")),
        "stale": stale,
        "source": source,
        "reason": record.get("last_refresh_reason"),
        "ttl_hours": record.get("ttl_hours") or DEFAULT_TTL_HOURS,
        "last_refresh_status": record.get("last_refresh_status"),
        "last_refresh_error": record.get("last_refresh_error"),
        "namespace": CACHE_NAMESPACE,
    }


def _refresh_cache_entry(
    db_client: PostgresClient,
    table_name: str,
    cache_key: str,
    resource: str,
    owner_id: str,
    since_ts_requested: Optional[int],
    until_ts_requested: Optional[int],
    cache_since_ts: Optional[int],
    cache_until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
    fetcher: Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any],
    refresh_reason: Optional[str],
    stored: Optional[Dict[str, Any]],
) -> Tuple[Any, Dict[str, Any]]:
    payload = fetcher(owner_id, since_ts_requested, until_ts_requested, extra)
    now = datetime.now(timezone.utc)
    fetched_at_iso = now.isoformat()
    expires_at_iso = (now + timedelta(hours=DEFAULT_TTL_HOURS)).isoformat()

    record = {
        "cache_key": cache_key,
        "resource": resource,
        "owner_id": owner_id,
        "since_ts": cache_since_ts,
        "until_ts": cache_until_ts,
        "since_date": _ts_to_date(cache_since_ts),
        "until_date": _ts_to_date(cache_until_ts),
        "extra": extra,
        "payload": payload,
        "fetched_at": fetched_at_iso,
        "next_refresh_at": expires_at_iso,
        "ttl_hours": DEFAULT_TTL_HOURS,
        "last_refresh_reason": refresh_reason or ("prime" if stored is None else "refresh"),
        "last_refresh_status": "succeeded",
        "last_refresh_error": None,
        "created_at": stored.get("created_at") if stored else fetched_at_iso,
        "updated_at": fetched_at_iso,
    }

    _persist_entry(db_client, table_name, record)
    metadata = _build_metadata(record, stale=False, source="refresh" if stored else "prime")
    return payload, metadata


def _schedule_background_refresh(
    cache_key: str,
    db_client: PostgresClient,
    table_name: str,
    resource: str,
    owner_id: str,
    since_ts_requested: Optional[int],
    until_ts_requested: Optional[int],
    cache_since_ts: Optional[int],
    cache_until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
    fetcher: Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any],
) -> None:
    def run() -> None:
        try:
            _refresh_cache_entry(
                db_client,
                table_name,
                cache_key,
                resource,
                owner_id,
                since_ts_requested,
                until_ts_requested,
                cache_since_ts,
                cache_until_ts,
                extra,
                fetcher,
                refresh_reason="auto-stale",
                stored=_select_entry(db_client, table_name, cache_key),
            )
            logger.info("Cache %s atualizado em segundo plano.", cache_key)
        except Exception as err:  # noqa: BLE001
            logger.exception("Falha ao atualizar cache %s em segundo plano: %s", cache_key, err)
        finally:
            with _refresh_lock:
                _refreshing_keys.discard(cache_key)

    with _refresh_lock:
        if cache_key in _refreshing_keys:
            return
        _refreshing_keys.add(cache_key)
    threading.Thread(target=run, daemon=True).start()


def get_cached_payload(
    resource: str,
    owner_id: str,
    since_ts: Optional[int] = None,
    until_ts: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
    fetcher: Optional[
        Callable[[str, Optional[int], Optional[int], Optional[Dict[str, Any]]], Any]
    ] = None,
    *,
    force: bool = False,
    refresh_reason: Optional[str] = None,
    platform: str = "instagram",
) -> Tuple[Any, Dict[str, Any]]:
    """
    Recupera dados do cache armazenado no Postgres, buscando na Graph API se necessário.
    """
    db_client = _get_postgres_client()
    fetcher = fetcher or FETCHERS.get(resource)

    if not fetcher:
        raise RuntimeError(f"Nenhum fetcher definido para '{resource}'")

    # Caso o banco não esteja configurado, sempre buscar e retornar
    if db_client is None:
        payload = fetcher(owner_id, since_ts, until_ts, extra)
        now = datetime.now(timezone.utc).isoformat()
        meta = {
            "cache_key": None,
            "fetched_at": now,
            "next_refresh_at": None,
            "stale": False,
            "source": "live",
            "reason": refresh_reason or "direct",
            "ttl_hours": DEFAULT_TTL_HOURS,
            "last_refresh_status": "bypassed",
            "last_refresh_error": None,
            "platform": platform,
        }
        return _clone_payload(payload), meta

    requested_since_ts = _normalize_ts(since_ts)
    requested_until_ts = _normalize_ts(until_ts)
    cache_since_ts = _bucket_ts(requested_since_ts)
    cache_until_ts = _bucket_ts(requested_until_ts)
    extra = _make_extra(extra)

    table_name = get_table_name(platform)
    cache_key = _compute_cache_key(resource, owner_id, cache_since_ts, cache_until_ts, extra)
    stored = _select_entry(db_client, table_name, cache_key)
    now = datetime.now(timezone.utc)

    if stored and not force:
        fetched_at = _parse_dt(stored.get("fetched_at"))
        ttl_hours = int(stored.get("ttl_hours") or DEFAULT_TTL_HOURS)
        stale_threshold = fetched_at + timedelta(hours=ttl_hours) if fetched_at else None
        is_stale = bool(stale_threshold and stale_threshold <= now)

        if is_stale:
            _schedule_background_refresh(
                cache_key,
                db_client,
                table_name,
                resource,
                owner_id,
                requested_since_ts,
                requested_until_ts,
                cache_since_ts,
                cache_until_ts,
                extra,
                fetcher,
            )

        source = "stale" if is_stale else "cache"
        metadata = _build_metadata(stored, stale=is_stale, source=source)
        metadata["platform"] = platform
        return _clone_payload(stored.get("payload")), metadata

    payload, metadata = _refresh_cache_entry(
        db_client,
        table_name,
        cache_key,
        resource,
        owner_id,
        requested_since_ts,
        requested_until_ts,
        cache_since_ts,
        cache_until_ts,
        extra,
        fetcher,
        refresh_reason,
        stored,
    )
    metadata["platform"] = platform
    return _clone_payload(payload), metadata


def mark_cache_error(
    resource: str,
    owner_id: str,
    since_ts: Optional[int],
    until_ts: Optional[int],
    extra: Optional[Dict[str, Any]],
    error_message: str,
    platform: str = "instagram",
) -> None:
    db_client = _get_postgres_client()
    if db_client is None:
        return

    table_name = get_table_name(platform)
    cache_key = _compute_cache_key(
        resource,
        owner_id,
        _bucket_ts(_normalize_ts(since_ts)),
        _bucket_ts(_normalize_ts(until_ts)),
        _make_extra(extra),
    )
    record = _select_entry(db_client, table_name, cache_key)
    if not record:
        return
    try:
        db_client.table(table_name).update(
            {
                "last_refresh_status": "failed",
                "last_refresh_error": error_message,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("cache_key", cache_key).execute()
    except Exception as err:  # noqa: BLE001
        logger.error("Falha ao marcar erro de cache: %s", err)


def list_due_entries(limit: int = 10, platform: Optional[str] = None) -> List[Dict[str, Any]]:
    db_client = _get_postgres_client()
    if db_client is None:
        return []
    now_iso = datetime.now(timezone.utc).isoformat()
    platforms: List[str]
    if platform:
        platforms = [platform]
    else:
        platforms = list(PLATFORM_TABLES.keys())

    aggregated: List[Dict[str, Any]] = []
    for plat in platforms:
        table_name = get_table_name(plat)
        try:
            response = (
                db_client.table(table_name)
                .select("*")
                .lte("next_refresh_at", now_iso)
                .order("next_refresh_at", desc=False)
                .limit(limit)
                .execute()
            )
        except Exception as err:  # noqa: BLE001
            logger.error("Falha ao listar cache vencido na tabela %s: %s", table_name, err)
            continue
        for row in getattr(response, "data", None) or []:
            item = dict(row)
            item["platform"] = plat
            item["_cache_table"] = table_name
            aggregated.append(item)

    aggregated.sort(key=lambda item: item.get("next_refresh_at") or "")
    if platform:
        return aggregated[:limit]
    return aggregated[:limit]
