from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (  # noqa: E402
    extract_text,
    fetch_attendance_records,
    get_env,
    get_tenant_access_token,
    lark_create_record,
    lark_update_record,
    read_json_body,
    send_json,
)
from _auth import AuthError, fetch_whitelist_profiles, require_attendance_auth  # noqa: E402
from _supabase import (  # noqa: E402
    fetch_attendance_row as fetch_supabase_attendance_row,
    fetch_attendance_rows as fetch_supabase_attendance_rows,
    insert_attendance_events,
    supabase_enabled,
    upsert_attendance_row,
)


TZ = timezone(timedelta(hours=8))

FIELD_DATE = "日期"
FIELD_WEEKDAY = "星期"
FIELD_PERIOD = "时间段"
FIELD_STUDENT_RECORD_ID = "学生RecordID"
FIELD_STUDENT_NO = "学生NO"
FIELD_STUDENT_NAME = "学生名字"
FIELD_YEAR = "YEAR / FORM"
FIELD_BLOCK = "BLOCK"
FIELD_CAMPUS = "分院"
FIELD_TEACHER = "负责老师"
FIELD_ARRIVAL = "到了补习中心"
FIELD_TUITION = "去补习了"
FIELD_SHOWER = "冲凉了"
FIELD_MEAL = "吃饭"
FIELD_HOMEWORK = "功课完成"
FIELD_EXTRA = "extra复习"
FIELD_HOME = "回家"
FIELD_NOTE = "备注"
FIELD_UPDATED_AT = "最后更新时间"

STATUS_SPECS = {
    "arrival": (FIELD_ARRIVAL, "未点", {"未点", "到了", "还没有", "缺席", "KOKO"}),
    "tuition": (FIELD_TUITION, "未点", {"未点", "去了", "迟进补习"}),
    "shower": (FIELD_SHOWER, "未点", {"未点", "冲了", "不冲凉"}),
    "meal": (FIELD_MEAL, "未点", {"未点", "吃饭了", "不吃饭"}),
    "homework": (FIELD_HOMEWORK, "未点", {"未点", "完成了", "没完成"}),
    "extra": (FIELD_EXTRA, "未点", {"未点", "extra复习了", "没有复习"}),
    "home": (FIELD_HOME, "未回家", {"未回家", "回家"}),
}

WEEKDAYS = {"MON", "TUE", "WED", "THUR", "FRI"}
WEEKDAY_ALIASES = {
    "MON": "MON",
    "TUE": "TUE",
    "WED": "WED",
    "THU": "THUR",
    "THUR": "THUR",
    "FRI": "FRI",
    "星期一": "MON",
    "星期二": "TUE",
    "星期三": "WED",
    "星期四": "THUR",
    "星期五": "FRI",
    "周一": "MON",
    "周二": "TUE",
    "周三": "WED",
    "周四": "THUR",
    "周五": "FRI",
    "一": "MON",
    "二": "TUE",
    "三": "WED",
    "四": "THUR",
    "五": "FRI",
}


def today_date():
    return datetime.now(TZ).date().isoformat()


def parse_date(value):
    text = str(value or "").strip()
    if not text:
        return today_date()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        raise RuntimeError("日期格式必须是 YYYY-MM-DD")
    return text


def date_to_ms(date_text):
    dt = datetime.strptime(date_text, "%Y-%m-%d").replace(tzinfo=TZ)
    return int(dt.timestamp() * 1000)


def now_ms():
    return int(datetime.now(TZ).timestamp() * 1000)


def date_value_to_text(value):
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value) / 1000, TZ).date().isoformat()
    text = extract_text(value)
    if not text:
        return ""
    if re.match(r"^\d{13}$", text):
        return datetime.fromtimestamp(int(text) / 1000, TZ).date().isoformat()
    if re.match(r"^\d{10}$", text):
        return datetime.fromtimestamp(int(text), TZ).date().isoformat()
    text = text.replace("/", "-")
    match = re.search(r"\d{4}-\d{1,2}-\d{1,2}", text)
    if not match:
        return text
    year, month, day = match.group().split("-")
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def datetime_value_to_text(value):
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value) / 1000, TZ).isoformat(timespec="seconds")
    text = extract_text(value)
    if re.match(r"^\d{13}$", text):
        return datetime.fromtimestamp(int(text) / 1000, TZ).isoformat(timespec="seconds")
    if re.match(r"^\d{10}$", text):
        return datetime.fromtimestamp(int(text), TZ).isoformat(timespec="seconds")
    return text


def ms_to_iso(value):
    if value is None or value == "":
        return datetime.now(TZ).isoformat(timespec="seconds")
    return datetime.fromtimestamp(float(value) / 1000, TZ).isoformat(timespec="seconds")


def normalized_attendance_record(item):
    fields = item.get("fields", {}) or {}
    return {
        "recordId": item.get("record_id", ""),
        "date": date_value_to_text(fields.get(FIELD_DATE)),
        "weekday": extract_text(fields.get(FIELD_WEEKDAY)),
        "period": extract_text(fields.get(FIELD_PERIOD)),
        "studentRecordId": extract_text(fields.get(FIELD_STUDENT_RECORD_ID)),
        "studentNo": extract_text(fields.get(FIELD_STUDENT_NO)),
        "studentName": extract_text(fields.get(FIELD_STUDENT_NAME)),
        "year": extract_text(fields.get(FIELD_YEAR)),
        "block": extract_text(fields.get(FIELD_BLOCK)),
        "campus": extract_text(fields.get(FIELD_CAMPUS)),
        "teacher": extract_text(fields.get(FIELD_TEACHER)),
        "arrival": extract_text(fields.get(FIELD_ARRIVAL)) or "未点",
        "tuition": extract_text(fields.get(FIELD_TUITION)) or "未点",
        "shower": extract_text(fields.get(FIELD_SHOWER)) or "未点",
        "meal": extract_text(fields.get(FIELD_MEAL)) or "未点",
        "homework": extract_text(fields.get(FIELD_HOMEWORK)) or "未点",
        "extra": extract_text(fields.get(FIELD_EXTRA)) or "未点",
        "home": extract_text(fields.get(FIELD_HOME)) or "未回家",
        "note": extract_text(fields.get(FIELD_NOTE)),
        "updatedAt": datetime_value_to_text(fields.get(FIELD_UPDATED_AT)),
    }


def normalized_supabase_record(row):
    row = row or {}
    return {
        "recordId": row.get("id", ""),
        "date": clean_text(row.get("date")),
        "weekday": clean_text(row.get("weekday")),
        "period": clean_text(row.get("period")),
        "studentRecordId": clean_text(row.get("student_record_id")),
        "studentNo": clean_text(row.get("student_no")),
        "studentName": clean_text(row.get("student_name")),
        "year": clean_text(row.get("year_form")),
        "block": clean_text(row.get("block")),
        "campus": clean_text(row.get("campus")),
        "teacher": clean_text(row.get("teacher")),
        "arrival": clean_text(row.get("arrival")) or "未点",
        "tuition": clean_text(row.get("tuition")) or "未点",
        "shower": clean_text(row.get("shower")) or "未点",
        "meal": clean_text(row.get("meal")) or "未点",
        "homework": clean_text(row.get("homework")) or "未点",
        "extra": clean_text(row.get("extra")) or "未点",
        "home": clean_text(row.get("home")) or "未回家",
        "note": clean_text(row.get("note")),
        "updatedAt": clean_text(row.get("updated_at")),
        "updatedByEmail": clean_text(row.get("updated_by_email")),
        "updatedByName": clean_text(row.get("updated_by_name")),
    }


def query_params(path):
    return parse_qs(urlparse(path).query)


def clean_text(value):
    return str(value or "").strip()


def sanitize_weekday(value):
    text = clean_text(value).upper()
    text = WEEKDAY_ALIASES.get(text, WEEKDAY_ALIASES.get(clean_text(value), text))
    return text if text in WEEKDAYS else ""


def sanitize_attendance_payload(body):
    student = body.get("student") or {}
    if not isinstance(student, dict):
        student = {}
    student_record_id = clean_text(student.get("recordId") or body.get("studentRecordId"))
    if not student_record_id:
        raise RuntimeError("Missing studentRecordId")

    date_text = parse_date(body.get("date"))
    attendance = body.get("attendance") or {}
    if not isinstance(attendance, dict):
        attendance = {}

    fields = {
        FIELD_DATE: date_to_ms(date_text),
        FIELD_PERIOD: clean_text(student.get("period") or body.get("period")),
        FIELD_STUDENT_RECORD_ID: student_record_id,
        FIELD_STUDENT_NO: clean_text(student.get("no")),
        FIELD_STUDENT_NAME: clean_text(student.get("name")),
        FIELD_YEAR: clean_text(student.get("year")),
        FIELD_BLOCK: clean_text(student.get("block")),
        FIELD_CAMPUS: clean_text(student.get("campus")),
        FIELD_TEACHER: clean_text(student.get("teacher")),
        FIELD_UPDATED_AT: now_ms(),
    }
    weekday = sanitize_weekday(body.get("weekday"))
    if weekday:
        fields[FIELD_WEEKDAY] = weekday

    for key, (field_name, default, allowed) in STATUS_SPECS.items():
        value = clean_text(attendance.get(key)) or default
        if value not in allowed:
            raise RuntimeError(f"{field_name} 的状态不合法：{value}")
        fields[field_name] = value

    if "note" in attendance:
        fields[FIELD_NOTE] = clean_text(attendance.get("note"))

    return date_text, student_record_id, fields


def find_existing(records, date_text, student_record_id):
    matches = [
        record for record in records
        if record.get("date") == date_text and record.get("studentRecordId") == student_record_id
    ]
    return (matches[0] if matches else None), len(matches)


def should_use_supabase(env):
    mode = clean_text(env.get("ATTENDANCE_PRIMARY_STORE")).lower()
    if mode != "supabase":
        return False
    if not supabase_enabled(env):
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return True


def should_sync_lark(env):
    raw = clean_text(env.get("ATTENDANCE_SYNC_LARK") or "1").lower()
    return raw not in {"0", "false", "no", "off"} and bool(env.get("LARK_ATTENDANCE_TABLE_ID"))


def actor_from_auth(user, env=None):
    user = user or {}
    email = clean_text(user.get("email")).lower()
    name = clean_text(user.get("name")) or email
    if email and env:
        try:
            formal_name = clean_text((fetch_whitelist_profiles(env).get(email) or {}).get("name"))
            if formal_name:
                name = formal_name
        except Exception:
            pass
    return {"email": email, "name": name}


def supabase_row_from_fields(date_text, student_record_id, fields, actor=None):
    actor = actor or {}
    row = {
        "date": date_text,
        "weekday": clean_text(fields.get(FIELD_WEEKDAY)) or None,
        "period": clean_text(fields.get(FIELD_PERIOD)),
        "student_record_id": student_record_id,
        "student_no": clean_text(fields.get(FIELD_STUDENT_NO)),
        "student_name": clean_text(fields.get(FIELD_STUDENT_NAME)),
        "year_form": clean_text(fields.get(FIELD_YEAR)),
        "block": clean_text(fields.get(FIELD_BLOCK)),
        "campus": clean_text(fields.get(FIELD_CAMPUS)),
        "teacher": clean_text(fields.get(FIELD_TEACHER)),
        "note": clean_text(fields.get(FIELD_NOTE)),
        "updated_at": ms_to_iso(fields.get(FIELD_UPDATED_AT)),
        "updated_by_email": clean_text(actor.get("email")).lower(),
        "updated_by_name": clean_text(actor.get("name")),
    }
    for key, (field_name, _default, _allowed) in STATUS_SPECS.items():
        row[key] = clean_text(fields.get(field_name))
    return row


def attendance_events_from_change(old_record, new_record, actor=None):
    events = []
    actor = actor or {}
    old_record = old_record or {}
    attendance_record_id = new_record.get("recordId")
    if not attendance_record_id:
        return events
    for key, (_field_name, default, _allowed) in STATUS_SPECS.items():
        old_value = old_record.get(key, default)
        new_value = new_record.get(key, default)
        if old_record and old_value == new_value:
            continue
        if not old_record and new_value == default:
            continue
        events.append({
            "attendance_record_id": attendance_record_id,
            "date": new_record.get("date"),
            "student_record_id": new_record.get("studentRecordId"),
            "step_key": key,
            "old_value": old_value,
            "new_value": new_value,
            "source": "pwa",
            "actor_email": clean_text(actor.get("email")).lower(),
            "actor_name": clean_text(actor.get("name")),
        })
    if old_record and old_record.get("note", "") != new_record.get("note", ""):
        events.append({
            "attendance_record_id": attendance_record_id,
            "date": new_record.get("date"),
            "student_record_id": new_record.get("studentRecordId"),
            "step_key": "note",
            "old_value": old_record.get("note", ""),
            "new_value": new_record.get("note", ""),
            "source": "pwa",
            "actor_email": clean_text(actor.get("email")).lower(),
            "actor_name": clean_text(actor.get("name")),
        })
    return events


def save_lark_attendance(env, date_text, student_record_id, fields):
    if not env.get("LARK_ATTENDANCE_TABLE_ID"):
        raise RuntimeError("Missing LARK_ATTENDANCE_TABLE_ID")
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    existing_records = [
        normalized_attendance_record(item)
        for item in fetch_attendance_records(token, env)
    ]
    existing, duplicate_count = find_existing(existing_records, date_text, student_record_id)
    table_id = env["LARK_ATTENDANCE_TABLE_ID"]
    if existing:
        raw = lark_update_record(token, env, existing["recordId"], fields, table_id=table_id)
        action = "updated"
    else:
        raw = lark_create_record(token, env, fields, table_id=table_id)
        action = "created"
    return {
        "action": action,
        "duplicateCount": duplicate_count,
        "record": normalized_attendance_record(raw) if raw else None,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            require_attendance_auth(self, env)
            params = query_params(self.path)
            date_text = parse_date((params.get("date") or [""])[0])
            if should_use_supabase(env):
                rows = fetch_supabase_attendance_rows(env, date_text)
                records = [normalized_supabase_record(row) for row in rows]
                source = "supabase"
            else:
                if not env.get("LARK_ATTENDANCE_TABLE_ID"):
                    send_json(self, 500, {"success": False, "error": "Missing LARK_ATTENDANCE_TABLE_ID"})
                    return
                token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
                records = [
                    normalized_attendance_record(item)
                    for item in fetch_attendance_records(token, env)
                ]
                records = [record for record in records if record.get("date") == date_text]
                source = "lark"
            send_json(self, 200, {
                "success": True,
                "source": source,
                "date": date_text,
                "updatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
                "count": len(records),
                "records": records,
            })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_POST(self):
        try:
            env = get_env()
            auth_user = require_attendance_auth(self, env)
            actor = actor_from_auth(auth_user, env)
            body = read_json_body(self)
            date_text, student_record_id, fields = sanitize_attendance_payload(body)

            if should_use_supabase(env):
                existing_row = fetch_supabase_attendance_row(env, date_text, student_record_id)
                existing_record = normalized_supabase_record(existing_row) if existing_row else None
                row = supabase_row_from_fields(date_text, student_record_id, fields, actor)
                saved_row = upsert_attendance_row(env, row)
                record = normalized_supabase_record(saved_row)
                action = "updated" if existing_row else "created"
                duplicate_count = 1 if existing_row else 0
                sync_warnings = []
                try:
                    insert_attendance_events(env, attendance_events_from_change(existing_record, record, actor))
                except Exception as exc:
                    sync_warnings.append(f"Supabase event log failed: {exc}")

                lark_sync = None
                if should_sync_lark(env):
                    try:
                        lark_sync = save_lark_attendance(env, date_text, student_record_id, fields)
                    except Exception as exc:
                        sync_warnings.append(f"Lark sync failed: {exc}")

                send_json(self, 200, {
                    "success": True,
                    "source": "supabase",
                    "action": action,
                    "duplicateCount": duplicate_count,
                    "record": record,
                    "larkSync": lark_sync,
                    "syncWarnings": sync_warnings,
                })
            else:
                if not env.get("LARK_ATTENDANCE_TABLE_ID"):
                    send_json(self, 500, {"success": False, "error": "Missing LARK_ATTENDANCE_TABLE_ID"})
                    return
                result = save_lark_attendance(env, date_text, student_record_id, fields)
                send_json(self, 200, {
                    "success": True,
                    "source": "lark",
                    "action": result["action"],
                    "duplicateCount": result["duplicateCount"],
                    "record": result["record"],
                })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
