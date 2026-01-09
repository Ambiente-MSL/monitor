# backend/meta.py
import os
import time
import hmac
import hashlib
import logging
import copy
from datetime import datetime
import requests
from typing import Optional, List, Dict, Any, Sequence
from urllib.parse import urlencode

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)

# Configurar logging estruturado
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

VERSION = os.getenv("META_GRAPH_VERSION", "v23.0")
TOKEN = os.getenv("META_SYSTEM_USER_TOKEN")
SECRET = os.getenv("META_APP_SECRET")
BASE = f"https://graph.facebook.com/{VERSION}"

# Configurações
REQUEST_TIMEOUT = 30  # segundos
MAX_RETRIES = 3
IG_POSTS_MEM_CACHE_TTL_SEC = int(os.getenv("IG_POSTS_MEM_CACHE_TTL_SEC", "1800"))
IG_POSTS_MEM_CACHE: Dict[str, Dict[str, Any]] = {}


class MetaAPIError(Exception):
    def __init__(self, status: int, message: str, code: Optional[int] = None, error_type: Optional[str] = None,
                 raw: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.error_type = error_type
        self.raw = raw or {}


def appsecret_proof(token: Optional[str]) -> Optional[str]:
    if not token or not SECRET:
        return None
    return hmac.new(SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


def gget(path: str, params: Optional[dict] = None, token: Optional[str] = None):
    """
    Faz requisição GET à Meta Graph API com retry exponencial e timeout configurável.

    Args:
        path: Caminho da API (ex: "/me")
        params: Parâmetros da query string
        token: Token de acesso (usa TOKEN global se não fornecido)

    Returns:
        dict: Resposta JSON da API

    Raises:
        MetaAPIError: Se a requisição falhar após todos os retries
    """
    request_token = token or TOKEN
    if not request_token:
        raise RuntimeError("META_SYSTEM_USER_TOKEN is not configured")

    query = {"access_token": request_token}
    proof = appsecret_proof(request_token)
    if proof:
        query["appsecret_proof"] = proof
    if params:
        query.update(params)

    url = f"{BASE}{path}?{urlencode(query, doseq=True)}"

    # Retry com exponential backoff
    for attempt in range(MAX_RETRIES):
        try:
            logger.debug(f"Request attempt {attempt + 1}/{MAX_RETRIES}: {path}")
            r = requests.get(url, timeout=REQUEST_TIMEOUT)

            # Se sucesso, retornar
            if r.ok:
                return r.json()

            # Se for erro temporário e ainda temos tentativas, fazer retry
            if r.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                # Exponential backoff: 2^attempt segundos (1s, 2s, 4s, 8s...)
                wait_time = 2 ** attempt
                logger.warning(
                    f"Request failed with status {r.status_code}. "
                    f"Retrying in {wait_time}s... (attempt {attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(wait_time)
                continue

            # Erro definitivo ou última tentativa
            try:
                payload = r.json()
            except ValueError:
                payload = {}

            err = payload.get("error") if isinstance(payload, dict) else None
            message = (err or {}).get("message") if isinstance(err, dict) else None

            logger.error(f"Meta API error: {message or r.text}")

            raise MetaAPIError(
                status=r.status_code,
                message=message or r.text or "Meta Graph API request failed",
                code=(err or {}).get("code") if isinstance(err, dict) else None,
                error_type=(err or {}).get("type") if isinstance(err, dict) else None,
                raw=payload if isinstance(payload, dict) else {"raw": r.text},
            )

        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                wait_time = 2 ** attempt
                logger.warning(f"Request timeout. Retrying in {wait_time}s...")
                time.sleep(wait_time)
                continue
            logger.error(f"Request timeout after {MAX_RETRIES} attempts")
            raise MetaAPIError(
                status=504,
                message=f"Request timeout after {REQUEST_TIMEOUT}s",
                code=None,
                error_type="timeout"
            )

        except requests.exceptions.RequestException as e:
            logger.error(f"Request exception: {e}")
            raise MetaAPIError(
                status=500,
                message=f"Request failed: {str(e)}",
                code=None,
                error_type="request_exception"
            )

    # Fallback (não deve chegar aqui)
    logger.warning("Max retries reached, returning empty data")
    return {"data": []}


# Cache simples para page tokens (System User token não expira)
PAGE_TOKEN_CACHE: Dict[str, str] = {}

def get_page_access_token(page_id: str) -> str:
    """
    Obtém page access token para uma página específica.
    System User token não expira, então mantemos cache indefinidamente.

    Args:
        page_id: ID da página do Facebook

    Returns:
        str: Page access token
    """
    # Verificar cache primeiro
    if page_id in PAGE_TOKEN_CACHE:
        logger.debug(f"Using cached page token for {page_id}")
        return PAGE_TOKEN_CACHE[page_id]

    # Buscar token da API
    logger.info(f"Fetching page access token for {page_id}")
    data = gget(f"/{page_id}", {"fields": "access_token"})
    token_value = data.get("access_token") if isinstance(data, dict) else None

    if not token_value:
        raise RuntimeError(f"Could not fetch page access token for {page_id}")

    # Armazenar em cache
    PAGE_TOKEN_CACHE[page_id] = token_value
    logger.info(f"Page token cached for {page_id}")

    return token_value


def sum_values(arr, key="value"):
    return sum((x.get(key, 0) or 0) for x in arr if isinstance(x, dict))


def _coerce_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(',', '.'))
        except ValueError:
            return None
    if isinstance(value, dict):
        total = 0.0
        has_value = False
        for inner in value.values():
            coerced = _coerce_number(inner)
            if coerced is not None:
                total += coerced
                has_value = True
        return total if has_value else None
    return None


def extract_insight_values(payload: Dict[str, Any], name: str) -> List[float]:
    if not isinstance(payload, dict):
        return []
    for item in payload.get('data', []):
        if item.get('name') == name:
            values: List[float] = []
            for entry in item.get('values') or []:
                if not isinstance(entry, dict):
                    continue
                coerced = _coerce_number(entry.get('value'))
                if coerced is not None:
                    values.append(coerced)
            return values
    return []


def extract_insight_series(payload: Dict[str, Any], name: str) -> List[Dict[str, Any]]:
    series: List[Dict[str, Any]] = []
    if not isinstance(payload, dict):
        return series

    for item in payload.get('data', []):
        if item.get('name') != name:
            continue
        for entry in item.get('values') or []:
            if not isinstance(entry, dict):
                continue
            coerced = _coerce_number(entry.get('value'))
            if coerced is None:
                continue
            end_time = entry.get('end_time') or entry.get('timestamp') or entry.get('time')
            iso_date = None
            if isinstance(end_time, str):
                iso_date = end_time[:10]
            elif isinstance(end_time, (int, float)):
                iso_date = time.strftime("%Y-%m-%d", time.gmtime(int(end_time)))
            if not iso_date:
                continue
            series.append({
                "date": iso_date,
                "value": coerced,
            })
    series.sort(key=lambda row: row["date"])
    return series


def insight_value_from_list(items: List[Dict[str, Any]], name: str) -> Optional[float]:
    if not isinstance(items, list):
        return None
    for item in items:
        if item.get('name') == name:
            values = item.get('values') or []
            if not values:
                return None
            first = values[0]
            if isinstance(first, dict):
                return _coerce_number(first.get('value'))
            return _coerce_number(first)
    return None


def aggregate_dimension_values(payload: Dict[str, Any], target_name: str) -> Dict[str, float]:
    """Agrupa valores de métricas com breakdown do Graph API."""
    results: Dict[str, float] = {}
    if not isinstance(payload, dict):
        return results
    for item in payload.get("data", []):
        if item.get("name") != target_name:
            continue
        for entry in item.get("values") or []:
            value = entry.get("value")
            if isinstance(value, dict):
                for key, raw in value.items():
                    coerced = _coerce_number(raw)
                    if coerced is None:
                        continue
                    results[key] = results.get(key, 0.0) + coerced
            else:
                coerced = _coerce_number(value)
                if coerced is None:
                    continue
                results["total"] = results.get("total", 0.0) + coerced
    return results


def extract_time_series(payload: Dict[str, Any], target_name: str) -> List[Dict[str, Any]]:
    """Extrai séries temporais ordenadas (ex.: follower_count)."""
    series: List[Dict[str, Any]] = []
    if not isinstance(payload, dict):
        return series
    for item in payload.get("data", []):
        if item.get("name") != target_name:
            continue
        for entry in item.get("values") or []:
            raw_val = entry.get("value")
            coerced = None
            if isinstance(raw_val, dict):
                coerced = _coerce_number(raw_val.get("value"))
            if coerced is None:
                coerced = _coerce_number(raw_val)
            if coerced is None:
                continue
            series.append({
                "value": coerced,
                "end_time": entry.get("end_time"),
                "start_time": entry.get("start_time"),
            })
    series.sort(key=lambda row: (row.get("end_time") or row.get("start_time") or ""))
    return series


# ---- Facebook (organico) ----

def fb_page_window(page_id: str, since: int, until: int):
    page_token = get_page_access_token(page_id)

    # Métricas básicas (pode não retornar todas dependendo da revisão do app)
    basic_metrics = [
        "page_impressions",
        "page_impressions_unique",
        "page_post_engagements",
        "page_fan_adds_unique",
    ]
    insight_params = {"metric": ",".join(basic_metrics), "period": "day", "since": since, "until": until}

    try:
        ins = gget(
            f"/{page_id}/insights",
            insight_params,
            token=page_token,
        )
    except MetaAPIError as err:
        logger.warning("Fallback fetching individual page metrics due to: %s", err)
        ins = {"data": []}
        for metric_name in basic_metrics:
            try:
                single = gget(
                    f"/{page_id}/insights",
                    {"metric": metric_name, "period": "day", "since": since, "until": until},
                    token=page_token,
                )
            except MetaAPIError:
                continue
            data = single.get("data", [])
            if data:
                ins.setdefault("data", []).extend(data)

    def sum_series(name: str) -> int:
        values = extract_insight_values(ins, name)
        return int(round(sum(values))) if values else 0

    impressions = sum_series("page_impressions")
    reach = sum_series("page_impressions_unique")
    engaged = sum_series("page_post_engagements")
    likes_add = sum_series("page_fan_adds_unique")
    reach_series_raw = extract_insight_series(ins, "page_impressions_unique") or []
    reach_timeseries: List[Dict[str, Any]] = []
    for entry in reach_series_raw:
        if not isinstance(entry, dict):
            continue
        value = _coerce_number(entry.get("value"))
        end_time = entry.get("end_time") or entry.get("date") or entry.get("time")
        if value is None or not end_time:
            continue
        normalized = str(end_time).replace("Z", "+00:00")
        if normalized.endswith("+0000"):
            normalized = normalized[:-5] + "+00:00"
        try:
            date_key = datetime.fromisoformat(normalized).date().isoformat()
        except Exception:
            continue
        reach_timeseries.append({"date": date_key, "value": int(round(value))})

    # Função auxiliar para buscar métricas opcionais com fallback
    def fetch_optional_metrics(metric_list, capture_series: Optional[List[str]] = None):
        results = {}
        series_map: Dict[str, List[Dict[str, Any]]] = {}
        capture_set = set(capture_series or [])
        for metric_name in metric_list:
            try:
                payload = gget(
                    f"/{page_id}/insights",
                    {"metric": metric_name, "period": "day", "since": since, "until": until},
                    token=page_token,
                )
                values = extract_insight_values(payload, metric_name)
                results[metric_name] = int(round(sum(values))) if values else 0
                if metric_name in capture_set:
                    series_map[metric_name] = extract_insight_series(payload, metric_name)
            except MetaAPIError:
                # Métrica não disponível, ignorar
                results[metric_name] = 0
                if metric_name in capture_set:
                    series_map[metric_name] = []
        return results, series_map

    # Buscar métricas opcionais de visão geral
    optional_metrics, optional_series = fetch_optional_metrics([
        "page_views_total",
        "page_video_views",
        "page_video_views_3s",
        "page_video_views_60s",
        "page_video_view_time",
        "page_actions_post_reactions_total",
        "page_consumptions",
        "page_cta_clicks_logged_in_total",
        "page_fan_adds",
        "page_fan_removes",
    ], capture_series=["page_fan_adds", "page_fan_removes"])

    page_views = optional_metrics.get("page_views_total", 0)
    video_views = optional_metrics.get("page_video_views", 0)
    video_views_3s = optional_metrics.get("page_video_views_3s", 0)
    video_views_60s = optional_metrics.get("page_video_views_60s", 0)
    video_view_time = optional_metrics.get("page_video_view_time", 0)
    content_activity = optional_metrics.get("page_consumptions", 0)  # Consumptions é mais confiável
    cta_clicks = optional_metrics.get("page_cta_clicks_logged_in_total", 0)
    followers_gained = optional_metrics.get("page_fan_adds", 0) or likes_add
    followers_lost = optional_metrics.get("page_fan_removes", 0)
    net_followers = followers_gained - followers_lost

    def _series_to_map(metric_name: str) -> Dict[str, int]:
        mapping: Dict[str, int] = {}
        for entry in optional_series.get(metric_name, []):
            if not isinstance(entry, dict):
                continue
            date = entry.get("date")
            value = entry.get("value")
            if not date:
                continue
            coerced = _coerce_number(value)
            if coerced is None:
                continue
            mapping[date] = mapping.get(date, 0) + int(round(coerced))
        return mapping

    fan_adds_map = _series_to_map("page_fan_adds")
    fan_removes_map = _series_to_map("page_fan_removes")
    all_series_dates = sorted(set(list(fan_adds_map.keys()) + list(fan_removes_map.keys())))
    net_followers_series: List[Dict[str, Any]] = []
    cumulative_net = 0
    for date in all_series_dates:
        adds_value = fan_adds_map.get(date, 0)
        removes_value = fan_removes_map.get(date, 0)
        net_value = adds_value - removes_value
        cumulative_net += net_value
        net_followers_series.append({
            "date": date,
            "adds": adds_value,
            "removes": removes_value,
            "net": net_value,
            "cumulative": cumulative_net,
        })

    # Calcular tempo médio de visualização se houver visualizações
    avg_watch_time = 0
    if video_views > 0 and video_view_time > 0:
        avg_watch_time = int(video_view_time / video_views)

    total_reac = 0
    total_com = 0
    total_sha = 0
    total_clicks = 0
    video_reac = 0
    video_com = 0
    video_sha = 0
    post_sum_impressions = 0
    post_sum_reach = 0
    post_sum_engaged = 0
    url = f"/{page_id}/posts"
    post_insight_metrics = ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_clicks"]
    base_post_params = {
        "since": since,
        "until": until,
        "limit": 50,
        "fields": (
            "id,created_time,permalink_url,"
            "status_type,attachments{media_type},"
            "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares"
        ),
    }
    page = gget(url, base_post_params, token=page_token)
    while True:
        for p_item in page.get("data", []):
            reactions_count = int(((p_item.get("reactions") or {}).get("summary") or {}).get("total_count", 0) or 0)
            comments_count = int(((p_item.get("comments") or {}).get("summary") or {}).get("total_count", 0) or 0)
            shares_count = int((p_item.get("shares") or {}).get("count", 0) or 0)

            total_reac += reactions_count
            total_com += comments_count
            total_sha += shares_count

            attachments = ((p_item.get("attachments") or {}).get("data") or [])[:]
            status_type = str(p_item.get("status_type") or "").lower()
            is_video_post = any(
                isinstance(att, dict) and str(att.get("media_type", "")).lower().startswith("video")
                for att in attachments
            ) or ("video" in status_type)
            if is_video_post:
                video_reac += reactions_count
                video_com += comments_count
                video_sha += shares_count
            try:
                post_insights = gget(
                    f"/{p_item.get('id')}/insights",
                    {"metric": ",".join(post_insight_metrics)},
                    token=page_token,
                )
            except MetaAPIError:
                post_insights = {"data": []}
            ins_values = post_insights.get("data", [])
            clicks_value = insight_value_from_list(ins_values, "post_clicks")
            impressions_value = insight_value_from_list(ins_values, "post_impressions")
            reach_value = insight_value_from_list(ins_values, "post_impressions_unique")
            engaged_value = insight_value_from_list(ins_values, "post_engaged_users")
            if clicks_value:
                total_clicks += int(round(clicks_value))
            if impressions_value:
                post_sum_impressions += int(round(impressions_value))
            if reach_value:
                post_sum_reach += int(round(reach_value))
            if engaged_value:
                post_sum_engaged += int(round(engaged_value))
        paging = page.get("paging") or {}
        cursor_after = (paging.get("cursors") or {}).get("after")
        if not cursor_after:
            break
        next_params = dict(base_post_params)
        next_params["after"] = cursor_after
        page = gget(url, next_params, token=page_token)

    if impressions <= 0 and post_sum_impressions > 0:
        impressions = post_sum_impressions
    if reach <= 0 and post_sum_reach > 0:
        reach = post_sum_reach
    if engaged <= 0 and post_sum_engaged > 0:
        engaged = post_sum_engaged

    engagement_total = total_reac + total_com + total_sha
    video_metrics = fetch_page_video_metrics(page_id, page_token, since, until)
    if video_views_3s is not None:
        video_metrics.setdefault("views_3s", video_views_3s)
    video_engagement_total = video_reac + video_com + video_sha
    video_metrics["engagement"] = {
        "total": video_engagement_total,
        "reactions": video_reac,
        "comments": video_com,
        "shares": video_sha,
    }

    followers_total = 0
    fans_series = []
    try:
        fans_payload = gget(
            f"/{page_id}/insights",
            {"metric": "page_fans", "period": "day", "since": since, "until": until},
            token=page_token,
        )
        fans_values = extract_insight_values(fans_payload, "page_fans")
        fans_series = extract_insight_series(fans_payload, "page_fans")
        if fans_values:
            followers_total = int(round(fans_values[-1]))
    except MetaAPIError:
        followers_total = 0

    # Fallback absoluto para total de seguidores independente do range (valor fixo da pagina)
    try:
        fan_info = gget(
            f"/{page_id}",
            {"fields": "fan_count,followers_count"},
            token=page_token,
        )
        fan_count_val = fan_info.get("fan_count") or fan_info.get("followers_count")
        if fan_count_val is not None:
            candidate_val = int(fan_count_val)
            if candidate_val > 0 or followers_total in (None, 0):
                followers_total = candidate_val
    except MetaAPIError:
        pass

    if fans_series:
        fans_series.sort(key=lambda row: row.get("date") or "")
        first_val = _coerce_number(fans_series[0].get("value"))
        last_val = _coerce_number(fans_series[-1].get("value"))
        if last_val is not None and followers_total in (None, 0):
            followers_total = int(round(last_val))
        if first_val is not None and last_val is not None:
            net_from_fans = int(round(last_val - first_val))
            if followers_gained in (None, 0) and net_from_fans > 0:
                followers_gained = net_from_fans
            if followers_lost in (None, 0) and net_from_fans < 0:
                followers_lost = abs(net_from_fans)
            if net_followers in (None, 0) and net_from_fans != 0:
                net_followers = net_from_fans
            if not net_followers_series:
                cumulative = 0
                previous = None
                fallback_series = []
                for entry in fans_series:
                    value = _coerce_number(entry.get("value"))
                    date_value = entry.get("date")
                    if value is None or not date_value:
                        continue
                    if previous is None:
                        previous = value
                        fallback_series.append({
                            "date": date_value,
                            "adds": 0,
                            "removes": 0,
                            "net": 0,
                            "cumulative": 0,
                        })
                        continue
                    diff = value - previous
                    net_value = int(round(diff))
                    adds_value = max(net_value, 0)
                    removes_value = max(-net_value, 0)
                    cumulative += net_value
                    fallback_series.append({
                        "date": date_value,
                        "adds": adds_value,
                        "removes": removes_value,
                        "net": net_value,
                        "cumulative": cumulative,
                    })
                    previous = value
                net_followers_series = fallback_series

    return {
        "impressions": impressions,
        "reach": reach,
        "post_engaged": engaged,
        "likes_add": likes_add,
        "engagement": {
            "total": engagement_total,
            "reactions": total_reac,
            "comments": total_com,
            "shares": total_sha,
        },
        "video": video_metrics,
        "post_clicks": total_clicks,
        "page_overview": {
            "page_views": page_views,
            "video_views": video_views,
            "video_views_3s": video_views_3s,
            "video_views_10s": video_metrics.get("views_10s"),
            "video_views_30s": video_metrics.get("views_30s"),
            "video_views_1m": video_views_60s,
            "avg_watch_time": avg_watch_time,
            "content_activity": content_activity,
            "cta_clicks": cta_clicks,
            "followers_gained": followers_gained,
            "followers_lost": followers_lost,
            "net_followers": net_followers,
            "followers_total": followers_total,
            "reach_timeseries": reach_timeseries,
        },
        "net_followers_series": net_followers_series,
        "reach_timeseries": reach_timeseries,
    }


def fetch_page_video_metrics(page_id: str, page_token: str, since: int, until: int) -> Dict[str, Optional[float]]:
    metric_candidates = {
        "views_30s": ["page_video_views_30s"],
        "views_10s": ["page_video_views_10s"],
        "views_1m": ["page_video_views_60s_exclusive", "page_video_views_60s"],
        "avg_watch_time": ["page_video_avg_time_watched"],
        "watch_time_total": ["page_video_view_time"],
    }
    results: Dict[str, Optional[float]] = {
        "views_30s": None,
        "views_10s": None,
        "views_1m": None,
        "avg_watch_time": None,
        "watch_time_total": None,
    }

    for key, metric_names in metric_candidates.items():
        for metric_name in metric_names:
            try:
                payload = gget(
                    f"/{page_id}/insights",
                    {
                        "metric": metric_name,
                        "period": "day",
                        "since": since,
                        "until": until,
                    },
                    token=page_token,
                )
            except MetaAPIError:
                continue
            values = extract_insight_values(payload, metric_name)
            if not values:
                continue
            if key == "avg_watch_time":
                results[key] = sum(values) / len(values) if values else None
            else:
                results[key] = sum(values)
            break

    if results["views_10s"] is not None:
        results["views_10s"] = int(round(results["views_10s"]))
    if results["views_30s"] is not None:
        results["views_30s"] = int(round(results["views_30s"]))
    if results["views_1m"] is not None:
        results["views_1m"] = int(round(results["views_1m"]))
    return results




# ---- Instagram (orgânico) ----

def ig_window(ig_user_id: str, since: int, until: int) -> Dict[str, Any]:
    """
    Métricas de conta Instagram para um período.

    IMPORTANTE:
    - API limita a 30 dias por chamada
    - Timestamps devem estar em UTC
    - Dados são retornados em UTC e devem ser convertidos para exibição
    """
    MAX_DAYS_PER_CALL = 30

    period_seconds = until - since
    period_days = period_seconds / 86400

    if period_days > MAX_DAYS_PER_CALL:
        return _ig_window_chunked(ig_user_id, since, until, MAX_DAYS_PER_CALL)

    # Meta API (v22+) passou a exigir `metric_type=total_value` para algumas métricas.
    # Para não perder o reach diário (usado no gráfico), busca o `reach` em uma chamada isolada.
    try:
        reach_response = gget(
            f"/{ig_user_id}/insights",
            {
                "metric": "reach",
                "period": "day",
                "since": since,
                "until": until,
            },
        )
    except MetaAPIError as err:
        logger.warning("Falha ao buscar reach diário: %s", err)
        reach_response = {"data": []}

    reach_timeseries = extract_time_series(reach_response, "reach")

    try:
        totals_response = gget(
            f"/{ig_user_id}/insights",
            {
                "metric": "profile_views,website_clicks,accounts_engaged",
                "period": "day",
                "metric_type": "total_value",
                "since": since,
                "until": until,
            },
        )
    except MetaAPIError as err:
        logger.warning("Falha ao buscar totais de conta: %s", err)
        totals_response = {"data": []}

    # Em versões recentes, algumas métricas deixam de ter série diária; mantém compatibilidade.
    profile_views_timeseries: List[Dict[str, Any]] = []

    def sum_series(series: List[Dict[str, Any]]) -> int:
        return sum(int(entry.get("value") or 0) for entry in series)

    reach = sum_series(reach_timeseries)
    profile_views = sum_series(profile_views_timeseries)

    def get_total_value(response: Dict[str, Any], metric_name: str) -> int:
        for item in response.get("data", []):
            if item.get("name") != metric_name:
                continue
            total_value = item.get("total_value")
            if isinstance(total_value, dict):
                return int(total_value.get("value") or 0)
            try:
                return int(total_value or 0)
            except (TypeError, ValueError):
                return 0
        return 0

    profile_views = get_total_value(totals_response, "profile_views")
    website_clicks = get_total_value(totals_response, "website_clicks")
    accounts_engaged = get_total_value(totals_response, "accounts_engaged")

    try:
        interactions_response = gget(
            f"/{ig_user_id}/insights",
            {
                "metric": "total_interactions",
                "period": "day",
                "metric_type": "total_value",
                "since": since,
                "until": until,
            },
        )
        total_interactions = 0
        for item in interactions_response.get("data", []):
            if item.get("name") == "total_interactions":
                total_value = item.get("total_value") or {}
                if isinstance(total_value, dict):
                    total_interactions = int(total_value.get("value") or 0)
                break
    except MetaAPIError:
        total_interactions = 0

    sum_likes = sum_comments = sum_shares = sum_saves = 0
    sum_video_views = 0
    video_views_by_date: Dict[str, int] = {}
    reach_by_date: Dict[str, int] = {}
    post_details: List[Dict[str, Any]] = []

    try:
        media_response = gget(
            f"/{ig_user_id}/media",
            {
                "since": since,
                "until": until,
                "limit": 100,
                "fields": "id,media_type,media_product_type,timestamp,like_count,comments_count,permalink",
            },
        )

        page = media_response
        while True:
            for media in page.get("data", []):
                media_id = media.get("id")
                timestamp_iso = media.get("timestamp")
                timestamp_unix = None

                if timestamp_iso:
                    try:
                        timestamp_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
                        timestamp_unix = int(timestamp_dt.timestamp())
                    except ValueError:
                        pass

                media_type = (media.get("media_type") or "").upper()
                media_product_type = (media.get("media_product_type") or "").upper()
                is_video_type = media_type in {"VIDEO", "REEL", "IGTV"} or media_product_type in {"REELS", "VIDEO", "IGTV"}

                metrics_list = ["reach", "shares", "saved", "likes", "comments"]
                if is_video_type:
                    metrics_list.append("video_views")

                try:
                    media_insights = gget(
                        f"/{media_id}/insights",
                        {"metric": ",".join(metrics_list)},
                    )
                    insights_map = {}
                    for item in media_insights.get("data", []):
                        name = (item.get("name") or "").lower()
                        values = item.get("values") or [{}]
                        insights_map[name] = int((values[0].get("value") or 0))
                except MetaAPIError:
                    insights_map = {}
                    try:
                        fallback_insights = gget(
                            f"/{media_id}/insights",
                            {"metric": "reach,shares,saved,likes,comments"},
                        )
                        for item in fallback_insights.get("data", []):
                            name = (item.get("name") or "").lower()
                            values = item.get("values") or [{}]
                            insights_map[name] = int((values[0].get("value") or 0))
                    except MetaAPIError:
                        insights_map = {}

                likes = insights_map.get("likes") or media.get("like_count") or 0
                comments = insights_map.get("comments") or media.get("comments_count") or 0
                shares = insights_map.get("shares") or 0
                saves = insights_map.get("saved") or insights_map.get("saves") or 0
                reach_value = insights_map.get("reach") or 0
                video_views_value = 0
                if is_video_type:
                    video_views_value = insights_map.get("video_views") or insights_map.get("views") or 0
                    if not video_views_value:
                        video_views_value = reach_value or 0
                else:
                    video_views_value = reach_value or 0
                video_views_value = int(video_views_value or 0)

                sum_likes += likes
                sum_comments += comments
                sum_shares += shares
                sum_saves += saves
                sum_video_views += video_views_value

                if (video_views_value or reach_value) and timestamp_iso:
                    date_key = None
                    try:
                        dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
                        date_key = dt.date().isoformat()
                    except ValueError:
                        date_key = timestamp_iso[:10]
                    if date_key:
                        if video_views_value:
                            video_views_by_date[date_key] = video_views_by_date.get(date_key, 0) + video_views_value
                        if reach_value:
                            reach_by_date[date_key] = reach_by_date.get(date_key, 0) + int(reach_value or 0)

                post_details.append({
                    "id": media_id,
                    "timestamp": timestamp_iso,
                    "timestamp_unix": timestamp_unix,
                    "permalink": media.get("permalink"),
                    "media_type": media.get("media_type"),
                    "media_product_type": media_product_type,
                    "likes": likes,
                    "comments": comments,
                    "shares": shares,
                    "saves": saves,
                    "reach": reach_value,
                    "views": video_views_value,
                    "interactions": likes + comments + shares + saves,
                })

            next_page = (page.get("paging") or {}).get("next")
            if not next_page:
                break
            page = requests.get(next_page, timeout=15).json()

    except MetaAPIError as err:
        logger.warning("Falha ao buscar mídias: %s", err)

    interactions = total_interactions or (sum_likes + sum_comments + sum_shares + sum_saves)

    if reach == 0:
        reach = sum(p.get("reach") or 0 for p in post_details)
    if not reach_timeseries and reach_by_date:
        reach_timeseries = [
            {"date": key, "value": value}
            for key, value in sorted(reach_by_date.items())
        ]
        if reach == 0:
            reach = sum(reach_by_date.values())
    video_views_timeseries = [
        {"date": key, "value": value}
        for key, value in sorted(video_views_by_date.items())
    ]

    follower_series = []
    follower_growth = None
    follower_start = None
    follower_end = None
    follows_total = None
    unfollows_total = None

    try:
        follower_response = gget(
            f"/{ig_user_id}/insights",
            {
                "metric": "follower_count",
                "period": "day",
                "since": since,
                "until": until,
            },
        )
        follower_series = extract_time_series(follower_response, "follower_count")
        if follower_series:
            follower_start = int(follower_series[0].get("value") or 0)
            follower_end = int(follower_series[-1].get("value") or 0)
            follower_growth = follower_end - follower_start
    except MetaAPIError:
        pass

    try:
        follows_response = gget(
            f"/{ig_user_id}/insights",
            {
                "metric": "follows_and_unfollows",
                "period": "day",
                "since": since,
                "until": until,
                "metric_type": "total_value",
            },
        )
        follows_map = aggregate_dimension_values(follows_response, "follows_and_unfollows")
        follows_total = follows_map.get("follows")
        unfollows_total = follows_map.get("unfollows")
    except MetaAPIError:
        pass

    profile_visitors_breakdown = None
    visitors_breakdown = {"followers": 0.0, "non_followers": 0.0, "other": 0.0}

    for metric_name in ("profile_views", "accounts_engaged"):
        try:
            breakdown_response = gget(
                f"/{ig_user_id}/insights",
                {
                    "metric": metric_name,
                    "period": "day",
                    "since": since,
                    "until": until,
                    "metric_type": "total_value",
                    "breakdown": "follow_type",
                },
            )
            breakdown = aggregate_dimension_values(breakdown_response, metric_name)
            if breakdown:
                for key, value in breakdown.items():
                    norm = (key or "").strip().lower()
                    if "non" in norm and "follow" in norm:
                        visitors_breakdown["non_followers"] += value or 0
                    elif "follow" in norm:
                        visitors_breakdown["followers"] += value or 0
                    else:
                        visitors_breakdown["other"] += value or 0
                break
        except MetaAPIError:
            continue

    visitors_total = sum(visitors_breakdown.values())
    if visitors_total > 0:
        profile_visitors_breakdown = {
            "followers": int(visitors_breakdown["followers"]),
            "non_followers": int(visitors_breakdown["non_followers"]),
            "other": int(visitors_breakdown["other"]),
            "total": int(visitors_total),
        }

    return {
        "reach": reach,
        "interactions": interactions,
        "accounts_engaged": accounts_engaged,
        "profile_views": profile_views,
        "profile_views_timeseries": profile_views_timeseries,
        "video_views": sum_video_views,
        "video_views_timeseries": video_views_timeseries,
        "website_clicks": website_clicks,
        "likes": sum_likes,
        "comments": sum_comments,
        "shares": sum_shares,
        "saves": sum_saves,
        "follower_growth": follower_growth,
        "follower_count_start": follower_start,
        "follower_count_end": follower_end,
        "follows": follows_total,
        "unfollows": unfollows_total,
        "profile_visitors_breakdown": profile_visitors_breakdown,
        "follower_series": follower_series,
        "posts_detailed": post_details,
        "reach_timeseries": reach_timeseries,
    }


def _ig_window_chunked(ig_user_id: str, since: int, until: int, chunk_days: int = 30) -> Dict[str, Any]:
    """
    Busca dados em chunks de N dias para períodos longos.
    """
    results: List[Dict[str, Any]] = []
    current_since = since

    while current_since < until:
        current_until = min(current_since + (chunk_days * 86400), until)

        try:
            chunk_data = ig_window(ig_user_id, current_since, current_until)
            results.append(chunk_data)
        except Exception as err:
            logger.warning("Falha no chunk %s-%s: %s", current_since, current_until, err)

        current_since = current_until

    if not results:
        return ig_window(ig_user_id, since, until)

    aggregated = {
        "reach": 0,
        "interactions": 0,
        "accounts_engaged": 0,
        "profile_views": 0,
        "website_clicks": 0,
        "likes": 0,
        "comments": 0,
        "shares": 0,
        "saves": 0,
        "follower_growth": 0,
        "follower_count_start": None,
        "follower_count_end": None,
        "follows": 0,
        "unfollows": 0,
        "profile_visitors_breakdown": None,
        "follower_series": [],
        "posts_detailed": [],
        "reach_timeseries": [],
        "profile_views_timeseries": [],
        "video_views": 0,
        "video_views_timeseries": [],
    }

    for chunk in results:
        aggregated["reach"] += chunk.get("reach") or 0
        aggregated["interactions"] += chunk.get("interactions") or 0
        aggregated["accounts_engaged"] += chunk.get("accounts_engaged") or 0
        aggregated["profile_views"] += chunk.get("profile_views") or 0
        aggregated["website_clicks"] += chunk.get("website_clicks") or 0
        aggregated["likes"] += chunk.get("likes") or 0
        aggregated["comments"] += chunk.get("comments") or 0
        aggregated["shares"] += chunk.get("shares") or 0
        aggregated["saves"] += chunk.get("saves") or 0
        aggregated["follows"] += chunk.get("follows") or 0
        aggregated["unfollows"] += chunk.get("unfollows") or 0
        aggregated["video_views"] += chunk.get("video_views") or 0

        if chunk.get("follower_series"):
            aggregated["follower_series"].extend(chunk["follower_series"])
        if chunk.get("posts_detailed"):
            aggregated["posts_detailed"].extend(chunk["posts_detailed"])
        if chunk.get("reach_timeseries"):
            aggregated["reach_timeseries"].extend(chunk["reach_timeseries"])
        if chunk.get("profile_views_timeseries"):
            aggregated["profile_views_timeseries"].extend(chunk["profile_views_timeseries"])
        if chunk.get("video_views_timeseries"):
            aggregated["video_views_timeseries"].extend(chunk["video_views_timeseries"])

    if results:
        first = results[0]
        last = results[-1]
        aggregated["follower_count_start"] = first.get("follower_count_start")
        aggregated["follower_count_end"] = last.get("follower_count_end")
        if aggregated["follower_count_start"] and aggregated["follower_count_end"]:
            aggregated["follower_growth"] = aggregated["follower_count_end"] - aggregated["follower_count_start"]

    return aggregated


def _safe(val, cast=float):
    try:
        return cast(val or 0)
    except Exception:
        return 0


def ig_audience(ig_user_id: str) -> Dict[str, Any]:
    """Retorna distribuição de audiência (cidades, idades, gênero)."""

    def fetch_breakdown(breakdown: str):
        metric_candidates = ("follower_demographics", "engaged_audience_demographics", "reached_audience_demographics")
        for metric_name in metric_candidates:
            params = {
                "metric": metric_name,
                "period": "lifetime",
                "metric_type": "total_value",
                "breakdown": breakdown,
            }
            try:
                payload = gget(f"/{ig_user_id}/insights", params)
            except MetaAPIError:
                continue
            data = aggregate_dimension_values(payload, metric_name)
            if data:
                return data, metric_name
        return {}, None

    def as_percentage(value: float, total: float) -> float:
        if not total:
            return 0.0
        return round((value / total) * 100.0, 2)

    city_counts, _ = fetch_breakdown("city")
    top_cities = sorted(city_counts.items(), key=lambda kv: kv[1], reverse=True)[:8]
    total_city = sum(city_counts.values()) or 0.0

    cities = [
        {
            "name": name,
            "value": int(round(count)),
            "percentage": as_percentage(count, total_city),
        }
        for name, count in top_cities
    ]

    raw_age_counts, _ = fetch_breakdown("age")
    age_buckets = {
        "18-24": 0.0,
        "25-34": 0.0,
        "35-44": 0.0,
        "45-54": 0.0,
        "55+": 0.0,
    }
    for key, value in raw_age_counts.items():
        label = str(key or "").replace('_', '-').strip().lower()
        normalized = None
        if label in ("18-24", "25-34", "35-44", "45-54"):
            normalized = label
        elif label in ("55-64", "65+", "65-plus", "55-plus", "55+"):
            normalized = "55+"
        elif label in ("13-17", "under-18"):
            normalized = None
        if normalized and value is not None:
            age_buckets[normalized] += float(value or 0.0)

    age_total = sum(age_buckets.values()) or 0.0
    ages = [
        {
            "range": label,
            "value": int(round(amount)),
            "percentage": as_percentage(amount, age_total),
        }
        for label, amount in age_buckets.items()
    ]

    raw_gender_counts, _ = fetch_breakdown("gender")
    gender_labels = {"female": "Feminino", "male": "Masculino", "unknown": "Nao informado"}
    gender_totals = {"female": 0.0, "male": 0.0, "unknown": 0.0}

    for key, value in raw_gender_counts.items():
        token = str(key or "").strip().lower()
        if token.startswith('f'):
            gender_totals["female"] += float(value or 0.0)
        elif token.startswith('m'):
            gender_totals["male"] += float(value or 0.0)
        else:
            gender_totals["unknown"] += float(value or 0.0)

    gender_total = sum(gender_totals.values()) or 0.0
    gender = [
        {
            "key": key,
            "label": gender_labels.get(key, key.title()),
            "value": int(round(amount)),
            "percentage": as_percentage(amount, gender_total),
        }
        for key, amount in gender_totals.items()
    ]

    return {
        "cities": cities,
        "ages": ages,
        "gender": gender,
        "totals": {
            "cities": int(round(total_city)) if total_city else 0,
            "ages": int(round(age_total)) if age_total else 0,
            "gender": int(round(gender_total)) if gender_total else 0,
        },
    }


def fb_audience(page_id: str) -> Dict[str, Any]:
    """
    Retorna distribuição demográfica da audiência do Facebook.

    Coleta dados de:
    - Cidades (top 8)
    - Países (top 5)
    - Idade e gênero dos fãs da página

    Args:
        page_id: ID da página do Facebook

    Returns:
        Dict contendo cities, countries, ages, gender e totals
    """
    def as_percentage(value: float, total: float) -> float:
        """Calcula percentual com 2 casas decimais"""
        if not total:
            return 0.0
        return round((value / total) * 100.0, 2)

    # ==== CIDADES ====
    city_data = {}
    try:
        city_response = gget(
            f"/{page_id}/insights",
            {"metric": "page_fans_city", "period": "lifetime"}
        )
        if city_response and "data" in city_response:
            for item in city_response["data"]:
                if "values" in item and len(item["values"]) > 0:
                    city_data = item["values"][-1].get("value", {})
    except MetaAPIError as e:
        logger.warning(f"Erro ao buscar page_fans_city: {e}")

    top_cities = sorted(city_data.items(), key=lambda kv: kv[1], reverse=True)[:8]
    total_city = sum(city_data.values()) or 0.0

    cities = [
        {
            "name": name,
            "value": int(round(count)),
            "percentage": as_percentage(count, total_city),
        }
        for name, count in top_cities
    ]

    # ==== PAÍSES ====
    country_data = {}
    try:
        country_response = gget(
            f"/{page_id}/insights",
            {"metric": "page_fans_country", "period": "lifetime"}
        )
        if country_response and "data" in country_response:
            for item in country_response["data"]:
                if "values" in item and len(item["values"]) > 0:
                    country_data = item["values"][-1].get("value", {})
    except MetaAPIError as e:
        logger.warning(f"Erro ao buscar page_fans_country: {e}")

    top_countries = sorted(country_data.items(), key=lambda kv: kv[1], reverse=True)[:5]
    total_country = sum(country_data.values()) or 0.0

    countries = [
        {
            "name": name,
            "value": int(round(count)),
            "percentage": as_percentage(count, total_country),
        }
        for name, count in top_countries
    ]

    # ==== IDADE E GÊNERO ====
    age_gender_data = {}
    try:
        age_gender_response = gget(
            f"/{page_id}/insights",
            {"metric": "page_fans_gender_age", "period": "lifetime"}
        )
        if age_gender_response and "data" in age_gender_response:
            for item in age_gender_response["data"]:
                if "values" in item and len(item["values"]) > 0:
                    age_gender_data = item["values"][-1].get("value", {})
    except MetaAPIError as e:
        logger.warning(f"Erro ao buscar page_fans_gender_age: {e}")

    # Processar idade e gênero
    age_buckets = {
        "18-24": 0.0,
        "25-34": 0.0,
        "35-44": 0.0,
        "45-54": 0.0,
        "55+": 0.0,
    }
    gender_totals = {"female": 0.0, "male": 0.0, "unknown": 0.0}

    # Formato do Facebook: {"F.18-24": 123, "M.25-34": 456, "U.35-44": 78}
    for key, value in age_gender_data.items():
        parts = str(key).split('.')
        if len(parts) != 2:
            continue

        gender_char = parts[0].upper()
        age_range = parts[1]

        # Mapear gênero
        if gender_char == 'F':
            gender_totals["female"] += float(value or 0.0)
        elif gender_char == 'M':
            gender_totals["male"] += float(value or 0.0)
        else:
            gender_totals["unknown"] += float(value or 0.0)

        # Mapear faixa etária
        if age_range in ("18-24", "25-34", "35-44", "45-54"):
            age_buckets[age_range] += float(value or 0.0)
        elif age_range in ("55-64", "65+"):
            age_buckets["55+"] += float(value or 0.0)

    # Formatar dados de idade
    age_total = sum(age_buckets.values()) or 0.0
    ages = [
        {
            "range": label,
            "value": int(round(amount)),
            "percentage": as_percentage(amount, age_total),
        }
        for label, amount in age_buckets.items()
    ]

    # Formatar dados de gênero
    gender_labels = {"female": "Feminino", "male": "Masculino", "unknown": "Não informado"}
    gender_total = sum(gender_totals.values()) or 0.0
    gender = [
        {
            "key": key,
            "label": gender_labels.get(key, key.title()),
            "value": int(round(amount)),
            "percentage": as_percentage(amount, gender_total),
        }
        for key, amount in gender_totals.items()
    ]

    return {
        "cities": cities,
        "countries": countries,
        "ages": ages,
        "gender": gender,
        "totals": {
            "cities": int(round(total_city)) if total_city else 0,
            "countries": int(round(total_country)) if total_country else 0,
            "ages": int(round(age_total)) if age_total else 0,
            "gender": int(round(gender_total)) if gender_total else 0,
        },
    }


def ig_organic_summary(ig_user_id: str, since: int, until: int) -> Dict[str, Any]:
    """
    - varre mídias no intervalo para calcular:
      * tops: maior_engajamento, maior_alcance, maior_salvamentos
      * médias por formato (IMAGE, VIDEO, CAROUSEL_ALBUM)
    - stories: maior retenção (1 - exits/impressions), replay_rate (taps_back/impressions)
    """
    # ===== MÍDIAS DO FEED =====
    media_fields = "id,media_type,timestamp,like_count,comments_count,permalink,caption,media_url,thumbnail_url"
    media_res = gget(
        f"/{ig_user_id}/media",
        {"since": since, "until": until, "limit": 100, "fields": media_fields},
    )

    posts: List[Dict[str, Any]] = []
    format_aggr: Dict[str, Dict[str, float]] = {}

    def aggr_fmt(fmt, reach, interactions):
        rec = format_aggr.setdefault(fmt, {"reach": 0.0, "interactions": 0.0, "count": 0.0})
        rec["reach"] += _safe(reach)
        rec["interactions"] += _safe(interactions)
        rec["count"] += 1.0

    def score_interactions(item):
        return _safe(item.get("likes")) + _safe(item.get("comments")) + _safe(item.get("shares")) + _safe(item.get("saves"))

    paging = media_res
    while True:
        for it in paging.get("data", []):
            mid = it.get("id")
            # insights por mídia
            insights = {}
            try:
                ins = gget(f"/{mid}/insights", {"metric": "reach,shares,saved,likes,comments"})
                for row in ins.get("data", []):
                    insights[row.get("name")] = (row.get("values") or [{}])[0].get("value")
            except Exception:
                pass

            likes = it.get("like_count") or insights.get("likes") or 0
            comments = it.get("comments_count") or insights.get("comments") or 0
            shares = insights.get("shares") or 0
            saves = insights.get("saved") or insights.get("saves") or 0
            reach = insights.get("reach") or 0
            post_row = {
                "id": mid,
                "mediaType": it.get("media_type"),
                "timestamp": it.get("timestamp"),
                "permalink": it.get("permalink"),
                "caption": it.get("caption"),
                "previewUrl": it.get("media_url") or it.get("thumbnail_url"),
                "likes": _safe(likes, int),
                "comments": _safe(comments, int),
                "shares": _safe(shares, int),
                "saves": _safe(saves, int),
                "reach": _safe(reach, int),
                "total_interactions": _safe(likes, int) + _safe(comments, int) + _safe(shares, int) + _safe(saves, int),
            }
            posts.append(post_row)
            aggr_fmt(post_row["mediaType"] or "OTHER", post_row["reach"], post_row["total_interactions"])

        nextp = (paging.get("paging") or {}).get("next")
        if not nextp:
            break
        paging = requests.get(nextp, timeout=15).json()

    # TOPS
    def top_by(key):
        cand = None
        for p in posts:
            if cand is None or _safe(p.get(key)) > _safe(cand.get(key)):
                cand = p
        return cand

    tops = {
        "post_maior_engajamento": top_by("total_interactions"),
        "post_maior_alcance": top_by("reach"),
        "post_maior_salvamentos": top_by("saves"),
    }

    # MÉDIAS POR FORMATO
    by_format = []
    for fmt, rec in format_aggr.items():
        avg = None
        if rec["count"] > 0 and rec["reach"] > 0:
            avg = (rec["interactions"] / rec["reach"]) * 100.0
        by_format.append({
            "format": fmt,
            "avg_engagement_rate": round(avg, 2) if avg is not None else None,
            "avg_interactions": round(rec["interactions"] / rec["count"], 2) if rec["count"] else None,
            "avg_reach": round(rec["reach"] / rec["count"], 2) if rec["count"] else None,
            "count": int(rec["count"]),
        })

    # ===== STORIES =====
    # Algumas contas podem não retornar; tratamos de forma resiliente
    top_story = None
    try:
        stories_res = gget(f"/{ig_user_id}/stories", {"since": since, "until": until, "limit": 100, "fields": "id,permalink,timestamp"})
        best = None
        page_s = stories_res
        while True:
            for st in page_s.get("data", []):
                try:
                    sins = gget(
                        f"/{st['id']}/insights",
                        {"metric": "reach,exits,taps_forward,taps_back,replies"},
                    )
                except Exception:
                    continue
                vals = {row.get("name"): (row.get("values") or [{}])[0].get("value") for row in sins.get("data", [])}
                reach_val = _safe(vals.get("reach"), int)
                exits = _safe(vals.get("exits"), int)
                taps_back = _safe(vals.get("taps_back"), int)
                if reach_val <= 0:
                    continue
                retention = 1.0 - (exits / reach_val)
                replay_rate = (taps_back / reach_val) if reach_val else 0
                row = {
                    "id": st.get("id"),
                    "permalink": st.get("permalink"),
                    "timestamp": st.get("timestamp"),
                    "reach": reach_val,
                    "exits": exits,
                    "retention": round(retention * 100.0, 2),
                    "replay_rate": round(replay_rate * 100.0, 2),
                }
                if best is None or row["retention"] > best["retention"]:
                    best = row
            nextp = (page_s.get("paging") or {}).get("next")
            if not nextp:
                break
            page_s = requests.get(nextp, timeout=15).json()
        top_story = best
    except MetaAPIError:
        top_story = None

    return {
        "tops": tops,
        "formats": by_format,
        "top_story": top_story,
    }


def ig_recent_posts(ig_user_id: str, limit: int = 6):
    try:
        limit_int = int(limit or 6)
    except (TypeError, ValueError):
        limit_int = 6
    limit_sanitized = max(1, min(limit_int, 25))

    cache_key = f"{ig_user_id}|{limit_sanitized}"
    now_ts = time.time()
    cached = IG_POSTS_MEM_CACHE.get(cache_key)
    if cached and (now_ts - cached.get("ts", 0)) < IG_POSTS_MEM_CACHE_TTL_SEC:
        return copy.deepcopy(cached.get("data"))

    media_fields = (
        "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,"
        "children{media_type,media_url,thumbnail_url,permalink,caption}"
    )
    media_res = gget(
        f"/{ig_user_id}/media",
        {
            "limit": limit_sanitized,
            "fields": media_fields,
        },
    )

    posts = []
    VIDEO_TYPES = {"VIDEO", "REEL", "IGTV"}
    unsupported_insight_metrics: set[str] = set()

    def _coerce_numeric(value: Optional[Any]) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None

    def _fetch_media_insights(media_id: str, metrics: Sequence[str]) -> Dict[str, float]:
        request_metrics = [metric for metric in metrics if metric not in unsupported_insight_metrics]
        if not request_metrics:
            return {}
        params = {
            "metric": ",".join(request_metrics),
            "period": "lifetime",
        }
        try:
            response = gget(f"/{media_id}/insights", params)
        except MetaAPIError as err:
            if len(request_metrics) > 1:
                combined: Dict[str, float] = {}
                for metric in request_metrics:
                    combined.update(_fetch_media_insights(media_id, [metric]))
                return combined
            metric_name = request_metrics[0]
            logger.debug("Metric %s not supported for media %s: %s", metric_name, media_id, err)
            unsupported_insight_metrics.add(metric_name)
            return {}
        except Exception as err:  # noqa: BLE001
            logger.warning("Falha ao buscar insights do post %s: %s", media_id, err)
            return {}

        insight_values: Dict[str, float] = {}
        for entry in response.get("data", []) or []:
            name = str(entry.get("name") or "").lower()
            values = entry.get("values")
            value = None
            if isinstance(values, list):
                for candidate in values:
                    if isinstance(candidate, dict) and candidate.get("value") is not None:
                        value = candidate["value"]
                        break
            if value is None:
                value = entry.get("value")
            if isinstance(value, dict):
                value = value.get("value")
            numeric = _coerce_numeric(value)
            if numeric is None:
                continue
            insight_values[name] = numeric
        return insight_values

    def normalize_children(child_payload):
        if not child_payload:
            return []
        if isinstance(child_payload, dict):
            data = child_payload.get("data")
            if isinstance(data, list):
                return data
            return []
        if isinstance(child_payload, list):
            return child_payload
        return []

    for item in media_res.get("data", []):
        media_type = item.get("media_type")
        thumbnail_url = item.get("thumbnail_url")
        media_url = item.get("media_url")
        preview = None
        if media_type in VIDEO_TYPES and thumbnail_url:
            preview = thumbnail_url
        else:
            preview = media_url or thumbnail_url

        children_payload = normalize_children(item.get("children"))
        children = []
        for child in children_payload:
            child_media_type = child.get("media_type")
            child_thumbnail = child.get("thumbnail_url")
            child_media_url = child.get("media_url")
            child_preview = (
                child_thumbnail
                if child_media_type in VIDEO_TYPES and child_thumbnail
                else child_thumbnail or child_media_url
            )
            children.append({
                "id": child.get("id"),
                "caption": child.get("caption"),
                "mediaType": child_media_type,
                "mediaUrl": child_media_url,
                "thumbnailUrl": child_thumbnail,
                "permalink": child.get("permalink"),
                "previewUrl": child_preview,
            })

        posts.append({
            "id": item.get("id"),
            "caption": item.get("caption"),
            "mediaType": item.get("media_type"),
            "mediaUrl": item.get("media_url"),
            "thumbnailUrl": item.get("thumbnail_url"),
            "permalink": item.get("permalink"),
            "timestamp": item.get("timestamp"),
            "likeCount": item.get("like_count"),
            "commentsCount": item.get("comments_count"),
            "previewUrl": preview,
            "children": children,
        })

    account_fields = "id,username,profile_picture_url,followers_count"
    try:
        account = gget(f"/{ig_user_id}", {"fields": account_fields})
    except MetaAPIError:
        account = None

    insight_aliases = {
        "saved": "saves",
        "save": "saves",
        "saves": "saves",
        "shares": "shares",
    }

    for post in posts:
        media_id = post.get("id")
        if not media_id:
            continue
        insights = _fetch_media_insights(media_id, ("saved", "shares"))
        if insights:
            formatted = {}
            for key, numeric in insights.items():
                normalized = insight_aliases.get(key, key)
                value_int = int(round(numeric))
                formatted[normalized] = {"value": value_int}
                if normalized == "saves":
                    post["saves"] = value_int
                    post["saveCount"] = value_int
                if normalized == "shares":
                    post["shares"] = value_int
                    post["shareCount"] = value_int
            existing = post.get("insights") or {}
            existing.update(formatted)
            post["insights"] = existing
        # Garantir chaves presentes para o frontend calcular engajamento completo
        if "saves" not in post:
            post["saves"] = 0
        if "saveCount" not in post:
            post["saveCount"] = post["saves"]
        if "shares" not in post:
            post["shares"] = 0
        if "shareCount" not in post:
            post["shareCount"] = post["shares"]
        insights_container = post.get("insights") or {}
        insights_container.setdefault("saves", {"value": post["saves"]})
        insights_container.setdefault("shares", {"value": post["shares"]})
        post["insights"] = insights_container

    result = {
        "account": account,
        "posts": posts,
    }

    IG_POSTS_MEM_CACHE[cache_key] = {
        "ts": now_ts,
        "data": copy.deepcopy(result),
    }

    return result


def ig_recent_posts_insights(
    ig_user_id: str,
    limit: int = 5,
    since_ts: Optional[int] = None,
    until_ts: Optional[int] = None,
) -> Dict[str, Any]:
    try:
        limit_int = int(limit or 5)
    except (TypeError, ValueError):
        limit_int = 5
    limit_sanitized = max(1, min(limit_int, 10))
    fetch_limit = max(limit_sanitized * 5, 20)
    fetch_limit = max(1, min(fetch_limit, 50))

    media_fields = (
        "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count"
    )
    params: Dict[str, Any] = {"limit": fetch_limit, "fields": media_fields}
    if since_ts is not None:
        params["since"] = int(since_ts)
    if until_ts is not None:
        params["until"] = int(until_ts)

    media_res = gget(f"/{ig_user_id}/media", params)

    def _parse_timestamp_unix(timestamp_iso: Optional[str]) -> Optional[int]:
        if not timestamp_iso:
            return None
        try:
            timestamp_dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
            return int(timestamp_dt.timestamp())
        except ValueError:
            return None

    def _coerce_numeric(value: Optional[Any]) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None

    VIDEO_TYPES = {"VIDEO", "REEL", "IGTV"}
    posts: List[Dict[str, Any]] = []

    for item in media_res.get("data", []):
        timestamp_iso = item.get("timestamp")
        timestamp_unix = _parse_timestamp_unix(timestamp_iso)
        if since_ts is not None and timestamp_unix is not None and timestamp_unix < since_ts:
            continue
        if until_ts is not None and timestamp_unix is not None and timestamp_unix > until_ts:
            continue

        media_type = (item.get("media_type") or "").upper()
        media_product_type = (item.get("media_product_type") or "").upper()
        thumbnail_url = item.get("thumbnail_url")
        media_url = item.get("media_url")
        if media_type in VIDEO_TYPES and thumbnail_url:
            preview_url = thumbnail_url
        else:
            preview_url = media_url or thumbnail_url

        posts.append(
            {
                "id": item.get("id"),
                "caption": item.get("caption"),
                "media_type": item.get("media_type"),
                "media_product_type": item.get("media_product_type"),
                "media_url": media_url,
                "thumbnail_url": thumbnail_url,
                "preview_url": preview_url,
                "permalink": item.get("permalink"),
                "timestamp": timestamp_iso,
                "timestamp_unix": timestamp_unix,
                "like_count": item.get("like_count"),
                "comments_count": item.get("comments_count"),
            }
        )

    posts.sort(key=lambda post: post.get("timestamp_unix") or 0, reverse=True)
    posts = posts[:limit_sanitized]

    def _fetch_media_insights(media_id: str, metrics: Sequence[str]) -> Dict[str, float]:
        params = {
            "metric": ",".join(metrics),
            "period": "lifetime",
        }
        try:
            response = gget(f"/{media_id}/insights", params)
        except MetaAPIError as err:
            if len(metrics) > 1:
                combined: Dict[str, float] = {}
                for metric in metrics:
                    combined.update(_fetch_media_insights(media_id, [metric]))
                return combined
            logger.debug("Metric %s not supported for media %s: %s", metrics[0], media_id, err)
            return {}
        except Exception as err:  # noqa: BLE001
            logger.warning("Falha ao buscar insights do post %s: %s", media_id, err)
            return {}

        insight_values: Dict[str, float] = {}
        for entry in response.get("data", []) or []:
            name = str(entry.get("name") or "").lower()
            values = entry.get("values")
            value = None
            if isinstance(values, list):
                for candidate in values:
                    if isinstance(candidate, dict) and candidate.get("value") is not None:
                        value = candidate["value"]
                        break
            if value is None:
                value = entry.get("value")
            if isinstance(value, dict):
                value = value.get("value")
            numeric = _coerce_numeric(value)
            if numeric is None:
                continue
            insight_values[name] = numeric
        return insight_values

    for post in posts:
        media_id = post.get("id")
        if not media_id:
            continue
        media_type = (post.get("media_type") or "").upper()
        media_product_type = (post.get("media_product_type") or "").upper()
        is_video_type = media_type in VIDEO_TYPES or media_product_type in {"REELS", "VIDEO", "IGTV"}

        metrics_list = ["reach", "shares", "saved", "likes", "comments"]
        if is_video_type:
            metrics_list.append("video_views")

        insights_map = _fetch_media_insights(media_id, metrics_list)
        likes = insights_map.get("likes")
        comments = insights_map.get("comments")
        shares = insights_map.get("shares")
        saves = insights_map.get("saved") or insights_map.get("saves")
        reach_value = insights_map.get("reach")
        video_views_value = insights_map.get("video_views") or insights_map.get("views")

        likes = int(round(likes)) if likes is not None else int(post.get("like_count") or 0)
        comments = int(round(comments)) if comments is not None else int(post.get("comments_count") or 0)
        shares = int(round(shares)) if shares is not None else 0
        saves = int(round(saves)) if saves is not None else 0
        reach_value = int(round(reach_value)) if reach_value is not None else 0

        if is_video_type:
            views = int(round(video_views_value)) if video_views_value is not None else reach_value
        else:
            views = reach_value

        interactions = likes + comments + shares + saves

        post.update(
            {
                "likes": likes,
                "comments": comments,
                "shares": shares,
                "saves": saves,
                "reach": reach_value,
                "views": views,
                "interactions": interactions,
                "engagement_rate": round((interactions / reach_value) * 100, 2) if reach_value > 0 else None,
            }
        )

    account_fields = "id,username,profile_picture_url,followers_count"
    try:
        account = gget(f"/{ig_user_id}", {"fields": account_fields})
    except MetaAPIError:
        account = None

    return {
        "account": account,
        "posts": posts,
    }


def fb_recent_posts(page_id: str, limit: int = 6, since_ts: Optional[int] = None, until_ts: Optional[int] = None):
    page_token = get_page_access_token(page_id)
    try:
        limit_int = int(limit or 6)
    except (TypeError, ValueError):
        limit_int = 6
    limit_sanitized = max(1, min(limit_int, 25))
    fields = (
        "id,created_time,message,permalink_url,full_picture,story,"
        "attachments{media_type,type,media,url,description,subattachments},"
        "insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_clicks),"
        "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares"
    )
    params: Dict[str, Any] = {
        "limit": limit_sanitized,
        "fields": fields,
    }
    if since_ts is not None:
        params["since"] = int(since_ts)
    if until_ts is not None:
        params["until"] = int(until_ts)

    res = gget(f"/{page_id}/posts", params, token=page_token)
    posts: List[Dict[str, Any]] = []

    def extract_preview(att_list):
        for att in att_list:
            media = att.get("media") or {}
            image = (media.get("image") or {}).get("src") or media.get("source")
            if image:
                return image
            subatts = (att.get("subattachments") or {}).get("data", [])
            preview = extract_preview(subatts)
            if preview:
                return preview
            url = att.get("url")
            if url:
                return url
        return None

    def timestamp_in_range(ts: Optional[str]) -> bool:
        if ts is None or (since_ts is None and until_ts is None):
            return True
        normalized = ts.replace("Z", "+00:00")
        if normalized.endswith("+0000"):
            normalized = normalized[:-5] + "+00:00"
        try:
            dt = datetime.fromisoformat(normalized)
            epoch = int(dt.timestamp())
        except Exception:  # noqa: BLE001
            return True
        if since_ts is not None and epoch < since_ts:
            return False
        if until_ts is not None and epoch > until_ts:
            return False
        return True

    for item in res.get("data", []):
        attachments = (item.get("attachments") or {}).get("data", [])
        preview = item.get("full_picture") or extract_preview(attachments)
        reactions = ((item.get("reactions") or {}).get("summary") or {}).get("total_count", 0) or 0
        comments = ((item.get("comments") or {}).get("summary") or {}).get("total_count", 0) or 0
        shares = (item.get("shares") or {}).get("count", 0) or 0
        insights_data = (item.get("insights") or {}).get("data", [])
        impressions_val = insight_value_from_list(insights_data, "post_impressions")
        reach_val = insight_value_from_list(insights_data, "post_impressions_unique")
        engaged_users_val = insight_value_from_list(insights_data, "post_engaged_users")
        clicks_val = insight_value_from_list(insights_data, "post_clicks")

        impressions = int(round(impressions_val)) if impressions_val is not None else None
        reach = int(round(reach_val)) if reach_val is not None else impressions
        engaged_users = int(round(engaged_users_val)) if engaged_users_val is not None else None
        post_clicks = int(round(clicks_val)) if clicks_val is not None else None
        engagement_total = int(reactions) + int(comments) + int(shares)

        posts.append({
            "id": item.get("id"),
            "message": item.get("message") or item.get("story"),
            "permalink": item.get("permalink_url"),
            "timestamp": item.get("created_time"),
            "previewUrl": preview,
            "reactions": int(reactions),
            "comments": int(comments),
            "shares": int(shares),
            "impressions": impressions,
            "reach": reach,
            "engagedUsers": engaged_users,
            "clicks": post_clicks,
            "engagementTotal": engagement_total,
        })

    if since_ts is not None or until_ts is not None:
        posts = [post for post in posts if timestamp_in_range(post.get("timestamp"))]

    def top_post(metric_key: str) -> Optional[Dict[str, Any]]:
        best: Optional[Dict[str, Any]] = None
        best_value: float = -1.0
        for post in posts:
            value = post.get(metric_key)
            numeric = _coerce_number(value)
            if numeric is None:
                numeric = 0.0
            if numeric > best_value:
                best = post
                best_value = numeric
        if not best:
            return None
        clone = dict(best)
        clone["metricKey"] = metric_key
        clone["metricValue"] = best.get(metric_key)
        return clone

    highlights = {
        "post_top_engagement": top_post("engagementTotal"),
        "post_top_reach": top_post("reach"),
        "post_top_shares": top_post("shares"),
        "post_top_comments": top_post("comments"),
    }

    paging = res.get("paging") or {}
    return {
        "posts": posts,
        "highlights": highlights,
        "paging": {
            "next": bool(paging.get("next")),
            "previous": bool(paging.get("previous")),
        },
    }


# ---- Ads (Marketing API) ----

def ads_highlights(act_id: str, since_str: str, until_str: str):
    fields = (
        "campaign_id,campaign_name,objective,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions"
    )
    res = gget(
        f"/{act_id}/insights",
        {
            "fields": fields,
            "time_range[since]": since_str,
            "time_range[until]": until_str,
            "level": "campaign",
            "limit": 500,
        },
    )
    totals = {"spend": 0.0, "impressions": 0, "reach": 0, "clicks": 0}
    actions_totals: Dict[str, float] = {}
    campaigns: List[Dict[str, Any]] = []
    # buckets de video
    v3 = v10 = v15 = v30 = 0.0
    vavg = 0.0
    v_total = 0.0
    v_pct: Dict[str, float] = {"p25": 0.0, "p50": 0.0, "p75": 0.0, "p95": 0.0}
    conversion_types = (
        "offsite_conversion",
        "onsite_conversion.purchase",
        "purchase",
        "lead",
        "complete_registration",
    )

    def _parse_video_actions(actions: Any) -> Dict[str, Any]:
        metrics = {
            "views_3s": 0.0,
            "views_10s": 0.0,
            "views_15s": 0.0,
            "views_30s": 0.0,
            "thruplays": 0.0,
            "video_play": 0.0,
            "avg_time": None,
            "p25": 0.0,
            "p50": 0.0,
            "p75": 0.0,
            "p95": 0.0,
        }
        if not actions:
            return metrics
        for action in actions:
            if not isinstance(action, dict):
                continue
            action_type = action.get("action_type")
            if not action_type:
                continue
            normalized = str(action_type).lower()
            try:
                value = float(action.get("value", 0) or 0)
            except (TypeError, ValueError):
                value = 0.0
            if normalized in {"video_view", "video_views"}:
                metrics["views_3s"] += value
            if normalized in {"video_3_sec_watched_actions", "video_view_3s"}:
                metrics["views_3s"] += value
            elif normalized in {"video_10_sec_watched_actions", "video_view_10s"}:
                metrics["views_10s"] += value
            elif normalized in {"thruplay", "video_15_sec_watched_actions"}:
                metrics["views_15s"] += value
                metrics["thruplays"] += value
            elif normalized in {"video_30_sec_watched_actions", "video_view_30s"}:
                metrics["views_30s"] += value
            elif normalized in {"video_play_actions", "video_play"}:
                metrics["video_play"] += value
            elif normalized == "video_avg_time_watched_actions":
                metrics["avg_time"] = value
            elif normalized in {"video_p25_watched_actions", "video_view_25p"}:
                metrics["p25"] += value
            elif normalized in {"video_p50_watched_actions", "video_view_50p"}:
                metrics["p50"] += value
            elif normalized in {"video_p75_watched_actions", "video_view_75p"}:
                metrics["p75"] += value
            elif normalized in {"video_p95_watched_actions", "video_view_95p"}:
                metrics["p95"] += value
        return metrics

    for row in res.get("data", []):
        spend = float(row.get("spend", 0) or 0)
        impressions = int(row.get("impressions", 0) or 0)
        reach = int(row.get("reach", 0) or 0)
        clicks = int(row.get("clicks", 0) or 0)
        ctr = float(row.get("ctr", 0) or 0)
        cpc = float(row.get("cpc", 0) or 0)
        cpm = float(row.get("cpm", 0) or 0)
        frequency = float(row.get("frequency", 0) or 0)

        totals["spend"] += spend
        totals["impressions"] += impressions
        totals["reach"] += reach
        totals["clicks"] += clicks

        conversions = 0.0
        followers = 0.0
        for action in row.get("actions") or []:
            action_type = action.get("action_type")
            if not action_type:
                continue
            value = float(action.get("value", 0) or 0)
            actions_totals[action_type] = actions_totals.get(action_type, 0.0) + value
            if any(keyword in action_type for keyword in conversion_types):
                conversions += value
            if "page_follow" in action_type:
                followers += value
            # capturar ações típicas de vídeo
            normalized_action = (action_type or "").lower()
            if normalized_action in {"video_view", "video_views"}:
                v_total += value
                v3 += value
            if normalized_action in {"video_3_sec_watched_actions", "video_view_3s"}:
                v3 += value
            elif normalized_action in {"video_10_sec_watched_actions", "video_view_10s"}:
                v10 += value
            elif normalized_action in {"thruplay", "video_15_sec_watched_actions", "video_play_actions"}:
                v15 += value
            elif normalized_action in {"video_30_sec_watched_actions", "video_view_30s"}:
                v30 += value
            elif normalized_action == "video_avg_time_watched_actions":
                vavg += value
            elif normalized_action in {"video_p25_watched_actions", "video_view_25p"}:
                v_pct["p25"] += value
            elif normalized_action in {"video_p50_watched_actions", "video_view_50p"}:
                v_pct["p50"] += value
            elif normalized_action in {"video_p75_watched_actions", "video_view_75p"}:
                v_pct["p75"] += value
            elif normalized_action in {"video_p95_watched_actions", "video_view_95p"}:
                v_pct["p95"] += value

        campaign_entry = {
            "id": row.get("campaign_id") or row.get("campaign_name"),
            "name": row.get("campaign_name") or "Campanha",
            "objective": row.get("objective") or "",
            "impressions": impressions,
            "clicks": clicks,
            "ctr": ctr,
            "spend": spend,
            "cpc": cpc,
            "cpm": cpm,
            "frequency": frequency,
            "conversions": int(round(conversions)),
            "cpa": (spend / conversions) if conversions else None,
            "followers": int(round(followers)),
            "followers_gained": int(round(followers)),
        }
        campaigns.append(campaign_entry)

    averages = {
        "cpc": (totals["spend"] / totals["clicks"]) if totals["clicks"] else None,
        "cpm": (totals["spend"] / totals["impressions"] * 1000.0) if totals["impressions"] else None,
        "ctr": (totals["clicks"] / totals["impressions"] * 100.0) if totals["impressions"] else None,
        "frequency": (totals["impressions"] / totals["reach"]) if totals["reach"] else None,
    }

    actions_summary = [
        {"type": key, "value": value}
        for key, value in sorted(actions_totals.items(), key=lambda item: item[1], reverse=True)
    ]

    # Distribuição geográfica (spend por região)
    spend_by_region: List[Dict[str, Any]] = []
    try:
        region_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "spend,impressions,reach",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "account",
                "breakdowns": "region",
                "limit": 5000,
            },
        )
        region_totals: Dict[str, Dict[str, float]] = {}
        for row in region_res.get("data", []):
            region = row.get("region") or row.get("country") or "Desconhecido"
            spend = float(row.get("spend", 0) or 0)
            impressions = float(row.get("impressions", 0) or 0)
            reach = float(row.get("reach", 0) or 0)
            entry = region_totals.setdefault(region, {"spend": 0.0, "impressions": 0.0, "reach": 0.0})
            entry["spend"] += spend
            entry["impressions"] += impressions
            entry["reach"] += reach
        spend_by_region = [
            {
                "name": region,
                "spend": round(values["spend"], 2),
                "impressions": int(values["impressions"]),
                "reach": int(values["reach"]),
            }
            for region, values in region_totals.items()
            if values["spend"] > 0
        ]
        spend_by_region.sort(key=lambda item: item["spend"], reverse=True)
    except MetaAPIError:
        spend_by_region = []
    except Exception:
        spend_by_region = []

    # Distribuição geográfica (spend por cidade)
    spend_by_city: List[Dict[str, Any]] = []
    try:
        city_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "spend,impressions,reach",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "account",
                "breakdowns": "city",
                "limit": 5000,
            },
        )
        city_totals: Dict[str, Dict[str, float]] = {}
        for row in city_res.get("data", []):
            city = row.get("city") or row.get("region") or row.get("country") or "Desconhecido"
            spend = float(row.get("spend", 0) or 0)
            impressions = float(row.get("impressions", 0) or 0)
            reach = float(row.get("reach", 0) or 0)
            entry = city_totals.setdefault(city, {"spend": 0.0, "impressions": 0.0, "reach": 0.0})
            entry["spend"] += spend
            entry["impressions"] += impressions
            entry["reach"] += reach
        spend_by_city = [
            {
                "name": city,
                "spend": round(values["spend"], 2),
                "impressions": int(values["impressions"]),
                "reach": int(values["reach"]),
            }
            for city, values in city_totals.items()
            if values["spend"] > 0
        ]
        spend_by_city.sort(key=lambda item: item["spend"], reverse=True)
    except MetaAPIError:
        spend_by_city = []
    except Exception:
        spend_by_city = []

    video_ads: List[Dict[str, Any]] = []
    video_ads_summary: Optional[Dict[str, Any]] = None
    video_ads_timeseries: List[Dict[str, Any]] = []

    # detalhes por anúncio (criativos)
    def _pick_first_url(*candidates: Any) -> Optional[str]:
        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate
        return None

    def _preview_from_story_node(node: Any) -> Optional[str]:
        if not isinstance(node, dict):
            return None
        direct = _pick_first_url(
            node.get("image_url"),
            node.get("picture"),
            node.get("url"),
            node.get("thumbnail_url"),
        )
        if direct:
            return direct
        attachments = node.get("child_attachments") or node.get("attachments") or []
        if isinstance(attachments, list):
            for child in attachments:
                if not isinstance(child, dict):
                    continue
                candidate = _pick_first_url(
                    child.get("image_url"),
                    child.get("picture"),
                    child.get("url"),
                    child.get("thumbnail_url"),
                )
                if candidate:
                    return candidate
        return None

    def _preview_from_story_spec(spec: Any) -> Optional[str]:
        if not isinstance(spec, dict):
            return None
        for key in ("link_data", "video_data", "photo_data", "template_data", "story_data"):
            preview = _preview_from_story_node(spec.get(key))
            if preview:
                return preview
        return None

    def _preview_from_asset_feed(feed: Any) -> Optional[str]:
        if not isinstance(feed, dict):
            return None
        for bucket in ("images", "videos"):
            items = feed.get(bucket) or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                candidate = _pick_first_url(
                    item.get("thumbnail_url"),
                    item.get("image_url"),
                    item.get("url"),
                )
                if candidate:
                    return candidate
        return None

    def _extract_creative_preview(creative: Any) -> Optional[str]:
        if not isinstance(creative, dict):
            return None
        direct = _pick_first_url(
            creative.get("thumbnail_url"),
            creative.get("image_url"),
        )
        if direct:
            return direct
        preview = _preview_from_story_spec(creative.get("object_story_spec"))
        if preview:
            return preview
        preview = _preview_from_asset_feed(creative.get("asset_feed_spec"))
        if preview:
            return preview
        return None

    def _chunked(values: Sequence[str], size: int):
        for i in range(0, len(values), size):
            yield values[i : i + size]

    def _fetch_ad_previews(ad_ids: Sequence[str], limit: int = 24) -> Dict[str, str]:
        if not ad_ids:
            return {}
        seen: set = set()
        ordered: List[str] = []
        for ad_id in ad_ids:
            if not ad_id:
                continue
            ad_str = str(ad_id)
            if ad_str in seen:
                continue
            seen.add(ad_str)
            ordered.append(ad_str)
        if limit and len(ordered) > limit:
            ordered = ordered[:limit]
        previews: Dict[str, str] = {}
        fields = "creative{thumbnail_url,image_url,object_story_spec,asset_feed_spec}"
        for chunk in _chunked(ordered, 50):
            resp = gget("/", {"ids": ",".join(chunk), "fields": fields})
            if not isinstance(resp, dict):
                continue
            for ad_id, payload in resp.items():
                if not isinstance(payload, dict):
                    continue
                preview = _extract_creative_preview(payload.get("creative"))
                if preview:
                    previews[str(ad_id)] = preview
        return previews

    video_ads_totals = {
        "views_3s": 0.0,
        "views_10s": 0.0,
        "views_15s": 0.0,
        "views_30s": 0.0,
        "thruplays": 0.0,
        "video_play": 0.0,
    }
    video_ads_with_views = 0
    video_avg_time_total = 0.0
    video_avg_time_count = 0
    creatives: List[Dict[str, Any]] = []
    try:
        ads_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "ad_id,ad_name,impressions,reach,clicks,spend,ctr,cpc,actions",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "ad",
                "limit": 500,
            },
        )
        for row in ads_res.get("data", []):
            spend = float(row.get("spend", 0) or 0)
            impressions = int(row.get("impressions", 0) or 0)
            clicks = int(row.get("clicks", 0) or 0)
            ctr = float(row.get("ctr", 0) or 0)
            cpc = float(row.get("cpc", 0) or 0)
            ad_conversions = 0.0
            ad_followers = 0.0
            actions = row.get("actions") or []
            for action in actions:
                action_type = action.get("action_type")
                if not action_type:
                    continue
                value = float(action.get("value", 0) or 0)
                if any(keyword in action_type for keyword in conversion_types):
                    ad_conversions += value
                if "page_follow" in action_type:
                    ad_followers += value
            video_metrics = _parse_video_actions(actions)
            has_video_metrics = any(
                video_metrics[key] > 0
                for key in ("views_3s", "views_10s", "views_15s", "views_30s", "thruplays", "video_play")
            )
            if has_video_metrics or video_metrics.get("avg_time") is not None:
                ad_id = row.get("ad_id")
                ad_name = row.get("ad_name") or ad_id or "Anuncio"
                video_ads.append(
                    {
                        "ad_id": ad_id,
                        "ad_name": ad_name,
                        "views_3s": int(round(video_metrics["views_3s"])),
                        "views_10s": int(round(video_metrics["views_10s"])),
                        "views_15s": int(round(video_metrics["views_15s"])),
                        "views_30s": int(round(video_metrics["views_30s"])),
                        "thruplays": int(round(video_metrics["thruplays"])),
                        "video_play": int(round(video_metrics["video_play"])),
                        "avg_watch_time": video_metrics.get("avg_time"),
                    }
                )
                video_ads_totals["views_3s"] += video_metrics["views_3s"]
                video_ads_totals["views_10s"] += video_metrics["views_10s"]
                video_ads_totals["views_15s"] += video_metrics["views_15s"]
                video_ads_totals["views_30s"] += video_metrics["views_30s"]
                video_ads_totals["thruplays"] += video_metrics["thruplays"]
                video_ads_totals["video_play"] += video_metrics["video_play"]
                if video_metrics.get("avg_time") is not None:
                    video_avg_time_total += float(video_metrics["avg_time"])
                    video_avg_time_count += 1
                if has_video_metrics:
                    video_ads_with_views += 1
            creatives.append(
                {
                    "id": row.get("ad_id"),
                    "name": row.get("ad_name") or row.get("ad_id") or "Anúncio",
                    "impressions": impressions,
                    "reach": int(row.get("reach", 0) or 0),
                    "clicks": clicks,
                    "ctr": ctr,
                    "spend": spend,
                    "cpc": cpc,
                    "conversions": int(round(ad_conversions)),
                    "cpa": (spend / ad_conversions) if ad_conversions else None,
                    "followers": int(round(ad_followers)),
                    "followers_gained": int(round(ad_followers)),
                }
            )
        if video_ads:
            avg_views = video_ads_totals["views_3s"] / video_ads_with_views if video_ads_with_views else 0
            video_ads_summary = {
                "views_3s": int(round(video_ads_totals["views_3s"])),
                "views_10s": int(round(video_ads_totals["views_10s"])),
                "views_15s": int(round(video_ads_totals["views_15s"])),
                "views_30s": int(round(video_ads_totals["views_30s"])),
                "thruplays": int(round(video_ads_totals["thruplays"])),
                "video_play": int(round(video_ads_totals["video_play"])),
                "avg_views_3s": round(avg_views, 2),
                "avg_watch_time": (
                    (video_avg_time_total / video_avg_time_count) if video_avg_time_count else None
                ),
                "ads_total": len(video_ads),
                "ads_with_views": video_ads_with_views,
            }
        preview_map: Dict[str, str] = {}
        try:
            ranked_ids = [
                item.get("id")
                for item in sorted(creatives, key=lambda entry: entry.get("spend", 0), reverse=True)
                if item.get("id")
            ]
            preview_map = _fetch_ad_previews(ranked_ids)
        except MetaAPIError:
            preview_map = {}
        except Exception:
            preview_map = {}
        if preview_map:
            for creative in creatives:
                creative_id = creative.get("id")
                preview = preview_map.get(str(creative_id))
                if preview:
                    creative["preview_url"] = preview
    except MetaAPIError:
        creatives = []
        video_ads = []
        video_ads_summary = None
    except Exception:
        creatives = []
        video_ads = []
        video_ads_summary = None

    try:
        series_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "ad_id,ad_name,actions,date_start,date_stop",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "ad",
                "time_increment": 1,
                "limit": 500,
            },
        )
        series_map: Dict[str, Dict[str, Any]] = {}
        for row in series_res.get("data", []):
            ad_id = row.get("ad_id")
            if not ad_id:
                continue
            ad_name = row.get("ad_name") or ad_id
            date_value = row.get("date_start") or row.get("date_stop")
            if not date_value:
                continue
            metrics = _parse_video_actions(row.get("actions") or [])
            views_3s = metrics.get("views_3s") or 0
            bucket = series_map.setdefault(ad_id, {"ad_id": ad_id, "ad_name": ad_name, "series": {}})
            series_bucket = bucket["series"]
            series_bucket[date_value] = series_bucket.get(date_value, 0) + views_3s
        for bucket in series_map.values():
            series_bucket = bucket["series"]
            bucket["series"] = [
                {"date": date_key, "views_3s": int(round(value))}
                for date_key, value in sorted(series_bucket.items())
            ]
        video_ads_timeseries = list(series_map.values())
    except MetaAPIError:
        video_ads_timeseries = []
    except Exception:
        video_ads_timeseries = []

    # resumo de vídeo
    v3_final = int(v3 or v_total)
    video_summary = {
        "video_views_3s": v3_final,
        "video_views_10s": int(v10),
        "video_views_15s": int(v15),
        "video_views_30s": int(v30),
        "thruplays": int(v15),
        "video_avg_time_watched": float(vavg) if vavg > 0 else None,
        "video_completion_rate": round((v15 / v3_final) * 100.0, 2) if v3_final > 0 else None,
        "drop_off_points": [
          {"bucket": "0-3s", "views": int(v3_final)},
          {"bucket": "3-10s", "views": int(v10)},
          {"bucket": "10-15s", "views": int(v15)},
          {"bucket": "15-30s", "views": int(v30)},
          {"bucket": "25%", "views": int(v_pct["p25"])},
          {"bucket": "50%", "views": int(v_pct["p50"])},
          {"bucket": "75%", "views": int(v_pct["p75"])},
          {"bucket": "95%", "views": int(v_pct["p95"])},
        ],
    }

    # série de gastos diários
    spend_series: List[Dict[str, Any]] = []
    try:
        series_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "spend",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "account",
                "time_increment": 1,
                "limit": 500,
            },
        )
        for row in series_res.get("data", []):
            spend_value = float(row.get("spend", 0) or 0)
            date_value = row.get("date_start") or row.get("date_stop") or row.get("date")
            label = date_value
            try:
                label = datetime.fromisoformat(date_value).strftime("%d/%m") if date_value else date_value
            except Exception:  # noqa: BLE001
                pass
            spend_series.append({"date": label, "value": spend_value})
    except Exception:  # noqa: BLE001
        spend_series = []

    sorted_campaigns = sorted(campaigns, key=lambda item: item.get("spend", 0), reverse=True)
    top_campaigns = sorted_campaigns[:10] if sorted_campaigns else []
    best_entry = None
    try:
        best_entry = max(sorted_campaigns, key=lambda item: item.get("ctr") or 0)
    except ValueError:
        best_entry = None

    # Demografia (igual ao seu)
    try:
        demo_res = gget(
            f"/{act_id}/insights",
            {
                "fields": "reach,impressions,spend",
                "time_range[since]": since_str,
                "time_range[until]": until_str,
                "level": "account",
                "breakdowns": "age,gender",
                "limit": 500,
            },
        )
    except MetaAPIError:
        demo_res = {"data": []}

    gender_totals = {}
    age_totals = {}
    combo_totals = {}

    def label_gender(value: str) -> str:
        lookup = {"male": "Masculino", "female": "Feminino"}
        if value is None:
            return "Indefinido"
        return lookup.get(value.lower(), "Indefinido")

    for row in demo_res.get("data", []):
        gender = label_gender(row.get("gender"))
        age = row.get("age") or "Desconhecido"
        reach = int(row.get("reach", 0) or 0)
        impressions = int(row.get("impressions", 0) or 0)
        spend = float(row.get("spend", 0) or 0)

        gender_entry = gender_totals.setdefault(gender, {"reach": 0, "impressions": 0, "spend": 0.0})
        gender_entry["reach"] += reach
        gender_entry["impressions"] += impressions
        gender_entry["spend"] += spend

        age_entry = age_totals.setdefault(age, {"reach": 0, "impressions": 0, "spend": 0.0})
        age_entry["reach"] += reach
        age_entry["impressions"] += impressions
        age_entry["spend"] += spend

        combo_key = (age, gender)
        combo_entry = combo_totals.setdefault(
            combo_key,
            {"age": age, "gender": gender, "reach": 0, "impressions": 0, "spend": 0.0},
        )
        combo_entry["reach"] += reach
        combo_entry["impressions"] += impressions
        combo_entry["spend"] += spend

    age_order = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
    age_order_index = {age: idx for idx, age in enumerate(age_order)}
    gender_order = {"Masculino": 0, "Feminino": 1, "Indefinido": 2}

    def combo_sort_key(item):
        age = item.get("age") or ""
        gender = item.get("gender") or "Indefinido"
        return (
            age_order_index.get(age, len(age_order_index)),
            gender_order.get(gender, len(gender_order)),
            age,
            gender,
        )

    demographics = {
        "byGender": [
            {"segment": key, **values}
            for key, values in sorted(gender_totals.items(), key=lambda item: item[1]["reach"], reverse=True)
        ],
        "byAge": [
            {"segment": key, **values}
            for key, values in sorted(age_totals.items(), key=lambda item: item[1]["reach"], reverse=True)
        ],
        "byAgeGender": sorted(combo_totals.values(), key=combo_sort_key),
        "topSegments": sorted(combo_totals.values(), key=lambda item: item["reach"], reverse=True)[:5],
    }

    best_ad_payload = None
    if best_entry:
        best_ad_payload = {
            "ad_id": best_entry.get("id"),
            "ad_name": best_entry.get("name"),
            "campaign_name": best_entry.get("name"),
            "ctr": best_entry.get("ctr"),
            "cpc": best_entry.get("cpc"),
            "cpm": best_entry.get("cpm"),
            "frequency": best_entry.get("frequency"),
            "impressions": best_entry.get("impressions"),
            "reach": best_entry.get("reach"),
            "spend": best_entry.get("spend"),
            "clicks": best_entry.get("clicks"),
        }

    return {
        "best_ad": best_ad_payload,
        "totals": totals,
        "averages": averages,
        "actions": actions_summary,
        "demographics": demographics,
        "video_summary": video_summary,  # NOVO
        "video_ads_summary": video_ads_summary,
        "video_ads": video_ads,
        "video_ads_timeseries": video_ads_timeseries,
        "spend_series": spend_series,
        "campaigns": top_campaigns,
        "creatives": creatives,
        "spend_by_region": spend_by_region,
        "spend_by_city": spend_by_city,
    }
