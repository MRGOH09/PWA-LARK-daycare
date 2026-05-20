import base64
import hashlib
import hmac
import json
import os
import time

import requests

from _lark import extract_list, extract_text, fetch_all_records, get_tenant_access_token


GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
SESSION_TTL_SECONDS = 12 * 60 * 60
EMAIL_FIELDS = ("邮箱", "Email", "email", "Google Email", "Google邮箱", "登录邮箱", "登入邮箱", "账号")
ACTIVE_FIELDS = ("启用", "允许登录", "可登录", "Active", "active", "状态")
INACTIVE_VALUES = {"0", "false", "no", "否", "停用", "禁用", "不允许", "inactive", "disabled", "停用中"}


class AuthError(RuntimeError):
    pass


def clean(value):
    return str(value or "").strip()


def truthy_env(name):
    return clean(os.environ.get(name)).lower() in {"1", "true", "yes", "on"}


def auth_required():
    if truthy_env("ATTENDANCE_AUTH_REQUIRED"):
        return True
    return bool(clean(os.environ.get("GOOGLE_CLIENT_ID")) and clean(os.environ.get("LARK_AUTH_WHITELIST_TABLE_ID")))


def auth_config_payload():
    client_id = clean(os.environ.get("GOOGLE_CLIENT_ID"))
    whitelist_table_id = clean(os.environ.get("LARK_AUTH_WHITELIST_TABLE_ID"))
    required = auth_required()
    configured = bool(client_id and whitelist_table_id)
    if required and not configured:
        missing = []
        if not client_id:
            missing.append("GOOGLE_CLIENT_ID")
        if not whitelist_table_id:
            missing.append("LARK_AUTH_WHITELIST_TABLE_ID")
        raise RuntimeError("Missing " + ", ".join(missing))
    return {
        "enabled": configured,
        "required": required,
        "clientId": client_id if configured else "",
    }


def _b64url_encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(text):
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + padding).encode("ascii"))


def session_secret(env):
    secret = clean(os.environ.get("AUTH_SESSION_SECRET")) or clean(env.get("LARK_APP_SECRET"))
    if not secret:
        raise RuntimeError("Missing AUTH_SESSION_SECRET")
    return secret.encode("utf-8")


def sign_session(payload, env):
    body = dict(payload)
    body["iat"] = int(time.time())
    body["exp"] = body["iat"] + SESSION_TTL_SECONDS
    encoded = _b64url_encode(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(session_secret(env), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64url_encode(sig)}"


def verify_session_token(token, env):
    token = clean(token)
    if not token or "." not in token:
        raise AuthError("请先使用 Google 登录")
    encoded, signature = token.rsplit(".", 1)
    expected = _b64url_encode(hmac.new(session_secret(env), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        raise AuthError("登录已失效，请重新登录")
    try:
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception:
        raise AuthError("登录资料无法读取，请重新登录")
    if int(payload.get("exp") or 0) < int(time.time()):
        raise AuthError("登录已过期，请重新登录")
    if not clean(payload.get("email")):
        raise AuthError("登录资料缺少邮箱")
    return payload


def bearer_token(handler):
    header = clean(handler.headers.get("Authorization"))
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def require_attendance_auth(handler, env):
    if not auth_required():
        return None
    return verify_session_token(bearer_token(handler), env)


def verify_google_credential(credential):
    client_id = clean(os.environ.get("GOOGLE_CLIENT_ID"))
    if not client_id:
        raise RuntimeError("Missing GOOGLE_CLIENT_ID")
    resp = requests.get(GOOGLE_TOKENINFO_URL, params={"id_token": credential}, timeout=10)
    if resp.status_code >= 400:
        raise RuntimeError("Google 登录验证失败，请重新登录")
    data = resp.json()
    if data.get("aud") != client_id:
        raise RuntimeError("Google 登录来源不正确")
    if data.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise RuntimeError("Google 登录签发方不正确")
    if clean(data.get("email_verified")).lower() not in {"true", "1"}:
        raise RuntimeError("Google 邮箱尚未验证")
    email = clean(data.get("email")).lower()
    if not email:
        raise RuntimeError("Google 登录资料缺少邮箱")
    return {
        "email": email,
        "name": clean(data.get("name")),
        "picture": clean(data.get("picture")),
        "sub": clean(data.get("sub")),
    }


def whitelist_table_id():
    table_id = clean(os.environ.get("LARK_AUTH_WHITELIST_TABLE_ID"))
    if not table_id:
        raise RuntimeError("Missing LARK_AUTH_WHITELIST_TABLE_ID")
    return table_id


def field_values(fields, names):
    values = []
    for name in names:
        if name in fields:
            raw = fields.get(name)
            listed = extract_list(raw)
            values.extend(listed if listed else [extract_text(raw)])
    return [clean(value) for value in values if clean(value)]


def record_is_active(fields):
    matched = False
    for name in ACTIVE_FIELDS:
        if name not in fields:
            continue
        matched = True
        value = clean(extract_text(fields.get(name))).lower()
        if value in INACTIVE_VALUES:
            return False
    return True if matched else True


def fetch_whitelist_emails(env):
    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    emails = set()
    for item in fetch_all_records(token, env, table_id=whitelist_table_id()):
        fields = item.get("fields", {}) or {}
        if not record_is_active(fields):
            continue
        for value in field_values(fields, EMAIL_FIELDS):
            emails.add(value.lower())
    return emails


def assert_email_allowed(env, email):
    email = clean(email).lower()
    if not email:
        raise RuntimeError("登录资料缺少邮箱")
    allowed = fetch_whitelist_emails(env)
    if email not in allowed:
        raise RuntimeError(f"{email} 不在点名登录白名单内")
    return True
