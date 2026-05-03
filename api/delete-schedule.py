from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    get_env, get_tenant_access_token, lark_delete_record,
    send_json, read_json_body,
)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json_body(self)
            record_id = (body.get("recordId") or "").strip()
            if not record_id:
                send_json(self, 400, {"success": False, "error": "Missing recordId"})
                return

            env = get_env()
            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            lark_delete_record(token, env, record_id)
            send_json(self, 200, {"success": True, "recordId": record_id})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
