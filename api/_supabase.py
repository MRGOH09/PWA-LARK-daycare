import os
from urllib.parse import quote

import requests


DEFAULT_ATTENDANCE_TABLE = "attendance_records"
DEFAULT_ATTENDANCE_EVENTS_TABLE = "attendance_events"


def supabase_config(env=None):
    env = env or {}
    url = (env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    service_key = (
        env.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()
    if not url or not service_key:
        return None
    return {
        "url": url,
        "service_key": service_key,
        "attendance_table": (
            env.get("SUPABASE_ATTENDANCE_TABLE")
            or os.environ.get("SUPABASE_ATTENDANCE_TABLE")
            or DEFAULT_ATTENDANCE_TABLE
        ).strip(),
        "events_table": (
            env.get("SUPABASE_ATTENDANCE_EVENTS_TABLE")
            or os.environ.get("SUPABASE_ATTENDANCE_EVENTS_TABLE")
            or DEFAULT_ATTENDANCE_EVENTS_TABLE
        ).strip(),
    }


def supabase_enabled(env=None):
    return supabase_config(env) is not None


def attendance_primary_is_supabase(env=None):
    env = env or {}
    mode = (env.get("ATTENDANCE_PRIMARY_STORE") or os.environ.get("ATTENDANCE_PRIMARY_STORE") or "").strip().lower()
    return mode == "supabase" and supabase_enabled(env)


def supabase_headers(config, prefer=None):
    headers = {
        "apikey": config["service_key"],
        "Authorization": f"Bearer {config['service_key']}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def table_url(config, table):
    return f"{config['url']}/rest/v1/{quote(table, safe='')}"


def raise_supabase_error(resp, action):
    if resp.status_code < 400:
        return
    detail = ""
    try:
        data = resp.json()
        msg = data.get("message") or data.get("msg") or data.get("hint") or data.get("details")
        code = data.get("code")
        if msg:
            detail = f": {msg}"
        if code:
            detail += f" (code {code})"
    except Exception:
        if resp.text:
            detail = f": {resp.text[:200]}"
    raise RuntimeError(f"Supabase {action} failed: HTTP {resp.status_code}{detail}")


def fetch_attendance_rows(env, date_text):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.get(
        table_url(config, config["attendance_table"]),
        headers=supabase_headers(config),
        params={
            "select": "*",
            "date": f"eq.{date_text}",
            "order": "campus.asc,block.asc,period.asc,student_no.asc,student_name.asc",
        },
        timeout=15,
    )
    raise_supabase_error(resp, "fetch attendance")
    return resp.json() or []


def fetch_attendance_row(env, date_text, student_record_id):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.get(
        table_url(config, config["attendance_table"]),
        headers=supabase_headers(config),
        params={
            "select": "*",
            "date": f"eq.{date_text}",
            "student_record_id": f"eq.{student_record_id}",
            "limit": "1",
        },
        timeout=15,
    )
    raise_supabase_error(resp, "fetch attendance row")
    rows = resp.json() or []
    return rows[0] if rows else None


def upsert_attendance_row(env, row):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = post_attendance_row(config, row)
    if resp.status_code >= 400 and "updated_by_" in (resp.text or ""):
        legacy_row = {
            key: value
            for key, value in row.items()
            if key not in {"updated_by_email", "updated_by_name"}
        }
        resp = post_attendance_row(config, legacy_row)
    raise_supabase_error(resp, "upsert attendance")
    rows = resp.json() or []
    return rows[0] if rows else {}


def post_attendance_row(config, row):
    return requests.post(
        table_url(config, config["attendance_table"]),
        headers=supabase_headers(config, "resolution=merge-duplicates,return=representation"),
        params={"on_conflict": "date,student_record_id"},
        json=row,
        timeout=15,
    )


def insert_attendance_events(env, events):
    if not events:
        return []
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = post_attendance_events(config, events)
    if resp.status_code >= 400 and "actor_" in (resp.text or ""):
        legacy_events = [
            {
                key: value
                for key, value in event.items()
                if key not in {"actor_email", "actor_name"}
            }
            for event in events
        ]
        resp = post_attendance_events(config, legacy_events)
    raise_supabase_error(resp, "insert attendance events")
    return resp.json() or []


def post_attendance_events(config, events):
    return requests.post(
        table_url(config, config["events_table"]),
        headers=supabase_headers(config, "return=representation"),
        json=events,
        timeout=15,
    )


def fetch_attendance_events(env, start_date, end_date):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.get(
        table_url(config, config["events_table"]),
        headers=supabase_headers(config),
        params=[
            ("select", "*"),
            ("date", f"gte.{start_date}"),
            ("date", f"lt.{end_date}"),
            ("order", "created_at.desc"),
        ],
        timeout=15,
    )
    raise_supabase_error(resp, "fetch attendance events")
    return resp.json() or []
