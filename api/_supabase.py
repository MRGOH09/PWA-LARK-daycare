import os
from datetime import datetime, timezone
from urllib.parse import quote

import requests


DEFAULT_ATTENDANCE_TABLE = "attendance_records"
DEFAULT_ATTENDANCE_EVENTS_TABLE = "attendance_events"
DEFAULT_SCORE_EVENTS_TABLE = "score_events"
DEFAULT_PARENT_PUSH_TABLE = "parent_push_subscriptions"
DEFAULT_PARENT_NOTIFICATION_TABLE = "parent_notification_events"
DEFAULT_PARENT_MESSAGES_TABLE = "parent_messages"
DEFAULT_TEACHER_MESSAGE_READS_TABLE = "teacher_message_reads"


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
        "score_events_table": (
            env.get("SUPABASE_SCORE_EVENTS_TABLE")
            or os.environ.get("SUPABASE_SCORE_EVENTS_TABLE")
            or DEFAULT_SCORE_EVENTS_TABLE
        ).strip(),
        "parent_push_table": (
            env.get("SUPABASE_PARENT_PUSH_TABLE")
            or os.environ.get("SUPABASE_PARENT_PUSH_TABLE")
            or DEFAULT_PARENT_PUSH_TABLE
        ).strip(),
        "parent_notification_table": (
            env.get("SUPABASE_PARENT_NOTIFICATION_TABLE")
            or os.environ.get("SUPABASE_PARENT_NOTIFICATION_TABLE")
            or DEFAULT_PARENT_NOTIFICATION_TABLE
        ).strip(),
        "parent_messages_table": (
            env.get("SUPABASE_PARENT_MESSAGES_TABLE")
            or os.environ.get("SUPABASE_PARENT_MESSAGES_TABLE")
            or DEFAULT_PARENT_MESSAGES_TABLE
        ).strip(),
        "teacher_message_reads_table": (
            env.get("SUPABASE_TEACHER_MESSAGE_READS_TABLE")
            or os.environ.get("SUPABASE_TEACHER_MESSAGE_READS_TABLE")
            or DEFAULT_TEACHER_MESSAGE_READS_TABLE
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
    post_row = row
    resp = post_attendance_row(config, post_row)
    if resp.status_code >= 400 and "pickup" in (resp.text or ""):
        post_row = {
            key: value
            for key, value in row.items()
            if key != "pickup"
        }
        resp = post_attendance_row(config, post_row)
    if resp.status_code >= 400 and "updated_by_" in (resp.text or ""):
        legacy_row = {
            key: value
            for key, value in post_row.items()
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


def fetch_table_rows(config, table, params, action, page_size=1000):
    rows = []
    offset = 0
    while True:
        headers = supabase_headers(config)
        headers["Range"] = f"{offset}-{offset + page_size - 1}"
        resp = requests.get(
            table_url(config, table),
            headers=headers,
            params=params,
            timeout=15,
        )
        raise_supabase_error(resp, action)
        page = resp.json() or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def fetch_attendance_events(env, start_date, end_date):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return fetch_table_rows(
        config,
        config["events_table"],
        [
            ("select", "*"),
            ("date", f"gte.{start_date}"),
            ("date", f"lt.{end_date}"),
            ("order", "created_at.desc"),
        ],
        "fetch attendance events",
    )


def fetch_student_attendance_events(env, student_record_id, limit=150):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.get(
        table_url(config, config["events_table"]),
        headers=supabase_headers(config),
        params=[
            ("select", "*"),
            ("student_record_id", f"eq.{student_record_id}"),
            ("order", "created_at.desc"),
            ("limit", str(limit)),
        ],
        timeout=15,
    )
    raise_supabase_error(resp, "fetch student attendance events")
    return resp.json() or []


def insert_score_event(env, row):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(
        table_url(config, config["score_events_table"]),
        headers=supabase_headers(config, "return=representation"),
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "insert score event")
    rows = resp.json() or []
    return rows[0] if rows else {}


def upsert_score_event(env, row, on_conflict="source,attendance_event_id"):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(
        table_url(config, config["score_events_table"]),
        headers=supabase_headers(config, "resolution=ignore-duplicates,return=representation"),
        params={"on_conflict": on_conflict},
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "upsert score event")
    rows = resp.json() or []
    return rows[0] if rows else {}


def fetch_score_events(env, student_record_id=None, start_date=None, limit=5000):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    params = [
        ("select", "*"),
        ("order", "created_at.desc"),
        ("limit", str(limit)),
    ]
    if student_record_id:
        params.append(("student_record_id", f"eq.{student_record_id}"))
    if start_date:
        params.append(("date", f"gte.{start_date}"))
    resp = requests.get(
        table_url(config, config["score_events_table"]),
        headers=supabase_headers(config),
        params=params,
        timeout=15,
    )
    raise_supabase_error(resp, "fetch score events")
    return resp.json() or []


def upsert_parent_push_subscription(env, row):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(
        table_url(config, config["parent_push_table"]),
        headers=supabase_headers(config, "resolution=merge-duplicates,return=representation"),
        params={"on_conflict": "parent_email,endpoint"},
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "upsert parent push subscription")
    rows = resp.json() or []
    return rows[0] if rows else {}


def fetch_parent_push_subscriptions(env, parent_email):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.get(
        table_url(config, config["parent_push_table"]),
        headers=supabase_headers(config),
        params=[
            ("select", "*"),
            ("parent_email", f"eq.{parent_email}"),
            ("enabled", "eq.true"),
            ("order", "last_seen_at.desc"),
        ],
        timeout=15,
    )
    raise_supabase_error(resp, "fetch parent push subscriptions")
    return resp.json() or []


def upsert_parent_notification_event(env, row):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(
        table_url(config, config["parent_notification_table"]),
        headers=supabase_headers(config, "resolution=merge-duplicates,return=representation"),
        params={"on_conflict": "source_type,source_id,parent_email"},
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "upsert parent notification event")
    rows = resp.json() or []
    return rows[0] if rows else {}


def update_parent_notification_status(env, notification_id, status, error=""):
    config = supabase_config(env)
    if not config or not notification_id:
        return {}
    row = {"push_status": status, "push_error": error}
    if status == "sent":
        row["sent_at"] = datetime.now(timezone.utc).isoformat()
    resp = requests.patch(
        table_url(config, config["parent_notification_table"]),
        headers=supabase_headers(config, "return=representation"),
        params={"id": f"eq.{notification_id}"},
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "update parent notification event")
    rows = resp.json() or []
    return rows[0] if rows else {}


def fetch_parent_messages(env, student_record_id=None, limit=200, ascending=True):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    params = [
        ("select", "*"),
        ("order", f"created_at.{'asc' if ascending else 'desc'}"),
        ("limit", str(limit)),
    ]
    if student_record_id:
        params.append(("student_record_id", f"eq.{student_record_id}"))
    resp = requests.get(
        table_url(config, config["parent_messages_table"]),
        headers=supabase_headers(config),
        params=params,
        timeout=15,
    )
    raise_supabase_error(resp, "fetch parent messages")
    return resp.json() or []


def insert_parent_message(env, row):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(
        table_url(config, config["parent_messages_table"]),
        headers=supabase_headers(config, "return=representation"),
        json=row,
        timeout=15,
    )
    if resp.status_code >= 400 and "mentions" in (resp.text or ""):
        legacy_row = {key: value for key, value in row.items() if key != "mentions"}
        resp = requests.post(
            table_url(config, config["parent_messages_table"]),
            headers=supabase_headers(config, "return=representation"),
            json=legacy_row,
            timeout=15,
        )
    raise_supabase_error(resp, "insert parent message")
    rows = resp.json() or []
    return rows[0] if rows else {}


def fetch_teacher_message_reads(env, teacher_email):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    teacher_email = str(teacher_email or "").strip().lower()
    if not teacher_email:
        return []
    resp = requests.get(
        table_url(config, config["teacher_message_reads_table"]),
        headers=supabase_headers(config),
        params=[
            ("select", "*"),
            ("teacher_email", f"eq.{teacher_email}"),
            ("order", "updated_at.desc"),
        ],
        timeout=15,
    )
    raise_supabase_error(resp, "fetch teacher message reads")
    return resp.json() or []


def upsert_teacher_message_read(env, teacher_email, student_record_id, last_seen_at):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    row = {
        "teacher_email": str(teacher_email or "").strip().lower(),
        "student_record_id": str(student_record_id or "").strip(),
        "last_seen_at": str(last_seen_at or "").strip(),
    }
    if not row["teacher_email"] or not row["student_record_id"] or not row["last_seen_at"]:
        raise RuntimeError("Missing teacher_email, student_record_id, or last_seen_at")
    resp = requests.post(
        table_url(config, config["teacher_message_reads_table"]),
        headers=supabase_headers(config, "resolution=merge-duplicates,return=representation"),
        params={"on_conflict": "teacher_email,student_record_id"},
        json=row,
        timeout=15,
    )
    raise_supabase_error(resp, "upsert teacher message read")
    rows = resp.json() or []
    return rows[0] if rows else {}
