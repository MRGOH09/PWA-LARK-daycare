from http.server import BaseHTTPRequestHandler
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import (  # noqa: E402
    bearer_token,
    clean,
    sign_session,
    verify_google_credential,
    verify_session_token,
)
from _lark import get_env, read_json_body, send_json  # noqa: E402
from _parent import fetch_parent_children  # noqa: E402


def client_id_payload():
    client_id = clean(os.environ.get("GOOGLE_CLIENT_ID"))
    if not client_id:
        raise RuntimeError("Missing GOOGLE_CLIENT_ID")
    return {
        "enabled": True,
        "required": True,
        "clientId": client_id,
        "vapidPublicKey": clean(os.environ.get("VAPID_PUBLIC_KEY")),
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            env = get_env()
            payload = client_id_payload()
            token = bearer_token(self)
            user = None
            children = []
            if token:
                user = verify_session_token(token, env)
                if user.get("role") != "parent":
                    user = None
                else:
                    children = fetch_parent_children(env, user.get("email"))
            send_json(self, 200, {
                "success": True,
                **payload,
                "authenticated": bool(user),
                "user": user,
                "children": children,
            })
        except Exception as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})

    def do_POST(self):
        try:
            env = get_env()
            client_id_payload()
            body = read_json_body(self)
            credential = clean(body.get("credential"))
            if not credential:
                raise RuntimeError("Missing Google credential")
            user = verify_google_credential(credential)
            children = fetch_parent_children(env, user["email"])
            if not children:
                raise RuntimeError(f"{user['email']} 没有绑定任何孩子，请检查 Lark 学生名单的爸爸email / 妈妈email")
            user["role"] = "parent"
            user["childrenCount"] = len(children)
            token = sign_session(user, env)
            send_json(self, 200, {
                "success": True,
                "authenticated": True,
                "token": token,
                "user": user,
                "children": children,
            })
        except Exception as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
