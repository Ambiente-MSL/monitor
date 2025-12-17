import logging
import os
import signal
import sys
import time
from typing import Optional

from scheduler import MetaSyncScheduler


def _setup_logging() -> None:
    level_name = (os.getenv("SCHEDULER_LOG_LEVEL") or os.getenv("LOG_LEVEL") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )


def main() -> int:
    _setup_logging()
    logger = logging.getLogger("scheduler_runner")

    # Garante que ao importar o backend (para registrar fetchers) nÃ£o iniciamos
    # outro scheduler dentro do processo.
    os.environ.setdefault("META_SYNC_AUTOSTART", "0")

    # Importa o server para registrar fetchers (cache.register_fetcher) usados pelo scheduler.
    # Sem isso, o refresh/prewarm falha com "Nenhum fetcher definido".
    import server  # noqa: F401

    scheduler = MetaSyncScheduler()
    scheduler.start()

    stop: dict[str, bool] = {"flag": False}

    def _handle_signal(signum: int, _frame: Optional[object]) -> None:
        if stop["flag"]:
            return
        stop["flag"] = True
        logger.info("Recebido sinal %s; encerrando scheduler...", signum)
        try:
            scheduler.shutdown()
        except Exception:  # noqa: BLE001
            logger.exception("Falha ao encerrar scheduler.")

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info("Scheduler runner iniciado.")
    while not stop["flag"]:
        time.sleep(1)
    logger.info("Scheduler runner finalizado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
