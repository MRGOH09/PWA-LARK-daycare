import json
import os
import re
import sys
import requests

LARK_TOKEN_URL = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
LARK_RECORDS_URL = "https://open.larksuite.com/open-apis/bitable/v1/apps/{app}/tables/{table}/records"
DEFAULT_STUDENT_TABLE_ID = "tblKaj1Jpd7JJ1LA"

REQUIRED_ENV = ("LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN", "LARK_TABLE_ID")

FIELD_DAY = "礼拜几"
FIELD_BLOCK = "BLOCK"
FIELD_COUNT = "时段人数"
FIELD_TIME = "时间段"
FIELD_DAYCARE = "DAYCARE老师"
FIELD_TEACHING = "教书老师"
FIELD_ASSISTANT = "助理"
FIELD_ASSISTANT_TEACHER = "助教"

STAFF_FIELD_DAYCARE = "daycare老师"
STAFF_FIELD_TEACHING = "教书帮忙老师"
STAFF_FIELD_ASSISTANT = "助理老师"
STAFF_FIELD_ASSISTANT_TEACHER = "助教老师"

ROLE_FIELDS = {
    "daycare": FIELD_DAYCARE,
    "teaching": FIELD_TEACHING,
    "assistant": FIELD_ASSISTANT,
    "assistantTeacher": FIELD_ASSISTANT_TEACHER,
}
ROLE_KEYS = tuple(ROLE_FIELDS.keys())

STAFF_ROLE_FIELDS = {
    "daycare": STAFF_FIELD_DAYCARE,
    "teaching": STAFF_FIELD_TEACHING,
    "assistant": STAFF_FIELD_ASSISTANT,
    "assistantTeacher": STAFF_FIELD_ASSISTANT_TEACHER,
}

WRITABLE_FIELDS = {
    FIELD_DAY, FIELD_BLOCK, FIELD_COUNT, FIELD_TIME,
    FIELD_DAYCARE, FIELD_TEACHING, FIELD_ASSISTANT, FIELD_ASSISTANT_TEACHER,
}


def get_env():
    env = {}
    for k in REQUIRED_ENV:
        v = os.environ.get(k)
        if not v:
            raise RuntimeError(f"Missing {k}")
        env[k] = v.strip()
    staff_table_id = os.environ.get("LARK_STAFF_TABLE_ID")
    if staff_table_id:
        env["LARK_STAFF_TABLE_ID"] = staff_table_id.strip()
    student_table_id = os.environ.get("LARK_STUDENT_TABLE_ID")
    env["LARK_STUDENT_TABLE_ID"] = student_table_id.strip() if student_table_id else DEFAULT_STUDENT_TABLE_ID
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


def records_url(env, record_id=None, table_id=None):
    base = LARK_RECORDS_URL.format(app=env["LARK_BASE_TOKEN"], table=table_id or env["LARK_TABLE_ID"])
    return f"{base}/{record_id}" if record_id else base


def raise_lark_http_error(resp, action):
    if resp.status_code < 400:
        return
    detail = ""
    try:
        data = resp.json()
        msg = data.get("msg") or data.get("message") or data.get("error")
        code = data.get("code")
        if msg:
            detail = f"：{msg}"
        if code is not None:
            detail += f" (code {code})"
    except Exception:
        if resp.text:
            detail = f"：{resp.text[:200]}"

    if resp.status_code == 403:
        raise RuntimeError(
            f"Lark 拒绝{action}记录：当前 Lark App 对这个 Base/Table 没有写入或删除权限。"
            f"请在 Lark 开放平台给 App 开启多维表格记录写入权限，并确认该 App 已被授权访问这个 Base{detail}"
        )
    raise RuntimeError(f"Lark {action}记录失败：HTTP {resp.status_code}{detail}")


def fetch_all_records(token, env, table_id=None):
    headers = {"Authorization": f"Bearer {token}"}
    out = []
    page_token = None
    while True:
        params = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(records_url(env, table_id=table_id), headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            msg = data.get("msg", "unknown")
            if msg == "RolePermNotAllow":
                raise RuntimeError("Lark 拒绝读取这张表：请确认 App 已被授权访问该 Base/Table，并有读取记录权限")
            raise RuntimeError(f"Lark records error: {msg}")
        block = data.get("data", {}) or {}
        out.extend(block.get("items") or [])
        if not block.get("has_more"):
            break
        page_token = block.get("page_token")
        if not page_token:
            break
    return out


def fetch_staff_records(token, env):
    table_id = env.get("LARK_STAFF_TABLE_ID")
    if not table_id:
        return []
    return fetch_all_records(token, env, table_id=table_id)


def fetch_student_records(token, env):
    table_id = env.get("LARK_STUDENT_TABLE_ID")
    if not table_id:
        return []
    return fetch_all_records(token, env, table_id=table_id)


def lark_create_record(token, env, fields, table_id=None):
    resp = requests.post(
        records_url(env, table_id=table_id),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"fields": fields},
        timeout=15,
    )
    raise_lark_http_error(resp, "新增")
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark create error: {data.get('msg', 'unknown')} (code {data.get('code')})")
    return data.get("data", {}).get("record", {})


def lark_update_record(token, env, record_id, fields):
    resp = requests.put(
        records_url(env, record_id),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"fields": fields},
        timeout=15,
    )
    raise_lark_http_error(resp, "更新")
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark update error: {data.get('msg', 'unknown')} (code {data.get('code')})")
    return data.get("data", {}).get("record", {})


def lark_delete_record(token, env, record_id):
    resp = requests.delete(
        records_url(env, record_id),
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    raise_lark_http_error(resp, "删除")
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Lark delete error: {data.get('msg', 'unknown')} (code {data.get('code')})")
    return data.get("data", {})


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


def _clock_suffix(piece):
    if not piece:
        return None
    t = piece.strip().upper().replace(" ", "")
    if t.endswith("AM"):
        return "AM"
    if t.endswith("PM"):
        return "PM"
    return None


def _parse_clock(piece, default_suffix=None):
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
    elif default_suffix:
        suffix = default_suffix
    if not t:
        return None
    t = t.replace(".", ":")
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


def _infer_left_suffix(left, right):
    left_suffix = _clock_suffix(left)
    right_suffix = _clock_suffix(right)
    if left_suffix or not right_suffix:
        return None
    left_text = left.strip().upper().replace(" ", "").replace(".", ":")
    right_text = right.strip().upper().replace(" ", "").replace(".", ":")
    try:
        left_hour = int(left_text.split(":", 1)[0])
        right_hour = int(re.sub(r"(AM|PM)$", "", right_text).split(":", 1)[0])
    except ValueError:
        return right_suffix
    if right_suffix == "AM":
        return "AM"
    if left_hour == 12:
        return "PM"
    if right_hour == 12 and left_hour < 12:
        return "AM"
    return "PM"


def parse_time_range(s):
    if not s:
        return (None, None)
    text = s.strip()
    text = re.sub(r"^\s*\d+\.\s+", "", text)
    for sep in ("—", "–", "～", "~", "至", "to", "TO"):
        text = text.replace(sep, "-")
    if "-" not in text:
        return (None, None)
    left, right = text.split("-", 1)
    left_minutes = _parse_clock(left, _infer_left_suffix(left, right))
    right_minutes = _parse_clock(right)
    return (left_minutes, right_minutes)


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


def normalize_staff_roles(items):
    roles = {key: [] for key in ROLE_KEYS}
    seen = {key: set() for key in ROLE_KEYS}
    for item in items:
        fields = item.get("fields", {}) or {}
        for role_key, field_name in STAFF_ROLE_FIELDS.items():
            for name in extract_list(fields.get(field_name)):
                if name and name not in seen[role_key]:
                    roles[role_key].append(name)
                    seen[role_key].add(name)
    for role_key in roles:
        roles[role_key].sort()
    return roles


def normalize_generic_record(item):
    fields = item.get("fields", {}) or {}
    return {
        "recordId": item.get("record_id", ""),
        "fields": {key: extract_text(value) for key, value in fields.items()},
    }


def sanitize_fields(raw):
    """Filter incoming fields dict to known writable keys and coerce types."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if k not in WRITABLE_FIELDS:
            continue
        if k == FIELD_COUNT:
            try:
                out[k] = int(v) if v is not None and v != "" else 0
            except (TypeError, ValueError):
                out[k] = 0
        elif k in (FIELD_DAYCARE, FIELD_TEACHING, FIELD_ASSISTANT, FIELD_ASSISTANT_TEACHER):
            if isinstance(v, list):
                cleaned = [str(x).strip() for x in v if str(x).strip()]
                out[k] = cleaned
            elif v is None:
                out[k] = []
            else:
                s = str(v).strip()
                out[k] = [s] if s else []
        else:
            out[k] = "" if v is None else str(v).strip()
    return out


def validate_teacher_role_bindings(token, env, fields, current_record_id=None):
    role_by_teacher = {}
    conflicts = set()

    def add_binding(name, role_key):
        if not name:
            return
        prev = role_by_teacher.get(name)
        if prev and prev != role_key:
            conflicts.add(name)
        else:
            role_by_teacher[name] = role_key

    for item in fetch_staff_records(token, env):
        raw = item.get("fields", {}) or {}
        for role_key, field_name in STAFF_ROLE_FIELDS.items():
            for name in extract_list(raw.get(field_name)):
                add_binding(name, role_key)

    for item in fetch_all_records(token, env):
        if current_record_id and item.get("record_id") == current_record_id:
            continue
        raw = item.get("fields", {}) or {}
        for role_key, field_name in ROLE_FIELDS.items():
            for name in extract_list(raw.get(field_name)):
                add_binding(name, role_key)

    submitted = {}
    for role_key, field_name in ROLE_FIELDS.items():
        for name in extract_list(fields.get(field_name)):
            prev = submitted.get(name)
            if prev and prev != role_key:
                raise RuntimeError(f"老师 {name} 在同一笔记录里被放进多个角色")
            submitted[name] = role_key

            known_role = role_by_teacher.get(name)
            if known_role and known_role != role_key:
                raise RuntimeError(
                    f"老师 {name} 已绑定为 {ROLE_FIELDS[known_role]}，不能写入 {field_name}"
                )
            if name in conflicts:
                raise RuntimeError(f"老师 {name} 在现有 Lark 数据里已有多个角色，请先清理")


def send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def ensure_path():
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
