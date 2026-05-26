from datetime import datetime, timedelta, timezone
import re
import time

from _auth import clean as clean_text
from _lark import extract_text, fetch_student_records, get_tenant_access_token


TZ = timezone(timedelta(hours=8))
CACHE_TTL_SECONDS = 180
CHILDREN_CACHE = {
    "expires_at": 0,
    "table_id": "",
    "items": [],
}

STUDENT_FIELD_NO = "NO"
STUDENT_FIELD_NAME = "学生名字"
STUDENT_FIELD_YEAR = "YEAR / FORM"
STUDENT_FIELD_TEACHER = "负责老师"
STUDENT_FIELD_TIME = "时间段"
STUDENT_FIELD_BLOCK = "BLOCK"
STUDENT_FIELD_CAMPUS = "分院"
FATHER_EMAIL_FIELDS = ("爸爸email", "爸爸Email", "爸爸邮箱", "Father Email", "father_email")
MOTHER_EMAIL_FIELDS = ("妈妈email", "妈妈Email", "妈妈邮箱", "Mother Email", "mother_email")
FATHER_PHONE_FIELDS = ("爸爸电话", "爸爸手機", "爸爸手机", "Father Phone", "father_phone")
MOTHER_PHONE_FIELDS = ("妈妈电话", "妈妈手機", "妈妈手机", "Mother Phone", "mother_phone")
LANGUAGE_FIELDS = ("家长通知语言", "通知语言", "语言", "Language", "language")

POSITIVE_ATTENDANCE = {
    ("pickup", "已接"): {
        "zh": "{child} 已经接到了",
        "en": "{child} has been picked up.",
        "score_reason": "已接",
    },
    ("arrival", "到了"): {
        "zh": "{child} 已经到补习中心了",
        "en": "{child} has arrived at the tuition centre.",
        "score_reason": "到补习中心",
    },
    ("tuition", "去了"): {
        "zh": "{child} 已经去补习了",
        "en": "{child} has gone for tuition.",
        "score_reason": "去补习",
    },
    ("tuition", "迟进补习"): {
        "zh": "{child} 已经进补习了",
        "en": "{child} has entered tuition.",
        "score_reason": "进补习",
    },
    ("shower", "冲了"): {
        "zh": "{child} 已经冲好凉了",
        "en": "{child} has finished showering.",
        "score_reason": "冲凉",
    },
    ("meal", "吃饭了"): {
        "zh": "{child} 已经吃饭了",
        "en": "{child} has had a meal.",
        "score_reason": "吃饭",
    },
    ("homework", "完成了"): {
        "zh": "{child} 完成功课了，今天很棒",
        "en": "{child} has completed homework today. Great job!",
        "score_reason": "完成功课",
    },
    ("extra", "extra复习了"): {
        "zh": "{child} 今天有做 extra 复习",
        "en": "{child} has completed extra revision today.",
        "score_reason": "extra复习",
    },
    ("home", "回家"): {
        "zh": "{child} 已经回家了",
        "en": "{child} has gone home.",
        "score_reason": "回家",
    },
    ("home", "去学校"): {
        "zh": "{child} 已经去学校了",
        "en": "{child} has gone to school.",
        "score_reason": "去学校",
    },
}


def split_emails(value):
    text = clean_text(value).lower()
    if not text:
        return []
    parts = re.split(r"[,;，；\s]+", text)
    return [part for part in parts if "@" in part]


def first_field(fields, names):
    for name in names:
        if name in fields:
            value = extract_text(fields.get(name))
            if clean_text(value):
                return clean_text(value)
    return ""


def email_values(fields, names):
    out = []
    for name in names:
        if name in fields:
            out.extend(split_emails(extract_text(fields.get(name))))
    return sorted(set(out))


def language_from_fields(fields):
    raw = first_field(fields, LANGUAGE_FIELDS).lower()
    if raw in {"english", "en", "英文"}:
        return "en"
    return "zh"


def normalize_parent_child(item):
    fields = item.get("fields", {}) or {}
    father_emails = email_values(fields, FATHER_EMAIL_FIELDS)
    mother_emails = email_values(fields, MOTHER_EMAIL_FIELDS)
    return {
        "recordId": clean_text(item.get("record_id") or item.get("recordId")),
        "studentNo": first_field(fields, (STUDENT_FIELD_NO,)),
        "studentName": first_field(fields, (STUDENT_FIELD_NAME, "姓名", "名字")),
        "year": first_field(fields, (STUDENT_FIELD_YEAR,)),
        "teacher": first_field(fields, (STUDENT_FIELD_TEACHER,)),
        "period": first_field(fields, (STUDENT_FIELD_TIME,)),
        "block": first_field(fields, (STUDENT_FIELD_BLOCK,)),
        "campus": first_field(fields, (STUDENT_FIELD_CAMPUS,)),
        "fatherEmails": father_emails,
        "motherEmails": mother_emails,
        "fatherPhone": first_field(fields, FATHER_PHONE_FIELDS),
        "motherPhone": first_field(fields, MOTHER_PHONE_FIELDS),
        "language": language_from_fields(fields),
    }


def fetch_all_parent_children(env):
    table_id = clean_text(env.get("LARK_STUDENT_TABLE_ID"))
    now = time.time()
    if (
        CHILDREN_CACHE["items"]
        and CHILDREN_CACHE["table_id"] == table_id
        and CHILDREN_CACHE["expires_at"] > now
    ):
        return list(CHILDREN_CACHE["items"])

    token = get_tenant_access_token(env["LARK_APP_ID"], env["LARK_APP_SECRET"])
    children = [normalize_parent_child(item) for item in fetch_student_records(token, env)]
    CHILDREN_CACHE["items"] = children
    CHILDREN_CACHE["table_id"] = table_id
    CHILDREN_CACHE["expires_at"] = now + CACHE_TTL_SECONDS
    return list(children)


def fetch_parent_children(env, email):
    email = clean_text(email).lower()
    if not email:
        return []
    children = []
    for child in fetch_all_parent_children(env):
        if email in set(child["fatherEmails"] + child["motherEmails"]):
            children.append(child)
    children.sort(key=lambda rec: (rec.get("studentName") or "", rec.get("studentNo") or ""))
    return children


def fetch_child_by_record_id(env, student_record_id):
    target = clean_text(student_record_id)
    if not target:
        return None
    for child in fetch_all_parent_children(env):
        if child.get("recordId") == target:
            return child
    return None


def assert_parent_child(env, email, student_record_id):
    children = fetch_parent_children(env, email)
    for child in children:
        if child.get("recordId") == student_record_id:
            return child, children
    raise RuntimeError("你没有权限查看这个孩子的资料")


def split_teacher_names(value):
    text = clean_text(value)
    if not text:
        return []
    parts = re.split(r"[,，、;/；\n]+", text)
    return [clean_text(part) for part in parts if clean_text(part)]


def build_related_mention_teachers(env, child, limit=24):
    from _auth import fetch_whitelist_profiles
    from _supabase import fetch_parent_messages, fetch_student_attendance_events

    by_key = {}
    whitelist = {}
    try:
        whitelist = fetch_whitelist_profiles(env)
    except Exception:
        whitelist = {}

    name_to_email = {}
    for email, profile in whitelist.items():
        name = clean_text(profile.get("name"))
        if name and name.lower() not in name_to_email:
            name_to_email[name.lower()] = clean_text(profile.get("email") or email).lower()

    def add_teacher(name="", email="", source=""):
        name = clean_text(name)
        email = clean_text(email).lower()
        if not name and email:
            name = clean_text((whitelist.get(email) or {}).get("name")) or email
        if not name:
            return
        if not email:
            email = name_to_email.get(name.lower(), "")
        key = email or name.lower()
        if key in by_key:
            existing = by_key[key]
            if not existing.get("email") and email:
                existing["email"] = email
            if source and source not in existing.get("sources", []):
                existing["sources"].append(source)
            return
        by_key[key] = {
            "name": name,
            "email": email,
            "source": source,
            "sources": [source] if source else [],
        }

    for name in split_teacher_names(child.get("teacher")):
        add_teacher(name=name, source="primary_teacher")

    try:
      events = fetch_student_attendance_events(env, child.get("recordId"), limit=150)
    except Exception:
      events = []
    for event in events:
        add_teacher(
            name=event.get("actor_name"),
            email=event.get("actor_email"),
            source="recent_attendance",
        )

    try:
        messages = fetch_parent_messages(env, child.get("recordId"), limit=200)
    except Exception:
        messages = []
    for message in messages:
        if clean_text(message.get("sender_role")) != "teacher":
            continue
        add_teacher(
            name=message.get("sender_name"),
            email=message.get("sender_email"),
            source="message_participant",
        )

    source_order = {
        "primary_teacher": 0,
        "recent_attendance": 1,
        "message_participant": 2,
    }
    rows = list(by_key.values())
    rows.sort(key=lambda item: (
        min([source_order.get(source, 9) for source in item.get("sources", [])] or [9]),
        item.get("name", "").lower(),
    ))
    for item in rows:
        sources = item.get("sources") or []
        item["source"] = sources[0] if sources else item.get("source", "")
    return rows[:limit]


def sanitize_parent_mentions(raw_mentions, related_teachers):
    if not isinstance(raw_mentions, list):
        return []
    allowed = {}
    for teacher in related_teachers:
        name = clean_text(teacher.get("name"))
        email = clean_text(teacher.get("email")).lower()
        if name:
            allowed[name.lower()] = teacher
        if email:
            allowed[email] = teacher
    out = []
    seen = set()
    for item in raw_mentions:
        if not isinstance(item, dict):
            continue
        key = clean_text(item.get("email")).lower() or clean_text(item.get("name")).lower()
        teacher = allowed.get(key)
        if not teacher:
            continue
        dedupe_key = clean_text(teacher.get("email")).lower() or clean_text(teacher.get("name")).lower()
        if not dedupe_key or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.append({
            "name": clean_text(teacher.get("name")),
            "email": clean_text(teacher.get("email")).lower(),
            "source": clean_text(teacher.get("source")),
        })
    return out


def parent_copy_for_attendance(step_key, value, child_name, language="zh"):
    spec = POSITIVE_ATTENDANCE.get((clean_text(step_key), clean_text(value)))
    if not spec:
        return None
    lang = "en" if language == "en" else "zh"
    return spec[lang].format(child=child_name or "宝贝")


def is_positive_attendance(step_key, value):
    return (clean_text(step_key), clean_text(value)) in POSITIVE_ATTENDANCE


def positive_score_reason(step_key, value):
    spec = POSITIVE_ATTENDANCE.get((clean_text(step_key), clean_text(value))) or {}
    return spec.get("score_reason") or clean_text(value)


def today_text():
    return datetime.now(TZ).date().isoformat()
