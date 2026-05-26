from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, verify_session_token  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, send_json  # noqa: E402
from _parent import fetch_parent_children  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            user = verify_session_token(bearer_token(self), env)
            if user.get("role") != "parent":
                raise AuthError("请使用家长账号登录")
            children = fetch_parent_children(env, user.get("email"))
            send_json(self, 200, {
                "success": True,
                "user": user,
                "count": len(children),
                "children": children,
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
