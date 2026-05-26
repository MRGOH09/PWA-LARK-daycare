from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, clean, verify_session_token  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, send_json  # noqa: E402
from _parent import assert_parent_child, build_related_mention_teachers  # noqa: E402


def params(path):
    return parse_qs(urlparse(path).query)


def parent_user(handler, env):
    user = verify_session_token(bearer_token(handler), env)
    if user.get("role") != "parent":
        raise AuthError("请使用家长账号登录")
    return user


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            user = parent_user(self, env)
            q = params(self.path)
            student_record_id = clean((q.get("studentRecordId") or [""])[0])
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            child, _children = assert_parent_child(env, user.get("email"), student_record_id)
            teachers = build_related_mention_teachers(env, child)
            send_json(self, 200, {
                "success": True,
                "studentRecordId": student_record_id,
                "count": len(teachers),
                "teachers": teachers,
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
