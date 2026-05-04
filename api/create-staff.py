from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    STAFF_ROLE_FIELDS, extract_list, fetch_staff_records, get_env,
    get_tenant_access_token, lark_create_record, send_json, read_json_body,
)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = read_json_body(self)
            role = (body.get("role") or "").strip()
            name = (body.get("name") or "").strip()
            if role not in STAFF_ROLE_FIELDS:
                send_json(self, 400, {"success": False, "error": "Invalid role"})
                return
            if not name:
                send_json(self, 400, {"success": False, "error": "Missing name"})
                return

            env = get_env()
            staff_table_id = env.get("LARK_STAFF_TABLE_ID")
            if not staff_table_id:
                send_json(self, 500, {"success": False, "error": "Missing LARK_STAFF_TABLE_ID"})
                return

            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            for item in fetch_staff_records(token, env):
                fields = item.get("fields", {}) or {}
                for role_key, field_name in STAFF_ROLE_FIELDS.items():
                    if name in extract_list(fields.get(field_name)):
                        send_json(self, 409, {
                            "success": False,
                            "error": f"{name} 已存在于 {STAFF_ROLE_FIELDS[role_key]}",
                        })
                        return

            result = lark_create_record(
                token,
                env,
                {STAFF_ROLE_FIELDS[role]: name},
                table_id=staff_table_id,
            )
            send_json(self, 200, {"success": True, "record": result})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
