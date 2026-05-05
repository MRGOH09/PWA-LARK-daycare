from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    fetch_student_records, get_env, get_tenant_access_token,
    normalize_generic_record, send_json,
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            raw = fetch_student_records(token, env)
            records = [normalize_generic_record(item) for item in raw]
            columns = []
            seen = set()
            for rec in records:
                for key in rec["fields"].keys():
                    if key not in seen:
                        columns.append(key)
                        seen.add(key)
            tz = timezone(timedelta(hours=8))
            send_json(self, 200, {
                "success": True,
                "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
                "tableId": env.get("LARK_STUDENT_TABLE_ID", ""),
                "count": len(records),
                "columns": columns,
                "records": records,
            })
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
