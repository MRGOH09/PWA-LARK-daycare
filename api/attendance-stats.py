from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlparse
import calendar
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, fetch_whitelist_profiles, require_attendance_auth  # noqa: E402
from _lark import get_env, send_json  # noqa: E402
from _supabase import (  # noqa: E402
    fetch_attendance_events,
    fetch_table_rows,
    supabase_config,
    supabase_enabled,
)


TZ = timezone(timedelta(hours=8))
STEP_LABELS = {
    "pickup": "接生",
    "arrival": "到校",
    "tuition": "补习",
    "shower": "冲凉",
    "meal": "用餐",
    "homework": "功课",
    "extra": "复习",
    "home": "回家/去学校",
    "note": "备注",
}


def clean_text(value):
    return str(value or "").strip()


def query_params(path):
    return parse_qs(urlparse(path).query)


def current_month():
    return datetime.now(TZ).strftime("%Y-%m")


def current_date():
    return datetime.now(TZ).date().isoformat()


def parse_month(value):
    text = clean_text(value) or current_month()
    if not re.match(r"^\d{4}-\d{2}$", text):
        raise RuntimeError("月份格式必须是 YYYY-MM")
    year, month = [int(part) for part in text.split("-")]
    if month < 1 or month > 12:
        raise RuntimeError("月份格式必须是 YYYY-MM")
    return year, month, text


def month_range(month_text):
    year, month, label = parse_month(month_text)
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    days = calendar.monthrange(year, month)[1]
    return start, end, label, days


def parse_date(value):
    text = clean_text(value) or current_date()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        raise RuntimeError("日期格式必须是 YYYY-MM-DD")
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise RuntimeError("日期格式必须是 YYYY-MM-DD")
    return text


def day_range(date_text):
    start_dt = datetime.strptime(parse_date(date_text), "%Y-%m-%d")
    end_dt = start_dt + timedelta(days=1)
    return start_dt.date().isoformat(), end_dt.date().isoformat(), start_dt.date().isoformat()


def stats_range(params):
    range_type = clean_text((params.get("range") or [""])[0]).lower()
    if range_type == "day" or (params.get("date") and range_type != "month"):
        start_date, end_date, date_label = day_range((params.get("date") or [""])[0])
        return {
            "range": "day",
            "date": date_label,
            "startDate": start_date,
            "endDate": end_date,
            "days": 1,
        }
    start_date, end_date, month, days = month_range((params.get("month") or [""])[0])
    return {
        "range": "month",
        "month": month,
        "startDate": start_date,
        "endDate": end_date,
        "days": days,
    }


def actor_key(event, whitelist_profiles=None):
    whitelist_profiles = whitelist_profiles or {}
    email = clean_text(event.get("actor_email")).lower()
    name = clean_text(event.get("actor_name"))
    if email:
        formal_name = clean_text((whitelist_profiles.get(email) or {}).get("name"))
        if formal_name:
            return email, formal_name
        return email, name or email
    if name:
        return name, name
    return "unknown", "未记录"


def empty_person(key, name):
    return {
        "key": key,
        "name": name,
        "email": key if "@" in key else "",
        "totalActions": 0,
        "attendanceActions": 0,
        "uniqueStudents": 0,
        "homeworkActions": 0,
        "homeworkCompleted": 0,
        "homeworkNotCompleted": 0,
        "byStep": {step: 0 for step in STEP_LABELS},
        "details": [],
        "_students": set(),
    }


def dedupe_latest_events(events):
    out = []
    seen = set()
    ordered = sorted(events or [], key=lambda item: clean_text(item.get("created_at")), reverse=True)
    for event in ordered:
        date_text = clean_text(event.get("date"))
        student_id = clean_text(event.get("student_record_id"))
        step = clean_text(event.get("step_key"))
        if date_text and student_id and step:
            key = (date_text, student_id, step)
        else:
            key = ("event", clean_text(event.get("id")) or str(len(out)))
        if key in seen:
            continue
        seen.add(key)
        out.append(event)
    return out


def fetch_attendance_record_summaries(env, start_date, end_date):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    rows = fetch_table_rows(
        config,
        config["attendance_table"],
        [
            ("select", "date,student_record_id,student_no,student_name,year_form,block,campus,period,teacher"),
            ("date", f"gte.{start_date}"),
            ("date", f"lt.{end_date}"),
            ("order", "date.desc,student_no.asc,student_name.asc"),
        ],
        "fetch attendance record summaries",
    )
    out = {}
    for row in rows:
        student_id = clean_text(row.get("student_record_id"))
        if not student_id:
            continue
        date_text = clean_text(row.get("date"))
        summary = {
            "studentRecordId": student_id,
            "studentNo": clean_text(row.get("student_no")),
            "studentName": clean_text(row.get("student_name")),
            "year": clean_text(row.get("year_form")),
            "block": clean_text(row.get("block")),
            "campus": clean_text(row.get("campus")),
            "period": clean_text(row.get("period")),
            "teacher": clean_text(row.get("teacher")),
        }
        if date_text:
            out[f"{date_text}|{student_id}"] = summary
        out.setdefault(student_id, summary)
    return out


def event_detail(event, student_lookup):
    student_id = clean_text(event.get("student_record_id"))
    date_text = clean_text(event.get("date"))
    student = student_lookup.get(f"{date_text}|{student_id}") or student_lookup.get(student_id) or {"studentRecordId": student_id}
    step = clean_text(event.get("step_key"))
    return {
        "id": clean_text(event.get("id")),
        "date": date_text,
        "createdAt": clean_text(event.get("created_at")),
        "studentRecordId": student_id,
        "studentNo": clean_text(student.get("studentNo")),
        "studentName": clean_text(student.get("studentName")) or student_id or "未记录学生",
        "year": clean_text(student.get("year")),
        "block": clean_text(student.get("block")),
        "campus": clean_text(student.get("campus")),
        "period": clean_text(student.get("period")),
        "teacher": clean_text(student.get("teacher")),
        "stepKey": step,
        "stepLabel": STEP_LABELS.get(step, step or "未记录项目"),
        "oldValue": clean_text(event.get("old_value")),
        "newValue": clean_text(event.get("new_value")),
    }


def build_stats(events, whitelist_profiles=None, student_lookup=None):
    student_lookup = student_lookup or {}
    people = {}
    totals = {
        "totalActions": 0,
        "attendanceActions": 0,
        "homeworkActions": 0,
        "homeworkCompleted": 0,
        "homeworkNotCompleted": 0,
        "uniqueStudents": 0,
        "byStep": {step: 0 for step in STEP_LABELS},
    }
    all_students = set()

    for event in dedupe_latest_events(events):
        step = clean_text(event.get("step_key"))
        new_value = clean_text(event.get("new_value"))
        student_id = clean_text(event.get("student_record_id"))
        key, name = actor_key(event, whitelist_profiles)
        person = people.setdefault(key, empty_person(key, name))
        if name and person["name"] == key:
            person["name"] = name

        person["totalActions"] += 1
        totals["totalActions"] += 1
        if step != "note":
            person["attendanceActions"] += 1
            totals["attendanceActions"] += 1
        if step in person["byStep"]:
            person["byStep"][step] += 1
            totals["byStep"][step] += 1
        if student_id:
            person["_students"].add(student_id)
            all_students.add(student_id)
        if step == "homework":
            person["homeworkActions"] += 1
            totals["homeworkActions"] += 1
            if new_value == "完成了":
                person["homeworkCompleted"] += 1
                totals["homeworkCompleted"] += 1
            elif new_value == "没完成":
                person["homeworkNotCompleted"] += 1
                totals["homeworkNotCompleted"] += 1
        person["details"].append(event_detail(event, student_lookup))

    out = []
    for person in people.values():
        person["uniqueStudents"] = len(person["_students"])
        del person["_students"]
        person["details"].sort(key=lambda item: item.get("createdAt") or "", reverse=True)
        out.append(person)
    out.sort(key=lambda item: (-item["attendanceActions"], -item["homeworkCompleted"], item["name"]))
    totals["uniqueStudents"] = len(all_students)
    return totals, out


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            require_attendance_auth(self, env)
            if not supabase_enabled(env):
                send_json(self, 500, {"success": False, "error": "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"})
                return
            params = query_params(self.path)
            range_info = stats_range(params)
            events = fetch_attendance_events(env, range_info["startDate"], range_info["endDate"])
            student_lookup = fetch_attendance_record_summaries(env, range_info["startDate"], range_info["endDate"])
            whitelist_profiles = fetch_whitelist_profiles(env)
            totals, people = build_stats(events, whitelist_profiles, student_lookup)
            payload = {
                "success": True,
                **range_info,
                "updatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
                "stepLabels": STEP_LABELS,
                "totals": totals,
                "people": people,
            }
            if "month" not in payload:
                payload["month"] = current_month()
            if "date" not in payload:
                payload["date"] = current_date()
            send_json(self, 200, payload)
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
