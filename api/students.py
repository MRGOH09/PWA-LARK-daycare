from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lark import (
    fetch_student_records, get_env, get_tenant_access_token,
    normalize_generic_record, send_json,
)
from _auth import AuthError, require_attendance_auth

CACHE_TTL_SECONDS = 60
STUDENTS_CACHE = {
    "expires_at": 0,
    "table_id": "",
    "payload": None,
}


def build_students_payload(env, token):
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
    return {
        "success": True,
        "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
        "tableId": env.get("LARK_STUDENT_TABLE_ID", ""),
        "count": len(records),
        "columns": columns,
        "records": records,
    }


def wants_refresh(path):
    return "refresh=1" in (path or "")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            require_attendance_auth(self, env)
            table_id = env.get("LARK_STUDENT_TABLE_ID", "")
            now = time.time()
            if (
                not wants_refresh(self.path)
                and STUDENTS_CACHE["payload"]
                and STUDENTS_CACHE["table_id"] == table_id
                and STUDENTS_CACHE["expires_at"] > now
            ):
                payload = dict(STUDENTS_CACHE["payload"])
                payload["cached"] = True
                send_json(self, 200, payload)
                return

            token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
            payload = build_students_payload(env, token)
            STUDENTS_CACHE["payload"] = payload
            STUDENTS_CACHE["table_id"] = table_id
            STUDENTS_CACHE["expires_at"] = now + CACHE_TTL_SECONDS
            send_json(self, 200, payload)
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
