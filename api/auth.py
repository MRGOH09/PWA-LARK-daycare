from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import (  # noqa: E402
    assert_email_allowed,
    auth_config_payload,
    bearer_token,
    sign_session,
    verify_google_credential,
    verify_session_token,
)
from _lark import get_env, read_json_body, send_json  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            payload = auth_config_payload()
            token = bearer_token(self)
            user = None
            if token:
                user = verify_session_token(token, env)
            send_json(self, 200, {
                "success": True,
                **payload,
                "authenticated": bool(user),
                "user": user,
            })
        except Exception as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})

    def do_POST(self):
        try:
            env = get_env()
            body = read_json_body(self)
            credential = str(body.get("credential") or "").strip()
            if not credential:
                raise RuntimeError("Missing Google credential")
            user = verify_google_credential(credential)
            profile = assert_email_allowed(env, user["email"])
            if profile.get("name"):
                user["name"] = profile["name"]
            user["whitelistName"] = profile.get("name") or ""
            token = sign_session(user, env)
            send_json(self, 200, {
                "success": True,
                "authenticated": True,
                "token": token,
                "user": user,
            })
        except Exception as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
