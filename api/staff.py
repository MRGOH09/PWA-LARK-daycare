from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    get_env, get_tenant_access_token, fetch_staff_records,
    normalize_staff_roles, send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            raw = fetch_staff_records(token, env)
            roles = normalize_staff_roles(raw)
            tz = timezone(timedelta(hours=8))
            send_json(self, 200, {
                "success": True,
                "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
                "count": sum(len(v) for v in roles.values()),
                "roles": roles,
            })
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
