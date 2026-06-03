from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, urlparse
import calendar
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, fetch_whitelist_profiles, require_attendance_auth  # noqa: E402
from _lark import (  # noqa: E402
    fetch_student_records,
    get_env,
    get_tenant_access_token,
    normalize_generic_record,
    send_json,
)
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
STEP_KEYS = [key for key in STEP_LABELS if key != "note"]
MISSING_VALUE = "未点"
ABSENT_VALUES = {"缺席", "未接"}
HOMEWORK_DONE_VALUE = "完成了"
HOMEWORK_NOT_DONE_VALUE = "没完成"
STUDENT_FIELD_NO = "NO"
STUDENT_FIELD_NAME = "学生名字"
STUDENT_FIELD_YEAR = "YEAR / FORM"
STUDENT_FIELD_TEACHER = "负责老师"
STUDENT_FIELD_PERIOD = "时间段"
STUDENT_FIELD_BLOCK = "BLOCK"
STUDENT_FIELD_CAMPUS = "分院"


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


def fetch_student_master_summaries(env):
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    out = {}
    for item in fetch_student_records(token, env):
        record = normalize_generic_record(item)
        fields = record.get("fields", {}) or {}
        record_id = clean_text(record.get("recordId"))
        student_no = clean_text(fields.get(STUDENT_FIELD_NO))
        summary = {
            "studentRecordId": record_id,
            "studentNo": student_no,
            "studentName": clean_text(fields.get(STUDENT_FIELD_NAME)),
            "year": clean_text(fields.get(STUDENT_FIELD_YEAR)),
            "block": clean_text(fields.get(STUDENT_FIELD_BLOCK)),
            "campus": clean_text(fields.get(STUDENT_FIELD_CAMPUS)),
            "period": clean_text(fields.get(STUDENT_FIELD_PERIOD)),
            "teacher": clean_text(fields.get(STUDENT_FIELD_TEACHER)),
        }
        if record_id:
            out[record_id] = summary
        if student_no:
            out[f"NO:{student_no}"] = summary
    return out


def unique_student_summaries(student_lookup):
    out = {}
    for student in (student_lookup or {}).values():
        record_id = clean_text(student.get("studentRecordId"))
        student_no = clean_text(student.get("studentNo"))
        key = record_id or (f"NO:{student_no}" if student_no else "")
        if key:
            out[key] = student
    return list(out.values())


def fetch_attendance_records_for_stats(env, start_date, end_date):
    config = supabase_config(env)
    if not config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return fetch_table_rows(
        config,
        config["attendance_table"],
        [
            ("select", "*"),
            ("date", f"gte.{start_date}"),
            ("date", f"lt.{end_date}"),
            ("order", "date.desc,campus.asc,block.asc,period.asc,student_no.asc,student_name.asc"),
        ],
        "fetch attendance records for stats",
    )


def step_value(record, step):
    return clean_text(record.get(step)) or MISSING_VALUE


def student_status(record, missing_steps, absent_steps):
    if absent_steps:
        return "absent"
    if len(missing_steps) == len(STEP_KEYS):
        return "not-started"
    if missing_steps:
        return "partial"
    return "complete"


def student_status_label(status):
    return {
        "complete": "已完成",
        "partial": "部分未点",
        "not-started": "未开始",
        "absent": "缺席/未接",
    }.get(status, status)


def build_attendance_overview(records, expected_students=None, date_text=""):
    rows = []
    seen = set()
    for row in records or []:
        rows.append(row)
        student_id = clean_text(row.get("student_record_id"))
        student_no = clean_text(row.get("student_no"))
        if student_id:
            seen.add(student_id)
        if student_no:
            seen.add(f"NO:{student_no}")

    for student in expected_students or []:
        student_id = clean_text(student.get("studentRecordId"))
        student_no = clean_text(student.get("studentNo"))
        if (student_id and student_id in seen) or (student_no and f"NO:{student_no}" in seen):
            continue
        rows.append({
            "date": date_text,
            "student_record_id": student_id,
            "student_no": student_no,
            "student_name": clean_text(student.get("studentName")) or "未记录学生",
            "year_form": clean_text(student.get("year")),
            "block": clean_text(student.get("block")),
            "campus": clean_text(student.get("campus")),
            "period": clean_text(student.get("period")),
            "teacher": clean_text(student.get("teacher")),
        })

    totals = {
        "totalRecords": len(rows),
        "complete": 0,
        "partial": 0,
        "notStarted": 0,
        "absent": 0,
        "missingItems": 0,
        "homeworkCompleted": 0,
        "homeworkNotCompleted": 0,
        "completionRate": 0,
    }
    by_step = {
        step: {"label": STEP_LABELS[step], "checked": 0, "missing": 0, "values": {}}
        for step in STEP_KEYS
    }
    filters = {
        "dates": set(),
        "campuses": set(),
        "years": set(),
        "blocks": set(),
        "periods": set(),
        "teachers": set(),
        "statuses": [
            {"key": "complete", "label": student_status_label("complete")},
            {"key": "partial", "label": student_status_label("partial")},
            {"key": "not-started", "label": student_status_label("not-started")},
            {"key": "absent", "label": student_status_label("absent")},
        ],
    }
    students = []
    checked_items = 0
    total_items = len(rows) * len(STEP_KEYS)

    for row in rows:
        date_text = clean_text(row.get("date"))
        missing_steps = []
        absent_steps = []
        checked_step_count = 0
        step_values = {}
        for step in STEP_KEYS:
            value = step_value(row, step)
            step_values[step] = value
            by_step[step]["values"][value] = by_step[step]["values"].get(value, 0) + 1
            if value == MISSING_VALUE:
                missing_steps.append({"key": step, "label": STEP_LABELS[step]})
                by_step[step]["missing"] += 1
            else:
                checked_step_count += 1
                checked_items += 1
                by_step[step]["checked"] += 1
            if value in ABSENT_VALUES:
                absent_steps.append({"key": step, "label": STEP_LABELS[step], "value": value})

        status = student_status(row, missing_steps, absent_steps)
        if status == "complete":
            totals["complete"] += 1
        elif status == "partial":
            totals["partial"] += 1
        elif status == "not-started":
            totals["notStarted"] += 1
        elif status == "absent":
            totals["absent"] += 1
        totals["missingItems"] += len(missing_steps)
        homework = step_values.get("homework", MISSING_VALUE)
        if homework == HOMEWORK_DONE_VALUE:
            totals["homeworkCompleted"] += 1
        elif homework == HOMEWORK_NOT_DONE_VALUE:
            totals["homeworkNotCompleted"] += 1

        student = {
            "date": date_text,
            "studentRecordId": clean_text(row.get("student_record_id")),
            "studentNo": clean_text(row.get("student_no")),
            "studentName": clean_text(row.get("student_name")) or "未记录学生",
            "year": clean_text(row.get("year_form")),
            "block": clean_text(row.get("block")),
            "campus": clean_text(row.get("campus")),
            "period": clean_text(row.get("period")),
            "teacher": clean_text(row.get("teacher")),
            "status": status,
            "statusLabel": student_status_label(status),
            "checkedSteps": checked_step_count,
            "totalSteps": len(STEP_KEYS),
            "completionRate": round((checked_step_count / len(STEP_KEYS)) * 100) if STEP_KEYS else 0,
            "missingSteps": missing_steps,
            "absentSteps": absent_steps,
            "steps": step_values,
            "note": clean_text(row.get("note")),
            "updatedAt": clean_text(row.get("updated_at")),
            "updatedByName": clean_text(row.get("updated_by_name")),
            "updatedByEmail": clean_text(row.get("updated_by_email")),
        }
        students.append(student)

        for key, value in [
            ("dates", date_text),
            ("campuses", student["campus"]),
            ("years", student["year"]),
            ("blocks", student["block"]),
            ("periods", student["period"]),
            ("teachers", student["teacher"]),
        ]:
            if value:
                filters[key].add(value)

    totals["completionRate"] = round((checked_items / total_items) * 100) if total_items else 0
    students.sort(key=lambda item: (
        item.get("date") or "",
        item.get("campus") or "",
        item.get("block") or "",
        item.get("period") or "",
        item.get("studentNo") or "",
        item.get("studentName") or "",
    ))
    serializable_filters = {
        key: sorted(value) if isinstance(value, set) else value
        for key, value in filters.items()
    }
    return {
        "totals": totals,
        "byStep": by_step,
        "students": students,
        "filters": serializable_filters,
        "source": "records",
    }


def build_event_attendance_overview(events, student_lookup):
    latest = {}
    ordered = sorted(events or [], key=lambda item: clean_text(item.get("created_at")), reverse=True)
    for event in ordered:
        date_text = clean_text(event.get("date"))
        student_id = clean_text(event.get("student_record_id"))
        step = clean_text(event.get("step_key"))
        if not date_text or not student_id or step not in STEP_KEYS:
            continue
        key = (date_text, student_id)
        row = latest.setdefault(key, {
            "date": date_text,
            "student_record_id": student_id,
        })
        if step not in row:
            row[step] = clean_text(event.get("new_value")) or MISSING_VALUE
            if not row.get("updated_at"):
                row["updated_at"] = clean_text(event.get("created_at"))
                row["updated_by_name"] = clean_text(event.get("actor_name"))
                row["updated_by_email"] = clean_text(event.get("actor_email"))

    rows = []
    for (date_text, student_id), row in latest.items():
        student = (
            student_lookup.get(f"{date_text}|{student_id}")
            or student_lookup.get(student_id)
            or student_lookup.get(f"NO:{student_id}")
            or {}
        )
        rows.append({
            **row,
            "student_no": clean_text(student.get("studentNo")),
            "student_name": clean_text(student.get("studentName")) or student_id or "未记录学生",
            "year_form": clean_text(student.get("year")),
            "block": clean_text(student.get("block")) or "未记录 BLOCK",
            "campus": clean_text(student.get("campus")),
            "period": clean_text(student.get("period")) or "未记录时间",
            "teacher": clean_text(student.get("teacher")),
        })

    overview = build_attendance_overview(rows)
    overview["source"] = "events"
    return overview


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
            attendance_records = fetch_attendance_records_for_stats(env, range_info["startDate"], range_info["endDate"])
            student_lookup = fetch_attendance_record_summaries(env, range_info["startDate"], range_info["endDate"])
            expected_students = []
            try:
                student_master = fetch_student_master_summaries(env)
                student_lookup.update(student_master)
                if range_info.get("range") == "day":
                    expected_students = unique_student_summaries(student_master)
            except Exception:
                pass
            whitelist_profiles = fetch_whitelist_profiles(env)
            totals, people = build_stats(events, whitelist_profiles, student_lookup)
            attendance = build_attendance_overview(
                attendance_records,
                expected_students=expected_students,
                date_text=range_info.get("date", ""),
            )
            if not attendance.get("students") and events:
                attendance = build_event_attendance_overview(events, student_lookup)
            payload = {
                "success": True,
                **range_info,
                "updatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
                "stepLabels": STEP_LABELS,
                "totals": totals,
                "people": people,
                "attendance": attendance,
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
