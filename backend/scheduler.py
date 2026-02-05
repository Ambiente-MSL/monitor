import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler

from cache import PLATFORM_TABLES, get_cached_payload, get_table_name, list_due_entries, mark_cache_error
from db import execute
from jobs.instagram_ingest import ingest_account_range, resolve_ingest_accounts
from meta import MetaAPIError, gget, ig_audience
from ig_audience_snapshots import persist_audience_snapshot
from postgres_client import get_postgres_client

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_MINUTES = int(os.getenv("META_SYNC_INTERVAL_MINUTES", "60"))
DEFAULT_INGEST_ENABLED = os.getenv("INSTAGRAM_INGEST_ENABLED", "1") != "0"
DEFAULT_INGEST_TIME = os.getenv("INSTAGRAM_INGEST_TIME", "03:00")
DEFAULT_INGEST_TZ = os.getenv("INSTAGRAM_INGEST_TZ", "America/Sao_Paulo")
DEFAULT_INGEST_AUTO_DISCOVER = os.getenv("INSTAGRAM_INGEST_AUTO_DISCOVER", "1") != "0"
DEFAULT_INGEST_WARM_POSTS = os.getenv("INSTAGRAM_INGEST_WARM_POSTS", "1") != "0"
DEFAULT_INGEST_LOOKBACK_DAYS = int(os.getenv("INSTAGRAM_INGEST_LOOKBACK_DAYS", "1") or "1")
DEFAULT_WARM_ENABLED = os.getenv("CACHE_WARM_ENABLED", "1") != "0"
DEFAULT_WARM_LOOKBACK_DAYS = int(os.getenv("CACHE_WARM_LOOKBACK_DAYS", "7") or "7")
DEFAULT_WARM_MAX_ACCOUNTS = int(os.getenv("CACHE_WARM_MAX_ACCOUNTS", "50") or "50")
DEFAULT_WARM_IG_POSTS_LIMIT = int(os.getenv("INSTAGRAM_POSTS_LIMIT", "20") or "20")
DEFAULT_WARM_FB_POSTS_LIMIT = int(os.getenv("FACEBOOK_POSTS_LIMIT", "8") or "8")
DEFAULT_CACHE_RETENTION_DAYS = int(os.getenv("CACHE_RETENTION_DAYS", "365") or "365")
DEFAULT_AUDIENCE_SNAPSHOT_ENABLED = os.getenv("INSTAGRAM_AUDIENCE_SNAPSHOT_ENABLED", "1") != "0"


def cleanup_old_cache_job() -> None:
    retention_days = DEFAULT_CACHE_RETENTION_DAYS
    if retention_days <= 0:
        logger.info("[cleanup-cache] Retenção desabilitada (CACHE_RETENTION_DAYS=%s).", retention_days)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    tables = {get_table_name(platform) for platform in PLATFORM_TABLES.keys()}

    if not tables:
        logger.info("[cleanup-cache] Nenhuma tabela de cache encontrada; nada a limpar.")
        return

    for table in tables:
        try:
            execute(
                f"""
                DELETE FROM {table}
                WHERE COALESCE(next_refresh_at, fetched_at, updated_at, created_at, now()) < %(cutoff)s
                """,
                {"cutoff": cutoff.isoformat()},
            )
            logger.info("[cleanup-cache] Limpeza aplicada em %s com cutoff %s.", table, cutoff.isoformat())
        except Exception as err:  # noqa: BLE001
            logger.error("[cleanup-cache] Falha ao limpar %s: %s", table, err)


class MetaSyncScheduler:
    def __init__(self, interval_minutes: int = DEFAULT_INTERVAL_MINUTES):
        self.interval_minutes = max(5, interval_minutes)
        self._scheduler = BackgroundScheduler(timezone="UTC")
        self._started = False

        self._ingest_enabled = DEFAULT_INGEST_ENABLED
        self._ingest_time = DEFAULT_INGEST_TIME
        self._ingest_timezone = DEFAULT_INGEST_TZ
        self._ingest_auto_discover = DEFAULT_INGEST_AUTO_DISCOVER
        self._ingest_warm_posts = DEFAULT_INGEST_WARM_POSTS
        self._ingest_lookback = max(1, DEFAULT_INGEST_LOOKBACK_DAYS)
        self._warm_enabled = DEFAULT_WARM_ENABLED
        self._warm_lookback = max(1, DEFAULT_WARM_LOOKBACK_DAYS)
        self._warm_max_accounts = max(1, DEFAULT_WARM_MAX_ACCOUNTS)
        self._cache_retention_days = DEFAULT_CACHE_RETENTION_DAYS
        self._audience_snapshot_enabled = DEFAULT_AUDIENCE_SNAPSHOT_ENABLED

    def start(self) -> None:
        if self._started:
            return

        if get_postgres_client() is None:
            logger.warning("Banco não configurado. Scheduler de sincronização não iniciado.")
            return

        self._scheduler.add_job(
            self._run_cache_cycle,
            "interval",
            minutes=self.interval_minutes,
            id="meta_cache_refresh",
            max_instances=1,
            coalesce=True,
        )

        if self._ingest_enabled:
            ingest_hour, ingest_minute = self._parse_ingest_time(self._ingest_time)
            ingest_tz = self._resolve_timezone(self._ingest_timezone)
            self._scheduler.add_job(
                self._run_ingest_cycle,
                "cron",
                hour=ingest_hour,
                minute=ingest_minute,
                id="instagram_daily_ingest",
                max_instances=1,
                coalesce=True,
                timezone=ingest_tz,
            )
            logger.info(
                "Ingestão diária do Instagram agendada para %02d:%02d (%s).",
                ingest_hour,
                ingest_minute,
                ingest_tz.key if hasattr(ingest_tz, "key") else ingest_tz.tzname(datetime.utcnow()),
        )

        cleanup_tz = ZoneInfo("America/Sao_Paulo")
        self._scheduler.add_job(
            cleanup_old_cache_job,
            trigger="cron",
            hour=4,
            minute=0,
            timezone=cleanup_tz,
            id="cleanup_cache",
            replace_existing=True,
        )

        if self._warm_enabled:
            self._scheduler.add_job(
                self._warm_all_accounts,
                "interval",
                minutes=self.interval_minutes,
                id="prewarm_dashboards",
                max_instances=1,
                coalesce=True,
                next_run_time=datetime.now(timezone.utc),
            )

        self._scheduler.start()
        self._started = True
        logger.info("Scheduler de sincronização iniciado (intervalo %s minutos).", self.interval_minutes)

    def shutdown(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False

    def _parse_ingest_time(self, config_time: str) -> tuple[int, int]:
        try:
            hour_str, minute_str = config_time.split(":")
            return int(hour_str), int(minute_str)
        except Exception:  # noqa: BLE001
            logger.error("INSTAGRAM_INGEST_TIME inválido (%s). Usando 03:00.", config_time)
            return 3, 0

    def _resolve_timezone(self, tz_name: str) -> ZoneInfo:
        try:
            return ZoneInfo(tz_name)
        except Exception as err:  # noqa: BLE001
            logger.error("Timezone %s inválido (%s). Usando UTC.", tz_name, err)
            return ZoneInfo("UTC")

    def _run_cache_cycle(self) -> None:
        due_entries = list_due_entries(limit=25)
        if not due_entries:
            return

        logger.info("Atualizando %s registro(s) expirados do cache Meta.", len(due_entries))

        for entry in due_entries:
            resource = entry.get("resource")
            owner_id = entry.get("owner_id")
            since_ts = entry.get("since_ts")
            until_ts = entry.get("until_ts")
            extra = entry.get("extra")
            cache_key = entry.get("cache_key")
            platform = (entry.get("platform") or "instagram").lower()

            try:
                get_cached_payload(
                    resource,
                    owner_id,
                    since_ts,
                    until_ts,
                    extra,
                    force=True,
                    refresh_reason="scheduler",
                    platform=platform,
                )
                logger.debug("Cache %s atualizado pelo scheduler.", cache_key)
            except Exception as err:  # noqa: BLE001
                message = str(err)
                logger.exception("Falha ao atualizar cache %s: %s", cache_key, message)
                mark_cache_error(resource, owner_id, since_ts, until_ts, extra, message, platform=platform)

    def _resolve_ingest_accounts(self) -> List[str]:
        accounts = resolve_ingest_accounts(auto_discover=self._ingest_auto_discover)
        return accounts

    def _discover_accounts(self) -> Dict[str, Set[str]]:
        """
        Descobre todas as contas conectadas ao token (páginas FB, perfis IG, ad accounts)
        e retorna conjuntos únicos para aquecimento de cache.
        """
        pages: Set[str] = set()
        ig_users: Set[str] = set()
        ad_accounts: Set[str] = set()

        try:
            pages_response = gget(
                "/me/accounts",
                params={
                    "fields": (
                        "id,name,"
                        "instagram_business_account{id,username,name},"
                        "ads_accounts{id,account_id,name}"
                    )
                },
            )
            for page in (pages_response or {}).get("data", []) or []:
                if not isinstance(page, dict):
                    continue
                page_id = str(page.get("id") or "").strip()
                if page_id:
                    pages.add(page_id)
                ig_account = page.get("instagram_business_account")
                if isinstance(ig_account, dict):
                    ig_id = str(ig_account.get("id") or "").strip()
                    if ig_id:
                        ig_users.add(ig_id)
                ads_payload = page.get("ads_accounts")
                if isinstance(ads_payload, dict):
                    for ad in ads_payload.get("data", []) or []:
                        ad_id = str(ad.get("id") or ad.get("account_id") or "").strip()
                        if ad_id:
                            ad_accounts.add(ad_id if ad_id.startswith("act_") else f"act_{ad_id}")
        except MetaAPIError as err:
            logger.warning("Falha ao descobrir páginas/contas via /me/accounts: %s", err)
        except Exception as err:  # noqa: BLE001
            logger.exception("Erro inesperado em _discover_accounts /me/accounts: %s", err)

        try:
            adaccounts_response = gget(
                "/me/adaccounts",
                params={"fields": "id,name,account_id"},
            )
            for ad in (adaccounts_response or {}).get("data", []) or []:
                if not isinstance(ad, dict):
                    continue
                ad_id = str(ad.get("id") or ad.get("account_id") or "").strip()
                if ad_id:
                    ad_accounts.add(ad_id if ad_id.startswith("act_") else f"act_{ad_id}")
        except MetaAPIError as err:
            logger.warning("Falha ao descobrir ad accounts via /me/adaccounts: %s", err)
        except Exception as err:  # noqa: BLE001
            logger.exception("Erro inesperado em _discover_accounts /me/adaccounts: %s", err)

        return {
            "facebook": pages,
            "instagram": ig_users,
            "ads": ad_accounts,
        }

    def _range_unix(self, days: int) -> tuple[int, int]:
        """
        Retorna (since, until) em unix segundos para o intervalo de dias finalizado ontem,
        respeitando o timezone local (por padrao o mesmo do ingest).
        """
        tz_name = os.getenv("CACHE_WARM_TZ") or self._ingest_timezone
        tz = self._resolve_timezone(tz_name)

        today_local = datetime.now(tz).date()
        until_date = today_local - timedelta(days=1)
        since_date = until_date - timedelta(days=days - 1)

        since_local = datetime.combine(since_date, datetime.min.time(), tzinfo=tz)
        until_local = datetime.combine(until_date, datetime.max.time().replace(microsecond=0), tzinfo=tz)

        since_utc = since_local.astimezone(timezone.utc)
        until_utc = until_local.astimezone(timezone.utc)
        return int(since_utc.timestamp()), int(until_utc.timestamp())

    def _warm_all_accounts(self) -> None:
        accounts = self._discover_accounts()
        if not any(accounts.values()):
            logger.warning("Sem contas descobertas para pré-aquecimento de cache.")
            return

        since_ts, until_ts = self._range_unix(self._warm_lookback)
        warmed = 0
        errors = 0

        ig_posts_limit = max(1, min(int(DEFAULT_WARM_IG_POSTS_LIMIT), 25))
        fb_posts_limit = max(1, min(int(DEFAULT_WARM_FB_POSTS_LIMIT), 25))

        def _warm(
            resource: str,
            owner_id: str,
            platform: str,
            since_ts_arg: Optional[int],
            until_ts_arg: Optional[int],
            extra: Optional[Dict[str, Any]] = None,
        ) -> None:
            nonlocal warmed, errors
            try:
                get_cached_payload(
                    resource,
                    owner_id,
                    since_ts_arg,
                    until_ts_arg,
                    extra=extra,
                    force=False,
                    refresh_reason="prewarm_scheduler",
                    platform=platform,
                )
                warmed += 1
            except Exception as err:  # noqa: BLE001
                errors += 1
                logger.warning("Falha ao pré-aquecer %s/%s: %s", resource, owner_id, err)

        for ig_id in list(accounts["instagram"])[: self._warm_max_accounts]:
            _warm("instagram_metrics", ig_id, "instagram", since_ts, until_ts)
            _warm(
                "instagram_posts",
                ig_id,
                "instagram",
                None,
                None,
                extra={"limit": ig_posts_limit},
            )

        for page_id in list(accounts["facebook"])[: self._warm_max_accounts]:
            _warm("facebook_metrics", page_id, "facebook", since_ts, until_ts)
            _warm(
                "facebook_posts",
                page_id,
                "facebook",
                since_ts,
                until_ts,
                extra={"limit": fb_posts_limit},
            )

        for ad_id in list(accounts["ads"])[: self._warm_max_accounts]:
            _warm("ads_highlights", ad_id, "ads", since_ts, until_ts)

        logger.info(
            "Pré-aquecimento concluído: %s chamadas (erros: %s) | contas IG: %s, FB: %s, Ads: %s | range %s - %s",
            warmed,
            errors,
            len(accounts["instagram"]),
            len(accounts["facebook"]),
            len(accounts["ads"]),
            since_ts,
            until_ts,
        )

    def _snapshot_instagram_audience(self, ig_id: str) -> None:
        if not self._audience_snapshot_enabled:
            return
        try:
            payload = ig_audience(ig_id, timeframe="this_month")
            if isinstance(payload, dict):
                persist_audience_snapshot(ig_id, "this_month", payload)
                logger.info("[audience-snapshot] Snapshot salvo para %s.", ig_id)
        except Exception as err:  # noqa: BLE001
            logger.warning("[audience-snapshot] Falha ao salvar snapshot de %s: %s", ig_id, err)

    def _run_ingest_cycle(self) -> None:
        account_ids = self._resolve_ingest_accounts()
        if not account_ids:
            logger.warning("Sem contas de Instagram para ingestão diária.")
            return

        tz = self._resolve_timezone(self._ingest_timezone)
        today_local = datetime.now(tz).date()
        target_end = today_local - timedelta(days=1)
        target_start = target_end - timedelta(days=self._ingest_lookback - 1)

        logger.info(
            "Iniciando ingestão diária (%s -> %s) para %s conta(s).",
            target_start,
            target_end,
            len(account_ids),
        )

        failures: List[tuple[str, str]] = []
        successes: List[str] = []

        for ig_id in account_ids:
            try:
                ingest_account_range(
                    ig_id=ig_id,
                    since=target_start,
                    until=target_end,
                    refresh_rollup=True,
                    warm_posts=self._ingest_warm_posts,
                )
                self._snapshot_instagram_audience(ig_id)
                logger.info("Ingestão concluída para %s.", ig_id)
                successes.append(ig_id)
            except Exception as err:  # noqa: BLE001
                logger.exception("Falha na ingestão para %s: %s", ig_id, err)
                failures.append((ig_id, str(err)))

        if failures:
            failed_accounts = ", ".join(item[0] for item in failures)
            logger.error(
                "Ingestão diária finalizada com %s falha(s): %s",
                len(failures),
                failed_accounts,
            )
        else:
            logger.info(
                "Ingestão diária finalizada com sucesso para %s conta(s).",
                len(successes),
            )
