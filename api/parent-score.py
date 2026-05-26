from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, clean, verify_session_token  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, send_json  # noqa: E402
from _noble_star import score_points, score_sum, tier_payload  # noqa: E402
from _parent import assert_parent_child  # noqa: E402
from _supabase import fetch_score_events  # noqa: E402


TZ = timezone(timedelta(hours=8))


def params(path):
    return parse_qs(urlparse(path).query)


def period_start(period):
    today = datetime.now(TZ).date()
    if period == "week":
        return (today - timedelta(days=today.weekday())).isoformat()
    if period == "month":
        return today.replace(day=1).isoformat()
    return None


def normalize_score_event(row):
    return {
        "id": clean(row.get("id")),
        "studentRecordId": clean(row.get("student_record_id")),
        "studentNo": clean(row.get("student_no")),
        "studentName": clean(row.get("student_name")),
        "date": clean(row.get("date")),
        "points": round(score_points(row), 2),
        "reasonKey": clean(row.get("reason_key")),
        "reasonLabel": clean(row.get("reason_label")),
        "note": clean(row.get("note")),
        "source": clean(row.get("source")),
        "actorEmail": clean(row.get("actor_email")),
        "actorName": clean(row.get("actor_name")),
        "createdAt": clean(row.get("created_at")),
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
            own_rows = fetch_score_events(env, student_record_id=student_record_id, limit=5000)
            week_start = period_start("week")
            month_start = period_start("month")
            week_rows = [row for row in own_rows if clean(row.get("date")) >= week_start]
            month_rows = [row for row in own_rows if clean(row.get("date")) >= month_start]
            total = score_sum(own_rows)
            week_points = score_sum(week_rows)
            month_points = score_sum(month_rows)
            send_json(self, 200, {
                "success": True,
                "child": child,
                "total": total,
                "weekPoints": week_points,
                "monthPoints": month_points,
                "tier": tier_payload(month_points),
                "events": [normalize_score_event(row) for row in own_rows[:80]],
                "rankings": {},
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
