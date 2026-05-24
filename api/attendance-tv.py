from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (  # noqa: E402
    fetch_attendance_records,
    fetch_student_records,
    get_env,
    get_tenant_access_token,
    normalize_generic_record,
    send_json,
)
from _noble_star import score_points, score_sum, tier_payload  # noqa: E402
from _supabase import (  # noqa: E402
    fetch_attendance_rows as fetch_supabase_attendance_rows,
    fetch_score_events,
    supabase_enabled,
)
from attendance import (  # noqa: E402
    normalized_attendance_record,
    normalized_supabase_record,
)


TZ = timezone(timedelta(hours=8))

STUDENT_FIELD_NO = "NO"
STUDENT_FIELD_NAME = "学生名字"
STUDENT_FIELD_YEAR = "YEAR / FORM"
STUDENT_FIELD_TEACHER = "负责老师"
STUDENT_FIELD_PERIOD = "时间段"
STUDENT_FIELD_BLOCK = "BLOCK"
STUDENT_FIELD_CAMPUS = "分院"
STUDENT_FIELD_STOP_MONTH = "Stop 月份"

DEFAULT_PIN = "7373"


def query_params(path):
    return parse_qs(urlparse(path).query)


def clean_text(value):
    return str(value or "").strip()


def today_date():
    return datetime.now(TZ).date().isoformat()


def parse_date(value):
    text = clean_text(value)
    if not text:
        return today_date()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        raise RuntimeError("日期格式必须是 YYYY-MM-DD")
    return text


def month_start(date_text):
    return f"{date_text[:7]}-01"


def expected_pin():
    return clean_text(os.environ.get("ATTENDANCE_TV_PIN")) or DEFAULT_PIN


def pin_from_request(handler, params):
    header_pin = clean_text(handler.headers.get("X-Attendance-TV-PIN"))
    query_pin = clean_text((params.get("pin") or [""])[0])
    return header_pin or query_pin


def require_pin(handler, params):
    if pin_from_request(handler, params) != expected_pin():
        send_json(handler, 401, {"success": False, "error": "PIN 不正确"})
        return False
    return True


def should_use_supabase(env):
    mode = clean_text(env.get("ATTENDANCE_PRIMARY_STORE")).lower()
    if mode != "supabase":
        return False
    if not supabase_enabled(env):
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return True


def student_field(record, field):
    return clean_text((record.get("fields") or {}).get(field))


def time_segment(value):
    raw = clean_text(value)
    text = raw.lower()
    if "早" in raw or "morning" in text or "am" in text:
        return "早上"
    if "晚" in raw or "evening" in text or "night" in text:
        return "晚上"
    if "下" in raw or "afternoon" in text or "pm" in text:
        return "下午"
    return raw or "未填时间段"


def normalize_student(item):
    record = normalize_generic_record(item)
    return {
        "recordId": record.get("recordId", ""),
        "no": student_field(record, STUDENT_FIELD_NO),
        "name": student_field(record, STUDENT_FIELD_NAME),
        "year": student_field(record, STUDENT_FIELD_YEAR),
        "teacher": student_field(record, STUDENT_FIELD_TEACHER),
        "period": time_segment(student_field(record, STUDENT_FIELD_PERIOD)),
        "rawPeriod": student_field(record, STUDENT_FIELD_PERIOD),
        "block": student_field(record, STUDENT_FIELD_BLOCK),
        "campus": student_field(record, STUDENT_FIELD_CAMPUS),
        "stopped": bool(student_field(record, STUDENT_FIELD_STOP_MONTH)),
    }


def fetch_attendance(env, date_text):
    if should_use_supabase(env):
        rows = fetch_supabase_attendance_rows(env, date_text)
        return "supabase", [normalized_supabase_record(row) for row in rows]

    if not env.get("LARK_ATTENDANCE_TABLE_ID"):
        raise RuntimeError("Missing LARK_ATTENDANCE_TABLE_ID")
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    records = [
        normalized_attendance_record(item)
        for item in fetch_attendance_records(token, env)
    ]
    return "lark", [record for record in records if record.get("date") == date_text]


def value_options(records, key):
    seen = set()
    out = []
    for record in records:
        value = clean_text(record.get(key))
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return sorted(out, key=lambda item: item.lower())


def empty_score_summary():
    return {
        "todayEarnedPoints": 0,
        "todayNetPoints": 0,
        "monthPoints": 0,
        "tier": tier_payload(0),
    }


def score_summary(rows, date_text):
    today_rows = [row for row in rows if clean_text(row.get("date")) == date_text]
    positive_today = [row for row in today_rows if score_points(row) > 0]
    month_points = score_sum(rows)
    return {
        "todayEarnedPoints": score_sum(positive_today),
        "todayNetPoints": score_sum(today_rows),
        "monthPoints": month_points,
        "tier": tier_payload(month_points),
    }


def score_summaries_for_students(env, students, date_text):
    if not supabase_enabled(env):
        return {}, ["Noble Star skipped: Supabase is not configured"]
    ids = {student.get("recordId") for student in students if student.get("recordId")}
    if not ids:
        return {}, []
    rows = fetch_score_events(env, start_date=month_start(date_text), limit=10000)
    grouped = {}
    for row in rows:
        student_id = clean_text(row.get("student_record_id"))
        if student_id in ids:
            grouped.setdefault(student_id, []).append(row)
    return {
        student_id: score_summary(grouped.get(student_id, []), date_text)
        for student_id in ids
    }, []


def build_payload(env, date_text):
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    students = [
        normalize_student(item)
        for item in fetch_student_records(token, env)
    ]
    active_students = [student for student in students if not student["stopped"]]
    source, attendance_records = fetch_attendance(env, date_text)
    sync_warnings = []
    try:
        scores_by_student, score_warnings = score_summaries_for_students(env, active_students, date_text)
        sync_warnings.extend(score_warnings)
    except Exception as exc:
        scores_by_student = {}
        sync_warnings.append(f"Noble Star sync failed: {exc}")
    return {
        "success": True,
        "date": date_text,
        "source": source,
        "updatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
        "students": active_students,
        "attendance": attendance_records,
        "scoresByStudentRecordId": scores_by_student,
        "options": {
            "campuses": value_options(active_students, "campus"),
            "blocks": value_options(active_students, "block"),
            "periods": value_options(active_students, "period"),
        },
        "counts": {
            "students": len(active_students),
            "attendance": len(attendance_records),
        },
        "syncWarnings": sync_warnings,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            params = query_params(self.path)
            if not require_pin(self, params):
                return
            env = get_env()
            date_text = parse_date((params.get("date") or [""])[0])
            send_json(self, 200, build_payload(env, date_text))
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
