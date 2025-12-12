"""
Diagnóstico de divergência das métricas de Instagram.

O script consulta:
1) Meta Graph API (direto, sem cache) para profile_views/reach/impressions/follower_count.
2) metrics_daily no Postgres para o mesmo período.
3) ig_cache para entradas recentes de instagram_metrics.

Uso:
    python backend/scripts/diagnose_instagram_metrics.py \
        --ig-user-id 1784... \
        --access-token EAA... \
        --start-date 2024-12-01 \
        --end-date 2024-12-07

Requisitos:
- Variáveis de ambiente do banco configuradas (DATABASE_* ou DATABASE_URL).
- Depende de meta.gget (usa META_APP_SECRET para appsecret_proof).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Dict, List, Tuple, Optional

from meta import gget, appsecret_proof  # noqa: F401  # appsecret_proof usado internamente pelo gget
from db import fetch_all


BRT = ZoneInfo("America/Sao_Paulo")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnóstico de métricas do Instagram (API vs DB vs Cache)")
    parser.add_argument("--ig-user-id", required=True, help="ID do Instagram Business (ig_user_id)")
    parser.add_argument("--access-token", required=True, help="Access token com scopes instagram_basic + pages_read_engagement")
    parser.add_argument("--start-date", required=True, help="Data inicial (YYYY-MM-DD, fuso local/BRT)")
    parser.add_argument("--end-date", required=True, help="Data final (YYYY-MM-DD, fuso local/BRT)")
    return parser.parse_args()


def to_utc_range(start_date_str: str, end_date_str: str) -> Tuple[datetime, datetime, int, int]:
    """
    Converte datas locais (BRT) para range UTC com os timestamps usados na Graph API.
    """
    start_local = datetime.strptime(start_date_str, "%Y-%m-%d").replace(tzinfo=BRT, hour=0, minute=0, second=0, microsecond=0)
    end_local = datetime.strptime(end_date_str, "%Y-%m-%d").replace(tzinfo=BRT, hour=23, minute=59, second=59, microsecond=0)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    since_ts = int(start_utc.timestamp())
    until_ts = int(end_utc.timestamp())
    return start_utc, end_utc, since_ts, until_ts


def extract_metric_series(payload: Dict, metric_name: str) -> List[Tuple[str, float]]:
    """
    Extrai série temporal (data ISO, valor) para um metric do Graph API payload.
    """
    series: List[Tuple[str, float]] = []
    for item in payload.get("data", []):
        if item.get("name") != metric_name:
            continue
        for entry in item.get("values") or []:
            if not isinstance(entry, dict):
                continue
            raw_value = entry.get("value")
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                continue
            end_time = entry.get("end_time") or entry.get("timestamp") or entry.get("time")
            if not end_time:
                continue
            iso_date = str(end_time)[:10]
            series.append((iso_date, value))
    return series


def fetch_api_insights(ig_user_id: str, token: str, since_ts: int, until_ts: int) -> Dict[str, List[Tuple[str, float]]]:
    metrics = "profile_views,reach,impressions,follower_count"
    payload = gget(
        f"/{ig_user_id}/insights",
        {
            "metric": metrics,
            "period": "day",
            "since": since_ts,
            "until": until_ts,
            "metric_type": "total_value",
        },
        token=token,
    )
    result: Dict[str, List[Tuple[str, float]]] = {}
    for name in metrics.split(","):
        result[name] = extract_metric_series(payload, name)
    return result


def fetch_db_metrics(ig_user_id: str, start_date: str, end_date: str) -> Dict[str, Dict[str, float]]:
    rows = fetch_all(
        """
        SELECT metric_key, metric_date::text AS metric_date, value
        FROM metrics_daily
        WHERE account_id = %(ig_id)s
          AND platform = 'instagram'
          AND metric_date BETWEEN %(start)s AND %(end)s
        ORDER BY metric_date
        """,
        {"ig_id": ig_user_id, "start": start_date, "end": end_date},
    )
    metrics: Dict[str, Dict[str, float]] = {}
    for row in rows:
        key = row.get("metric_key")
        date = row.get("metric_date")
        value = row.get("value")
        if key is None or date is None:
            continue
        metrics.setdefault(key, {})[date] = float(value)
    return metrics


def fetch_cache_entries(ig_user_id: str) -> List[Dict]:
    rows = fetch_all(
        """
        SELECT cache_key, payload, fetched_at, since_ts, until_ts
        FROM ig_cache
        WHERE owner_id = %(ig_id)s
          AND resource = 'instagram_metrics'
        ORDER BY fetched_at DESC
        LIMIT 5
        """,
        {"ig_id": ig_user_id},
    )
    return rows or []


def sum_series(series: List[Tuple[str, float]]) -> float:
    return round(sum(value for _, value in series), 2)


def build_daily_index(start_date: str, end_date: str) -> List[str]:
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    days = []
    current = start
    while current <= end:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days


def merge_series(series: List[Tuple[str, float]]) -> Dict[str, float]:
    merged: Dict[str, float] = {}
    for date, value in series:
        merged[date] = merged.get(date, 0.0) + float(value)
    return merged


def calc_cache_totals(cache_rows: List[Dict], metric_key: str) -> Optional[float]:
    if not cache_rows:
        return None
    row = cache_rows[0]
    payload = row.get("payload")
    if not isinstance(payload, dict):
        try:
            payload = json.loads(payload)
        except Exception:
            return None
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    if not isinstance(metrics, list):
        return None
    for item in metrics:
        if item.get("key") == metric_key:
            value = item.get("value")
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def print_report(
    ig_user_id: str,
    start_date: str,
    end_date: str,
    start_utc: datetime,
    end_utc: datetime,
    api_series: Dict[str, List[Tuple[str, float]]],
    db_metrics: Dict[str, Dict[str, float]],
    cache_rows: List[Dict],
) -> None:
    print("=== DIAGNÓSTICO INSTAGRAM METRICS ===")
    print(f"Conta: {ig_user_id}")
    print(f"Período (local/BRT): {start_date} a {end_date}")
    print(f"Período UTC: {start_utc.isoformat()} a {end_utc.isoformat()}")
    print()

    target_metric = "profile_views"
    api_total = sum_series(api_series.get(target_metric, []))
    db_total = round(sum(db_metrics.get(target_metric, {}).values()), 2)
    cache_total = calc_cache_totals(cache_rows, target_metric)

    print(f"--- {target_metric.upper()} ---")
    print(f"API Total: {api_total}")
    print(f"DB Total: {db_total}")
    print(f"Cache Total: {cache_total if cache_total is not None else 'n/d'}")
    divergence = api_total - db_total
    pct = None
    if api_total:
        pct = (divergence / api_total) * 100
    divergence_str = f"{divergence:.2f} ({pct:+.1f}%)" if pct is not None else divergence
    print(f"DIVERGÊNCIA (API - DB): {divergence_str}")
    print()

    days = build_daily_index(start_date, end_date)
    api_daily = merge_series(api_series.get(target_metric, []))
    db_daily = db_metrics.get(target_metric, {})

    print("--- Por Dia ---")
    print(f"{'Data':10} | {'API':10} | {'DB':10} | Status")
    for day in days:
        api_val = api_daily.get(day, 0)
        db_val = db_daily.get(day, 0)
        status = "✅ OK" if abs(api_val - db_val) < 0.01 else "❌ FALTANDO"
        print(f"{day} | {api_val:10.0f} | {db_val:10.0f} | {status}")

    print()
    print("--- Cache (últimas entradas) ---")
    if not cache_rows:
        print("Sem entradas em ig_cache para este ig_user_id.")
    else:
        for row in cache_rows:
            print(
                f"cache_key={row.get('cache_key')} fetched_at={row.get('fetched_at')} "
                f"since_ts={row.get('since_ts')} until_ts={row.get('until_ts')}"
            )


def main() -> None:
    args = parse_args()
    start_utc, end_utc, since_ts, until_ts = to_utc_range(args.start_date, args.end_date)

    api_series = fetch_api_insights(args.ig_user_id, args.access_token, since_ts, until_ts)
    db_metrics = fetch_db_metrics(args.ig_user_id, args.start_date, args.end_date)
    cache_rows = fetch_cache_entries(args.ig_user_id)

    print_report(
        args.ig_user_id,
        args.start_date,
        args.end_date,
        start_utc,
        end_utc,
        api_series,
        db_metrics,
        cache_rows,
    )


if __name__ == "__main__":
    main()
