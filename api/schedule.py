from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import json
import os
import re
import requests

LARK_TOKEN_URL = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
LARK_RECORDS_URL = "https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records"

REQUIRED_ENV = ("LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN", "LARK_TABLE_ID")

FIELD_DAY = "礼拜几"
FIELD_BLOCK = "BLOCK"
FIELD_COUNT = "时段人数"
FIELD_TIME = "时间段"
FIELD_DAYCARE = "DAYCARE老师"
FIELD_TEACHING = "教书老师"
FIELD_ASSISTANT = "助理"
FIELD_ASSISTANT_TEACHER = "助教"


def get_env():
    env = {}
    for k in REQUIRED_ENV:
        v = os.environ.get(k)
        if not v:
            raise RuntimeError(f"Missing {k}")
        env[k] = v.strip()
    return env


def get_tenant_access_token(app_id, app_secret):
    resp = requests.post(
        LARK_TOKEN_URL,
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark token error: {data.get('msg', 'unknown')}")
    return data["tenant_access_token"]


def fetch_all_records(token, base_token, table_id):
    url = LARK_RECORDS_URL.format(base_token=base_token, table_id=table_id)
    headers = {"Authorization": f"Bearer {token}"}
    out = []
    page_token = None
    while True:
        params = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"Lark records error: {data.get('msg', 'unknown')}")
        block = data.get("data", {}) or {}
        items = block.get("items") or []
        out.extend(items)
        if not block.get("has_more"):
            break
        page_token = block.get("page_token")
        if not page_token:
            break
    return out


def extract_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        for k in ("text", "value", "name", "en_name"):
            if k in value and value[k] is not None:
                return str(value[k]).strip()
        return ""
    if isinstance(value, list):
        parts = [extract_text(it) for it in value]
        return ", ".join([p for p in parts if p])
    return str(value).strip()


def extract_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        out = []
        for it in value:
            t = extract_text(it)
            if t:
                out.append(t)
        return out
    if isinstance(value, str):
        s = value.strip()
        return [s] if s else []
    if isinstance(value, dict):
        t = extract_text(value)
        return [t] if t else []
    return []


def parse_student_count(value):
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, list):
        return parse_student_count(value[0]) if value else 0
    if isinstance(value, dict):
        for k in ("text", "value"):
            if k in value:
                return parse_student_count(value[k])
        return 0
    if isinstance(value, str):
        m = re.search(r"-?\d+", value)
        return int(m.group()) if m else 0
    return 0


def parse_day_order(day_str):
    if not day_str:
        return 99
    m = re.match(r"\s*(\d+)", day_str)
    return int(m.group(1)) if m else 99


def _parse_clock(piece):
    if not piece:
        return None
    t = piece.strip().upper().replace(" ", "")
    suffix = None
    if t.endswith("AM"):
        suffix = "AM"
        t = t[:-2]
    elif t.endswith("PM"):
        suffix = "PM"
        t = t[:-2]
    if not t:
        return None
    if ":" in t:
        try:
            hh, mm = t.split(":", 1)
            h = int(hh)
            m = int(mm)
        except ValueError:
            return None
    else:
        try:
            h = int(t)
            m = 0
        except ValueError:
            return None
    if suffix == "PM" and h < 12:
        h += 12
    elif suffix == "AM" and h == 12:
        h = 0
    if h < 0 or h > 24 or m < 0 or m > 59:
        return None
    return h * 60 + m


def parse_time_range(s):
    if not s:
        return (None, None)
    text = s.strip()
    text = re.sub(r"^\s*\d+\.\s*", "", text)
    for sep in ("—", "–", "～", "~", "至", "to", "TO"):
        text = text.replace(sep, "-")
    if "-" not in text:
        return (None, None)
    left, right = text.split("-", 1)
    start = _parse_clock(left)
    end = _parse_clock(right)
    if start is None or end is None:
        return (None, None)
    return (start, end)


def normalize_record(item):
    fields = item.get("fields", {}) or {}
    day = extract_text(fields.get(FIELD_DAY))
    block = extract_text(fields.get(FIELD_BLOCK))
    student_count = parse_student_count(fields.get(FIELD_COUNT))
    time_range = extract_text(fields.get(FIELD_TIME))
    start_min, end_min = parse_time_range(time_range)
    return {
        "recordId": item.get("record_id", ""),
        "day": day,
        "dayOrder": parse_day_order(day),
        "block": block,
        "studentCount": student_count,
        "timeRange": time_range,
        "startMinutes": start_min,
        "endMinutes": end_min,
        "daycareTeachers": extract_list(fields.get(FIELD_DAYCARE)),
        "teachingTeachers": extract_list(fields.get(FIELD_TEACHING)),
        "assistants": extract_list(fields.get(FIELD_ASSISTANT)),
        "assistantTeachers": extract_list(fields.get(FIELD_ASSISTANT_TEACHER)),
    }


def build_payload():
    env = get_env()
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    raw = fetch_all_records(token, env["LARK_BASE_TOKEN"], env["LARK_TABLE_ID"])
    records = [normalize_record(it) for it in raw]
    tz = timezone(timedelta(hours=8))
    return {
        "success": True,
        "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
        "count": len(records),
        "records": records,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            payload = build_payload()
            self._send_json(200, payload)
        except Exception as exc:
            self._send_json(500, {"success": False, "error": str(exc)})

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return
