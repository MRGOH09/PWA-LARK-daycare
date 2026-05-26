from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, clean, verify_session_token  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, send_json  # noqa: E402
from _parent import assert_parent_child, is_positive_attendance, parent_copy_for_attendance  # noqa: E402
from _supabase import fetch_score_events, fetch_student_attendance_events  # noqa: E402


STEP_ORDER = {
    "pickup": 1,
    "arrival": 2,
    "tuition": 3,
    "shower": 4,
    "meal": 5,
    "homework": 6,
    "extra": 7,
    "home": 8,
    "note": 9,
}

TZ = timezone(timedelta(hours=8))
STATUS_LABELS_ZH = {
    "pickup": "接生",
    "arrival": "到补习中心",
    "tuition": "去补习",
    "shower": "冲凉",
    "meal": "吃饭",
    "homework": "功课",
    "extra": "extra 复习",
    "home": "回家",
}
STATUS_LABELS_EN = {
    "pickup": "Pickup",
    "arrival": "Arrival",
    "tuition": "Tuition",
    "shower": "Shower",
    "meal": "Meal",
    "homework": "Homework",
    "extra": "Extra revision",
    "home": "Home",
}

POSITIVE_SUMMARY_ZH = {
    ("pickup", "已接"): "已接",
    ("arrival", "到了"): "到补习中心",
    ("tuition", "去了"): "去补习",
    ("tuition", "迟进补习"): "进补习",
    ("shower", "冲了"): "冲好凉",
    ("meal", "吃饭了"): "吃饭",
    ("homework", "完成了"): "完成功课",
    ("extra", "extra复习了"): "extra 复习",
    ("home", "回家"): "回家",
    ("home", "去学校"): "去学校",
}

POSITIVE_SUMMARY_EN = {
    ("pickup", "已接"): "picked up",
    ("arrival", "到了"): "arrived",
    ("tuition", "去了"): "gone for tuition",
    ("tuition", "迟进补习"): "entered tuition",
    ("shower", "冲了"): "showered",
    ("meal", "吃饭了"): "had a meal",
    ("homework", "完成了"): "completed homework",
    ("extra", "extra复习了"): "extra revision",
    ("home", "回家"): "gone home",
    ("home", "去学校"): "gone to school",
}


def params(path):
    return parse_qs(urlparse(path).query)


def today_text():
    return datetime.now(TZ).date().isoformat()


def feed_item_from_attendance(row, child):
    step = clean(row.get("step_key"))
    value = clean(row.get("new_value"))
    language = child.get("language") or "zh"
    child_name = child.get("studentName") or row.get("student_record_id") or "宝贝"
    message = parent_copy_for_attendance(step, value, child_name, language)
    if step == "note":
        note = clean(value)
        message = f"Teacher note: {note}" if language == "en" else f"老师备注：{note}"
    if not message:
        label = value or step
        message = f"{child_name}: {label}"
    teacher = clean(row.get("actor_name")) or clean(row.get("actor_email")) or "老师"
    return {
        "id": clean(row.get("id")),
        "type": "attendance",
        "createdAt": clean(row.get("created_at")),
        "date": clean(row.get("date")),
        "teacher": teacher,
        "stepKey": step,
        "value": value,
        "attendanceRecordId": clean(row.get("attendance_record_id")),
        "message": message,
        "summary": attendance_summary(step, value, message, language),
        "autoScorePoints": 0.5 if is_positive_attendance(step, value) else 0,
        "pushEligible": bool(parent_copy_for_attendance(step, value, child_name, language) or step == "note"),
    }


def attendance_summary(step, value, message, language):
    if step == "note":
        return message
    table = POSITIVE_SUMMARY_EN if language == "en" else POSITIVE_SUMMARY_ZH
    return table.get((step, value)) or clean(value) or clean(message)


def group_attendance_items(items, child, language="zh"):
    child_name = child.get("studentName") or "宝贝"
    grouped = {}
    order = []
    for item in items:
        minute = (item.get("createdAt") or "")[:16]
        key = (
            item.get("attendanceRecordId") or item.get("id"),
            item.get("teacher") or "",
            minute,
        )
        if key not in grouped:
            grouped[key] = dict(item)
            grouped[key]["byStep"] = {}
            grouped[key]["autoScoreTotal"] = 0
            order.append(key)
        step = item.get("stepKey") or item.get("id")
        existing = grouped[key]["byStep"].get(step)
        if not existing or (item.get("createdAt") or "") >= (existing.get("createdAt") or ""):
            grouped[key]["byStep"][step] = item
        if not existing:
            grouped[key]["autoScoreTotal"] += float(item.get("autoScorePoints") or 0)

    out = []
    for key in order:
        item = grouped[key]
        by_step = item.pop("byStep", {})
        step_items = sorted(
            by_step.values(),
            key=lambda entry: (STEP_ORDER.get(entry.get("stepKey"), 99), entry.get("createdAt") or ""),
        )
        summaries = []
        seen = set()
        for entry in step_items:
            summary = clean(entry.get("summary")) or clean(entry.get("message"))
            if not summary or summary in seen:
                continue
            summaries.append(summary)
            seen.add(summary)
        if not summaries:
            continue

        if language == "en":
            if len(summaries) == 1:
                message = f"{child_name}: {summaries[0]}"
            else:
                message = f"{child_name}: " + ", ".join(summaries)
        else:
            if len(summaries) == 1:
                message = f"{child_name} 已经{summaries[0]}"
            else:
                message = f"{child_name}：" + "、".join(summaries)
        score_total = item.pop("autoScoreTotal", 0)
        if score_total > 0:
            score_text = f"+{score_total:g} Noble Star"
            message = f"{message} · {score_text}"
        item["message"] = message
        item["groupCount"] = len(summaries)
        out.append(item)
    return out


def today_status_payload(attendance_rows, language="zh"):
    today = today_text()
    labels = STATUS_LABELS_EN if language == "en" else STATUS_LABELS_ZH
    latest = {}
    for row in attendance_rows:
        step = clean(row.get("step_key"))
        if step not in STEP_ORDER or step == "note":
            continue
        if clean(row.get("date")) != today:
            continue
        current = latest.get(step)
        if not current or clean(row.get("created_at")) >= clean(current.get("created_at")):
            latest[step] = row

    out = []
    for step in sorted(labels, key=lambda key: STEP_ORDER.get(key, 99)):
        row = latest.get(step) or {}
        value = clean(row.get("new_value"))
        done = bool(value and value != "未点")
        positive = is_positive_attendance(step, value)
        out.append({
            "key": step,
            "label": labels[step],
            "value": value or ("Not marked" if language == "en" else "未点"),
            "done": done,
            "positive": positive,
            "teacher": clean(row.get("actor_name")) or clean(row.get("actor_email")),
            "createdAt": clean(row.get("created_at")),
        })
    return out


def feed_item_from_score(row):
    points = row.get("points") or 0
    try:
        points_num = float(points)
    except Exception:
        points_num = 0
    sign = "+" if points_num > 0 else ""
    teacher = clean(row.get("actor_name")) or clean(row.get("actor_email")) or "老师"
    reason = clean(row.get("reason_label")) or clean(row.get("note")) or "Noble Star"
    return {
        "id": clean(row.get("id")),
        "type": "score",
        "createdAt": clean(row.get("created_at")),
        "date": clean(row.get("date")),
        "teacher": teacher,
        "points": points_num,
        "reason": reason,
        "message": f"{sign}{points_num:g} Noble Star · {reason}",
        "pushEligible": bool(row.get("push_to_parent")),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            user = verify_session_token(bearer_token(self), env)
            if user.get("role") != "parent":
                raise AuthError("请使用家长账号登录")
            q = params(self.path)
            student_record_id = clean((q.get("studentRecordId") or [""])[0])
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            child, _children = assert_parent_child(env, user.get("email"), student_record_id)
            attendance_rows = fetch_student_attendance_events(env, student_record_id, limit=200)
            score_rows = fetch_score_events(env, student_record_id=student_record_id, limit=300)
            items = group_attendance_items(
                [feed_item_from_attendance(row, child) for row in attendance_rows],
                child,
                child.get("language") or "zh",
            )
            items.extend(
                feed_item_from_score(row)
                for row in score_rows
                if row.get("visible_to_parent") is not False and clean(row.get("source")) != "attendance_auto"
            )
            items.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
            send_json(self, 200, {
                "success": True,
                "child": child,
                "count": len(items),
                "today": today_text(),
                "todayStatus": today_status_payload(attendance_rows, child.get("language") or "zh"),
                "items": items[:250],
            })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        if proxy_backend_if_needed(self):
            return
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
