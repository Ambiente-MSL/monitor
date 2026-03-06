from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Any, Iterable, Mapping, Optional, Sequence, Union

import psycopg2
from psycopg2 import sql
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor

PoolQuery = Union[str, sql.Composable]


class _ConnectionPoolWrapper:
    """
    Pequeno adaptador para expor uma API compatível com psycopg_pool.ConnectionPool
    usando psycopg2.pool.SimpleConnectionPool sob o capô.
    """

    def __init__(self, min_size: int, max_size: int, conninfo: Mapping[str, Any]):
        self._pool = pg_pool.SimpleConnectionPool(min_size, max_size, **conninfo)

    @contextmanager
    def connection(self):
        conn = self._pool.getconn()
        try:
            yield conn
        finally:
            self._pool.putconn(conn)


_pool: Optional[_ConnectionPoolWrapper] = None
_lock = threading.Lock()


def _build_conninfo() -> Optional[Mapping[str, str]]:
    dsn = os.getenv("DATABASE_URL")
    if dsn:
        try:
            from psycopg2.extensions import parse_dsn

            return parse_dsn(dsn)
        except Exception:
            # Se o parse falhar, ainda tentamos passar como dsn direto
            return {"dsn": dsn}

    host = os.getenv("DATABASE_HOST")
    if not host:
        return None

    user = os.getenv("DATABASE_USER")
    password = os.getenv("DATABASE_PASSWORD")
    name = os.getenv("DATABASE_NAME")
    port = os.getenv("DATABASE_PORT", "5432")

    if not all([user, password, name]):
        return None

    # Retorna parâmetros separados em vez de uma string DSN para evitar
    # problemas de encoding ou caracteres especiais.
    conn_params = {
        "host": host,
        "port": port,
        "dbname": name,
        "user": user,
        "password": password,
    }

    sslmode = os.getenv("DATABASE_SSLMODE")
    if sslmode:
        conn_params["sslmode"] = sslmode

    return conn_params


def get_pool() -> Optional[_ConnectionPoolWrapper]:
    global _pool
    if _pool is not None:
        return _pool

    conninfo = _build_conninfo()
    if not conninfo:
        return None

    with _lock:
        if _pool is None:
            max_size = int(os.getenv("DATABASE_POOL_MAX", "10") or "10")
            min_size = int(os.getenv("DATABASE_POOL_MIN", "1") or "1")
            _pool = _ConnectionPoolWrapper(
                min_size=min_size,
                max_size=max_size,
                conninfo=conninfo,
            )
    return _pool


def is_configured() -> bool:
    return get_pool() is not None


@contextmanager
def connection():
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database connection is not configured.")
    with pool.connection() as conn:
        yield conn


def fetch_all(query: PoolQuery, params: Optional[Mapping[str, Any]] = None) -> list[dict[str, Any]]:
    pool = get_pool()
    if pool is None:
        return []
    with pool.connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params or {})
            return cur.fetchall()


def fetch_one(query: PoolQuery, params: Optional[Mapping[str, Any]] = None) -> Optional[dict[str, Any]]:
    pool = get_pool()
    if pool is None:
        return None
    with pool.connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params or {})
            return cur.fetchone()


def execute(query: PoolQuery, params: Optional[Mapping[str, Any]] = None) -> None:
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database connection is not configured.")
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or {})
        conn.commit()


def execute_many(query: PoolQuery, param_seq: Iterable[Mapping[str, Any]]) -> None:
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database connection is not configured.")
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(query, param_seq)
        conn.commit()


def execute_script(script: str) -> None:
    pool = get_pool()
    if pool is None:
        raise RuntimeError("Database connection is not configured.")
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(script)
        conn.commit()


def format_identifier(name: str) -> sql.Identifier:
    return sql.Identifier(name)


def format_column_list(columns: Sequence[str]) -> sql.SQL:
    identifiers = [sql.Identifier(col.strip()) for col in columns]
    return sql.SQL(", ").join(identifiers)
