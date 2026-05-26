from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import AuthError, clean, require_attendance_auth  # noqa: E402
from _lark import proxy_backend_if_needed, get_env, read_json_body, send_json  # noqa: E402
from _parent import fetch_all_parent_children  # noqa: E402
from _supabase import (  # noqa: E402
    fetch_parent_messages,
    fetch_teacher_message_reads,
    insert_parent_message,
    upsert_teacher_message_read,
)
from attendance import actor_from_auth  # noqa: E402


MAX_MESSAGE_LENGTH = 1200


def params(path):
    return parse_qs(urlparse(path).query)


def children_by_record_id(env):
    try:
        return {
            clean(child.get("recordId")): child
            for child in fetch_all_parent_children(env)
            if clean(child.get("recordId"))
        }
    except Exception:
        return {}


def parent_sender_label(row, child):
    if clean(row.get("sender_role")) != "parent":
        return clean(row.get("sender_name")) or "老师"
    child = child or {}
    student_name = clean(child.get("studentName")) or clean(row.get("student_name")) or "宝贝"
    sender_email = clean(row.get("sender_email")).lower()
    father_emails = {clean(email).lower() for email in child.get("fatherEmails") or []}
    mother_emails = {clean(email).lower() for email in child.get("motherEmails") or []}
    if sender_email and sender_email in father_emails:
        return f"{student_name}爸爸"
    if sender_email and sender_email in mother_emails:
        return f"{student_name}妈妈"
    return clean(row.get("sender_name")) or "家长"


def normalize_message(row, child=None):
    mentions = row.get("mentions") if isinstance(row.get("mentions"), list) else []
    return {
        "id": clean(row.get("id")),
        "studentRecordId": clean(row.get("student_record_id")),
        "studentNo": clean(row.get("student_no")),
        "studentName": clean(row.get("student_name")),
        "senderRole": clean(row.get("sender_role")),
        "senderEmail": clean(row.get("sender_email")),
        "senderName": clean(row.get("sender_name")),
        "senderLabel": parent_sender_label(row, child),
        "body": clean(row.get("body")),
        "mentions": mentions,
        "createdAt": clean(row.get("created_at")),
    }


def normalize_read_state(row):
    return {
        "studentRecordId": clean(row.get("student_record_id")),
        "lastSeenAt": clean(row.get("last_seen_at")),
        "updatedAt": clean(row.get("updated_at")),
    }


def read_states_by_student(rows):
    out = {}
    for row in rows or []:
        item = normalize_read_state(row)
        student_record_id = clean(item.get("studentRecordId"))
        if student_record_id:
            out[student_record_id] = {
                "lastSeenAt": clean(item.get("lastSeenAt")),
                "updatedAt": clean(item.get("updatedAt")),
            }
    return out


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            auth_user = require_attendance_auth(self, env)
            actor = actor_from_auth(auth_user, env)
            teacher_email = clean(actor.get("email")).lower()
            q = params(self.path)
            student_record_id = clean((q.get("studentRecordId") or [""])[0])
            if student_record_id:
                rows = fetch_parent_messages(env, student_record_id)
            else:
                rows = fetch_parent_messages(env, limit=500, ascending=False)
            children = children_by_record_id(env)
            read_rows = fetch_teacher_message_reads(env, teacher_email)
            send_json(self, 200, {
                "success": True,
                "count": len(rows),
                "messages": [
                    normalize_message(row, children.get(clean(row.get("student_record_id"))))
                    for row in rows
                ],
                "readStates": read_states_by_student(read_rows),
            })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_POST(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            auth_user = require_attendance_auth(self, env)
            actor = actor_from_auth(auth_user, env)
            body = read_json_body(self)
            student_record_id = clean(body.get("studentRecordId"))
            message = clean(body.get("body"))
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            if not message:
                raise RuntimeError("回复内容不能为空")
            if len(message) > MAX_MESSAGE_LENGTH:
                raise RuntimeError(f"回复不能超过 {MAX_MESSAGE_LENGTH} 个字")
            row = insert_parent_message(env, {
                "student_record_id": student_record_id,
                "student_no": clean(body.get("studentNo")),
                "student_name": clean(body.get("studentName")),
                "sender_role": "teacher",
                "sender_email": clean(actor.get("email")).lower(),
                "sender_name": clean(actor.get("name")) or "老师",
                "body": message,
            })
            child = children_by_record_id(env).get(student_record_id)
            send_json(self, 200, {"success": True, "message": normalize_message(row, child)})
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_PATCH(self):
        if proxy_backend_if_needed(self):
            return
        try:
            env = get_env()
            auth_user = require_attendance_auth(self, env)
            actor = actor_from_auth(auth_user, env)
            teacher_email = clean(actor.get("email")).lower()
            body = read_json_body(self)
            student_record_id = clean(body.get("studentRecordId"))
            last_seen_at = clean(body.get("lastSeenAt"))
            if not teacher_email:
                raise RuntimeError("Missing teacher email")
            if not student_record_id:
                raise RuntimeError("Missing studentRecordId")
            if not last_seen_at:
                raise RuntimeError("Missing lastSeenAt")
            row = upsert_teacher_message_read(env, teacher_email, student_record_id, last_seen_at)
            send_json(self, 200, {
                "success": True,
                "readState": normalize_read_state(row),
            })
        except AuthError as exc:
            send_json(self, 401, {"success": False, "error": str(exc)})
        except Exception as exc:
            send_json(self, 500, {"success": False, "error": str(exc)})

    def do_OPTIONS(self):
        if proxy_backend_if_needed(self):
            return
        send_json(self, 200, {"success": True})

    def log_message(self, format, *args):
        return
