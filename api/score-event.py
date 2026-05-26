from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta, timezone
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, clean, require_attendance_auth  # noqa: E402
from _lark import get_env, read_json_body, send_json  # noqa: E402
from _supabase import insert_score_event  # noqa: E402
from attendance import actor_from_auth  # noqa: E402


TZ = timezone(timedelta(hours=8))


def today_text():
    return datetime.now(TZ).date().isoformat()


def sanitize_points(value):
    try:
        points = float(value)
    except Exception:
        raise RuntimeError("分数必须是数字")
    if points == 0:
        raise RuntimeError("分数不能是 0")
    if points < -100 or points > 100:
        raise RuntimeError("单次分数必须在 -100 到 100 之间")
    return points


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            env = get_env()
            auth_user = require_attendance_auth(self, env)
            actor = actor_from_auth(auth_user, env)
            body = read_json_body(self)
            student_record_id = clean(body.get("studentRecordId"))
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            points = sanitize_points(body.get("points"))
            reason = clean(body.get("reasonLabel") or body.get("reason"))
            if not reason:
                raise RuntimeError("请填写加减分原因")
            row = {
                "student_record_id": student_record_id,
                "student_no": clean(body.get("studentNo")),
                "student_name": clean(body.get("studentName")),
                "date": clean(body.get("date")) or today_text(),
                "points": points,
                "reason_key": clean(body.get("reasonKey")) or "custom",
                "reason_label": reason,
                "note": clean(body.get("note")),
                "source": "teacher_manual",
                "actor_email": clean(actor.get("email")).lower(),
                "actor_name": clean(actor.get("name")),
                "visible_to_parent": True,
                "push_to_parent": points > 0,
            }
            saved = insert_score_event(env, row)
            send_json(self, 200, {"success": True, "record": saved})
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
