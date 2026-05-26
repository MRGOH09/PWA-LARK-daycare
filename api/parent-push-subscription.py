from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta, timezone
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, bearer_token, clean, verify_session_token  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, read_json_body, send_json  # noqa: E402
from _supabase import upsert_parent_push_subscription  # noqa: E402


TZ = timezone(timedelta(hours=8))


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            user = verify_session_token(bearer_token(self), env)
            if user.get("role") != "parent":
                raise AuthError("请使用家长账号登录")
            body = read_json_body(self)
            keys = body.get("keys") or {}
            endpoint = clean(body.get("endpoint"))
            p256dh = clean(keys.get("p256dh"))
            auth = clean(keys.get("auth"))
            if not endpoint or not p256dh or not auth:
                raise RuntimeError("Push subscription 缺少 endpoint / keys")
            row = {
                "parent_email": clean(user.get("email")).lower(),
                "endpoint": endpoint,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": clean(self.headers.get("User-Agent")),
                "enabled": True,
                "last_seen_at": datetime.now(TZ).isoformat(timespec="seconds"),
            }
            saved = upsert_parent_push_subscription(env, row)
            send_json(self, 200, {"success": True, "record": saved})
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
