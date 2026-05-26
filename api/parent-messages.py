from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, clean, verify_session_token  # noqa: E402
from _lark import get_env, read_json_body, send_json  # noqa: E402
from _parent import assert_parent_child, build_related_mention_teachers, sanitize_parent_mentions  # noqa: E402
from _supabase import fetch_parent_messages, insert_parent_message  # noqa: E402


MAX_MESSAGE_LENGTH = 1200


def params(path):
    return parse_qs(urlparse(path).query)


def normalize_message(row):
    mentions = row.get("mentions") if isinstance(row.get("mentions"), list) else []
    return {
        "id": clean(row.get("id")),
        "studentRecordId": clean(row.get("student_record_id")),
        "studentNo": clean(row.get("student_no")),
        "studentName": clean(row.get("student_name")),
        "senderRole": clean(row.get("sender_role")),
        "senderEmail": clean(row.get("sender_email")),
        "senderName": clean(row.get("sender_name")),
        "body": clean(row.get("body")),
        "mentions": mentions,
        "createdAt": clean(row.get("created_at")),
    }


def parent_user(handler, env):
    user = verify_session_token(bearer_token(handler), env)
    if user.get("role") != "parent":
        raise AuthError("请使用家长账号登录")
    return user


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            user = parent_user(self, env)
            q = params(self.path)
            student_record_id = clean((q.get("studentRecordId") or [""])[0])
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            child, _children = assert_parent_child(env, user.get("email"), student_record_id)
            rows = fetch_parent_messages(env, student_record_id)
            send_json(self, 200, {
                "success": True,
                "child": child,
                "count": len(rows),
                "messages": [normalize_message(row) for row in rows],
            })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_POST(self):
        try:
            env = get_env()
            user = parent_user(self, env)
            body = read_json_body(self)
            student_record_id = clean(body.get("studentRecordId"))
            message = clean(body.get("body"))
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            if not message:
                raise RuntimeError("留言内容不能为空")
            if len(message) > MAX_MESSAGE_LENGTH:
                raise RuntimeError(f"留言不能超过 {MAX_MESSAGE_LENGTH} 个字")
            child, _children = assert_parent_child(env, user.get("email"), student_record_id)
            related_teachers = build_related_mention_teachers(env, child)
            mentions = sanitize_parent_mentions(body.get("mentions"), related_teachers)
            row = insert_parent_message(env, {
                "student_record_id": student_record_id,
                "student_no": child.get("studentNo") or "",
                "student_name": child.get("studentName") or "",
                "sender_role": "parent",
                "sender_email": clean(user.get("email")).lower(),
                "sender_name": clean(user.get("name")) or clean(user.get("email")).lower(),
                "body": message,
                "mentions": mentions,
            })
            send_json(self, 200, {"success": True, "message": normalize_message(row)})
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
