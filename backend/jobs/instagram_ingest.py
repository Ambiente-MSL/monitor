import argparse
import logging
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from cache import get_cached_payload, get_fetcher, register_fetcher
from meta import MetaAPIError, ig_window, ig_recent_posts, gget
from postgres_client import get_postgres_client
from psycopg2.extras import Json

logger = logging.getLogger(__name__)

PLATFORM = "instagram"
DEFAULT_BUCKETS = (7, 30, 90)
DEFAULT_POSTS_LIMIT = int(os.getenv("INSTAGRAM_POSTS_LIMIT", "20") or "20")
METRICS_TABLE = "metrics_daily"
ROLLUP_TABLE = "metrics_daily_rollup"
INGEST_LOGS_TABLE = "ingest_logs"
JOB_TYPE = "instagram_ingest"


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _insert_ingest_log(client, account_id: str, started_at: str) -> Optional[str]:
    record = {
        "platform": PLATFORM,
        "job_type": JOB_TYPE,
        "account_id": account_id,
        "status": "running",
        "started_at": started_at,
        "finished_at": None,
        "records_inserted": 0,
        "records_updated": 0,
        "error_message": None,
    }
    try:
        response = client.table(INGEST_LOGS_TABLE).insert(record).execute()
    except Exception as err:  # noqa: BLE001
        print(f"[ingest-log] Falha ao registrar início para {account_id}: {err}")
        return None
    data = getattr(response, "data", None) or []
    log_id = data[0].get("id") if data else None
    return log_id


def _update_ingest_log(
    client,
    log_id: Optional[str],
    status: str,
    finished_at: Optional[str],
    records_inserted: int,
    records_updated: int,
    error_message: Optional[str] = None,
) -> None:
    if not log_id:
        return
    payload = {
        "status": status,
        "finished_at": finished_at,
        "records_inserted": records_inserted,
        "records_updated": records_updated,
        "error_message": error_message,
    }
    try:
        client.table(INGEST_LOGS_TABLE).update(payload).eq("id", log_id).execute()
    except Exception as err:  # noqa: BLE001
        print(f"[ingest-log] Falha ao atualizar registro {log_id}: {err}")


def discover_instagram_account_ids() -> List[str]:
    """
    Usa a Graph API para descobrir todos os perfis do Instagram ligados ao token.
    """
    try:
        response = gget(
            "/me/accounts",
            params={
                "fields": (
                    "id,name,"
                    "instagram_business_account{id,username,name},"
                    "connected_instagram_account{id,username,name}"
                )
            },
        )
    except MetaAPIError as err:
        logger.error("Falha ao descobrir contas do Instagram: %s", err)
        return []
    except Exception as err:  # noqa: BLE001
        logger.exception("Erro inesperado ao descobrir contas do Instagram: %s", err)
        return []

    ids: List[str] = []
    for page in (response or {}).get("data", []) or []:
        if not isinstance(page, dict):
            continue
        ig_account = page.get("instagram_business_account") or page.get("connected_instagram_account")
        if isinstance(ig_account, dict):
            candidate = str(ig_account.get("id") or "").strip()
            if candidate:
                ids.append(candidate)
    return sorted({item for item in ids if item})


def resolve_ingest_accounts(explicit_ids: Optional[Sequence[str]] = None, auto_discover: bool = True) -> List[str]:
    """
    Consolida IDs informados, variáveis de ambiente e descoberta automática.
    """
    candidates: List[str] = []
    if explicit_ids:
        candidates.extend(explicit_ids)

    env_list = os.getenv("INSTAGRAM_INGEST_IDS", "")
    if env_list:
        candidates.extend(item.strip() for item in env_list.split(","))

    env_default = os.getenv("META_IG_USER_ID", "")
    if env_default:
        candidates.append(env_default.strip())

    if auto_discover:
        candidates.extend(discover_instagram_account_ids())

    seen = set()
    result: List[str] = []
    for candidate in candidates:
        item = str(candidate or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def parse_date(value: Optional[str], default: Optional[date] = None) -> Optional[date]:
    if value is None:
        return default
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        logger.error("Data inv\u00e1lida: %s", value)
        raise


def daterange(start: date, end: date) -> Iterable[date]:
    current = start
    delta = timedelta(days=1)
    while current <= end:
        yield current
        current += delta


def to_unix(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp())


BRT = ZoneInfo("America/Sao_Paulo")


def day_bounds(target: date, tz: ZoneInfo = BRT) -> Dict[str, int]:
    """
    Retorna bounds Unix para um dia no fuso local (ex.: BRT).
    """
    start_local = datetime.combine(target, datetime.min.time(), tzinfo=tz)
    end_local = datetime.combine(target, datetime.max.time().replace(microsecond=0), tzinfo=tz)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    return {
        "since": int(start_utc.timestamp()),
        "until": int(end_utc.timestamp()),
        "local_date": target.isoformat(),
        "utc_start": start_utc.isoformat(),
        "utc_end": end_utc.isoformat(),
    }


def snapshot_to_rows(
    ig_id: str,
    metric_date: date,
    snapshot: Dict[str, Optional[float]],
) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []

    def add(metric_key: str, numeric_value: Optional[float], metadata: Optional[dict] = None) -> None:
        if numeric_value is None:
            return
        rows.append(
            {
                "account_id": ig_id,
                "platform": PLATFORM,
                "metric_key": metric_key,
                "metric_date": metric_date.isoformat(),
                "value": float(numeric_value),
                "metadata": metadata,
            }
        )

    add("reach", snapshot.get("reach"))
    add("interactions", snapshot.get("interactions"))
    add("accounts_engaged", snapshot.get("accounts_engaged"))
    add("profile_views", snapshot.get("profile_views"))
    add("video_views", snapshot.get("video_views"))
    add("website_clicks", snapshot.get("website_clicks"))
    add("likes", snapshot.get("likes"))
    add("comments", snapshot.get("comments"))
    add("shares", snapshot.get("shares"))
    add("saves", snapshot.get("saves"))
    add("followers_delta", snapshot.get("follower_growth"))
    add("followers_total", snapshot.get("follower_count_end"))
    add("followers_start", snapshot.get("follower_count_start"))
    add("follows", snapshot.get("follows"))
    add("unfollows", snapshot.get("unfollows"))

    visitor_breakdown = snapshot.get("profile_visitors_breakdown")
    if visitor_breakdown:
        add("profile_visitors_total", visitor_breakdown.get("total"), metadata=visitor_breakdown)

    # Persist raw follower series for diagn\u00f3sticos
    follower_series = snapshot.get("follower_series")
    if follower_series:
        add("followers_series", len(follower_series), metadata={"series": follower_series})

    return rows


def _parse_metric_date(value: object) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None
    return None


def _format_metric_date_value(value: object) -> str:
    parsed = _parse_metric_date(value)
    if parsed is not None:
        return parsed.isoformat()
    return str(value)


def _parse_metric_date(value: object) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None
    return None


def upsert_metrics(rows: Sequence[Dict[str, object]]) -> Tuple[int, int]:
    if not rows:
        return 0, 0
    client = get_postgres_client()
    if client is None:
        raise RuntimeError("Banco não configurado para ingestão.")

    account_ids = {str(row.get("account_id")) for row in rows if row.get("account_id")}
    metric_keys = {str(row.get("metric_key")) for row in rows if row.get("metric_key")}
    metric_dates = {
        parsed
        for row in rows
        for parsed in [_parse_metric_date(row.get("metric_date"))]
        if parsed is not None
    }

    existing_keys: set[Tuple[str, str, str]] = set()
    try:
        query = (
            client.table(METRICS_TABLE)
            .select("account_id,metric_key,metric_date")
            .eq("platform", PLATFORM)
        )
        account_list = list(account_ids)
        if account_list:
            if len(account_list) == 1:
                query = query.eq("account_id", account_list[0])
            else:
                query = query.in_("account_id", account_list)
        if metric_keys:
            query = query.in_("metric_key", list(metric_keys))
        if metric_dates:
            query = query.in_("metric_date", list(metric_dates))
        response = query.execute()
        for item in getattr(response, "data", None) or []:
            existing_keys.add(
                (
                    str(item.get("account_id")),
                    str(item.get("metric_key")),
                    str(item.get("metric_date")),
                )
            )
    except Exception as err:  # noqa: BLE001
        logger.warning("Falha ao consultar registros existentes em %s: %s", METRICS_TABLE, err)

    inserted = 0
    updated = 0
    normalized_rows: List[Dict[str, object]] = []
    for row in rows:
        account_id = str(row.get("account_id"))
        metric_key = str(row.get("metric_key"))
        metric_date = _format_metric_date_value(row.get("metric_date"))
        row["metric_date"] = metric_date
        row["platform"] = PLATFORM
        metadata_value = row.get("metadata")
        if isinstance(metadata_value, (dict, list)):
            row["metadata"] = Json(metadata_value)
        key = (account_id, metric_key, metric_date)
        if key in existing_keys:
            updated += 1
        else:
            inserted += 1
        normalized_rows.append(dict(row))

    chunk_size = 500
    for index in range(0, len(normalized_rows), chunk_size):
        chunk = normalized_rows[index:index + chunk_size]
        response = (
            client.table(METRICS_TABLE)
            .upsert(chunk, on_conflict="account_id,platform,metric_key,metric_date")
            .execute()
        )
        if getattr(response, "error", None):
            raise RuntimeError(f"Falha ao inserir {METRICS_TABLE}: {response.error}")

    return inserted, updated


def build_rollup_payload(
    values: List[Dict[str, object]],
    metric_key: str,
    bucket: str,
    start_date: date,
    end_date: date,
) -> Dict[str, object]:
    numeric_values = [float(row["value"]) for row in values if row.get("value") is not None]
    if not numeric_values:
        raise ValueError("Nenhum valor numérico encontrado para rollup.")
    value_sum = sum(numeric_values)
    value_avg = value_sum / len(numeric_values)
    def _numeric(value: object) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    payload = {
        "account_id": values[0]["account_id"],
        "platform": PLATFORM,
        "metric_key": metric_key,
        "bucket": bucket,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "value_sum": value_sum,
        "value_avg": value_avg,
        "samples": len(numeric_values),
        "payload": Json({
            "values": [
                {
                    "metric_date": _format_metric_date_value(row.get("metric_date")),
                    "value": _numeric(row.get("value")),
                }
                for row in values
            ]
        }),
    }
    return payload


def refresh_rollups(
    ig_id: str,
    metric_keys: Sequence[str],
    metric_date: date,
    buckets: Sequence[int] = DEFAULT_BUCKETS,
) -> None:
    client = get_postgres_client()
    if client is None:
        raise RuntimeError("Banco não configurado para rollups.")

    for days in buckets:
        start_date = metric_date - timedelta(days=days - 1)
        for metric_key in metric_keys:
            response = (
                client.table(METRICS_TABLE)
                .select("account_id,metric_date,value")
                .eq("account_id", ig_id)
                .eq("platform", PLATFORM)
                .eq("metric_key", metric_key)
                .gte("metric_date", start_date.isoformat())
                .lte("metric_date", metric_date.isoformat())
                .order("metric_date", desc=False)
                .execute()
            )
            rows = getattr(response, "data", None) or []
            if not rows:
                continue
            payload = build_rollup_payload(
                rows,
                metric_key=metric_key,
                bucket=f"{days}d",
                start_date=start_date,
                end_date=metric_date,
            )
            result = (
                client.table(ROLLUP_TABLE)
                .upsert(
                    payload,
                    on_conflict="account_id,platform,metric_key,bucket,start_date,end_date",
                )
                .execute()
            )
            if getattr(result, "error", None):
                raise RuntimeError(f"Falha ao atualizar rollup {metric_key}/{days}d: {result.error}")


def _ensure_instagram_posts_fetcher() -> None:
    try:
        get_fetcher("instagram_posts")
    except KeyError:

        def _posts_fetcher(
            owner_id: str,
            _since_ts: Optional[int],
            _until_ts: Optional[int],
            extra: Optional[Dict[str, Any]],
        ):
            requested_limit = DEFAULT_POSTS_LIMIT
            if extra and "limit" in extra:
                try:
                    requested_limit = int(extra["limit"])
                except (TypeError, ValueError):
                    requested_limit = DEFAULT_POSTS_LIMIT
            return ig_recent_posts(owner_id, requested_limit)

        register_fetcher("instagram_posts", _posts_fetcher)


def warm_instagram_posts_cache(ig_id: str, limit: int = DEFAULT_POSTS_LIMIT) -> None:
    _ensure_instagram_posts_fetcher()
    try:
        get_cached_payload(
            "instagram_posts",
            ig_id,
            None,
            None,
            extra={"limit": limit},
            force=True,
            refresh_reason="ingest_job",
            platform=PLATFORM,
        )
        logger.debug("Cache de posts atualizado para %s (limite %s)", ig_id, limit)
    except Exception as err:  # noqa: BLE001
        logger.warning("Falha ao atualizar cache de posts para %s: %s", ig_id, err)


def ingest_account_range(
    ig_id: str,
    since: date,
    until: date,
    refresh_rollup: bool = True,
    warm_posts: bool = True,
) -> None:
    log_client = get_postgres_client()
    log_id: Optional[str] = None
    started_at_iso = _now_utc_iso()
    if log_client is not None:
        log_id = _insert_ingest_log(log_client, ig_id, started_at_iso)

    all_rows: List[Dict[str, object]] = []
    metric_keys_touched: defaultdict[str, set] = defaultdict(set)

    for daily_date in daterange(since, until):
        bounds = day_bounds(daily_date)
        snapshot = ig_window(ig_id, bounds["since"], bounds["until"])
        rows = snapshot_to_rows(ig_id, daily_date, snapshot)
        if not rows:
            logger.info("[%s] Nenhum dado para %s", ig_id, daily_date)
            continue
        all_rows.extend(rows)
        for row in rows:
            metric_keys_touched[daily_date.isoformat()].add(row["metric_key"])

    inserted_total = 0
    updated_total = 0
    try:
        inserted, updated = upsert_metrics(all_rows)
        inserted_total += inserted
        updated_total += updated

        if warm_posts:
            warm_instagram_posts_cache(ig_id)

        if refresh_rollup:
            for date_iso, keys in metric_keys_touched.items():
                metric_date = datetime.fromisoformat(date_iso).date()
                refresh_rollups(ig_id, list(keys), metric_date)

        finished_iso = _now_utc_iso()
        if log_client is not None:
            _update_ingest_log(
                log_client,
                log_id,
                status="succeeded",
                finished_at=finished_iso,
                records_inserted=inserted_total,
                records_updated=updated_total,
                error_message=None,
            )
        print(f"[instagram_ingest] {ig_id} inserted={inserted_total} updated={updated_total}")
    except Exception as err:
        if log_client is not None:
            _update_ingest_log(
                log_client,
                log_id,
                status="failed",
                finished_at=_now_utc_iso(),
                records_inserted=inserted_total,
                records_updated=updated_total,
                error_message=str(err),
            )
        raise


def main(argv: Optional[Sequence[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")

    parser = argparse.ArgumentParser(description="Ingest\u00e3o de m\u00e9tricas di\u00e1rias do Instagram.")
    parser.add_argument("--ig", dest="ig_ids", action="append", help="ID(s) do Instagram Business a ingerir.")
    parser.add_argument("--since", dest="since", help="Data inicial (ISO, inclusive).")
    parser.add_argument("--until", dest="until", help="Data final (ISO, inclusive).")
    parser.add_argument("--no-rollup", dest="no_rollup", action="store_true", help="N\u00e3o gerar rollups ap\u00f3s a ingest\u00e3o.")
    parser.add_argument("--no-discover", dest="no_discover", action="store_true", help="N\u00e3o buscar contas automaticamente na Graph API.")
    parser.add_argument("--skip-posts", dest="skip_posts", action="store_true", help="N\u00e3o aquecer o cache de posts ap\u00f3s a ingest\u00e3o.")

    args = parser.parse_args(argv)

    today = datetime.now(timezone.utc).date()
    default_since = today - timedelta(days=1)
    default_until = default_since

    since_date = parse_date(args.since, default_since)
    until_date = parse_date(args.until, default_until)
    if since_date > until_date:
        parser.error("--since n\u00e3o pode ser maior que --until.")

    account_ids = resolve_ingest_accounts(args.ig_ids, auto_discover=not args.no_discover)
    if not account_ids:
        parser.error("Nenhum Instagram ID encontrado. Informe via --ig ou garanta acesso \u00e0 Graph API.")

    for ig_id in account_ids:
        logger.info("Iniciando ingest\u00e3o %s (%s -> %s)", ig_id, since_date, until_date)
        ingest_account_range(
            ig_id=ig_id,
            since=since_date,
            until=until_date,
            refresh_rollup=not args.no_rollup,
            warm_posts=not args.skip_posts,
        )
        logger.info("Finalizado %s", ig_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
