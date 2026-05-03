from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    get_env, get_tenant_access_token, lark_update_record,
    normalize_record, sanitize_fields, validate_teacher_role_bindings,
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
            fields = sanitize_fields(body.get("fields") or {})
            if not fields:
                send_json(self, 400, {"success": False, "error": "No writable fields supplied"})
                return

            env = get_env()
            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            validate_teacher_role_bindings(token, env, fields, record_id)
            result = lark_update_record(token, env, record_id, fields)
            send_json(self, 200, {
                "success": True,
                "record": normalize_record(result) if result else None,
            })
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
