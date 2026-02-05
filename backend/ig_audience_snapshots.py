import logging
import os
from datetime import datetime, timezone, date
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

from psycopg2.extras import Json

from postgres_client import get_postgres_client

logger = logging.getLogger(__name__)

SNAPSHOT_TABLE = "ig_audience_snapshots"


def _resolve_timezone() -> timezone:
    tz_name = os.getenv("INSTAGRAM_INGEST_TZ") or os.getenv("CACHE_WARM_TZ") or "America/Sao_Paulo"
    try:
        return ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        return timezone.utc


def resolve_snapshot_date(target_ts: Optional[int] = None) -> date:
    tz = _resolve_timezone()
    if target_ts is not None:
        dt = datetime.fromtimestamp(target_ts, tz=timezone.utc).astimezone(tz)
    else:
        dt = datetime.now(tz)
    return dt.date()


def persist_audience_snapshot(
    account_id: str,
    timeframe: str,
    payload: Dict[str, Any],
    *,
    snapshot_date: Optional[date] = None,
) -> bool:
    if not account_id or not payload:
        return False
    client = get_postgres_client()
    if client is None:
        return False

    snapshot_date = snapshot_date or resolve_snapshot_date()
    row = {
        "account_id": account_id,
        "snapshot_date": snapshot_date.isoformat(),
        "timeframe": timeframe,
        "payload": Json(payload),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        client.table(SNAPSHOT_TABLE).upsert(
            row,
            on_conflict="account_id,snapshot_date,timeframe",
        ).execute()
        return True
    except Exception as err:  # noqa: BLE001
        logger.warning("Falha ao salvar snapshot de audiencia (%s/%s): %s", account_id, timeframe, err)
        return False


def load_latest_snapshot(
    account_id: str,
    timeframe: str,
    *,
    target_date: Optional[date] = None,
) -> Optional[Tuple[Dict[str, Any], date]]:
    client = get_postgres_client()
    if client is None:
        return None

    query = client.table(SNAPSHOT_TABLE).select("payload,snapshot_date").eq("account_id", account_id).eq(
        "timeframe", timeframe
    )
    if target_date is not None:
        query = query.lte("snapshot_date", target_date.isoformat())
    query = query.order("snapshot_date", desc=True).limit(1)

    try:
        response = query.execute()
        rows = getattr(response, "data", None) or []
        if not rows:
            return None
        row = rows[0]
        payload = row.get("payload") or {}
        raw_date = row.get("snapshot_date")
        snapshot_date = (
            datetime.fromisoformat(str(raw_date)).date()
            if raw_date
            else resolve_snapshot_date()
        )
        if not isinstance(payload, dict):
            return None
        return payload, snapshot_date
    except Exception as err:  # noqa: BLE001
        logger.warning("Falha ao carregar snapshot de audiencia (%s/%s): %s", account_id, timeframe, err)
        return None
