import json
import os


def webpush_configured(env=None):
    env = env or {}
    return bool((env.get("VAPID_PRIVATE_KEY") or os.environ.get("VAPID_PRIVATE_KEY") or "").strip())


def send_web_push(env, subscription, title, body, url="/parent.html"):
    try:
        from pywebpush import WebPushException, webpush
    except ImportError as exc:
        raise RuntimeError("Missing pywebpush dependency") from exc

    private_key = (env.get("VAPID_PRIVATE_KEY") or os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
    if not private_key:
        raise RuntimeError("Missing VAPID_PRIVATE_KEY")

    endpoint = (subscription.get("endpoint") or "").strip()
    p256dh = (subscription.get("p256dh") or "").strip()
    auth = (subscription.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        raise RuntimeError("Push subscription missing endpoint or keys")

    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
    }, ensure_ascii=False)
    subject = (env.get("VAPID_SUBJECT") or os.environ.get("VAPID_SUBJECT") or "mailto:mrgoh09@gmail.com").strip()

    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {
                    "p256dh": p256dh,
                    "auth": auth,
                },
            },
            data=payload,
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},
        )
    except WebPushException as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        raise RuntimeError(f"Web Push failed{f' HTTP {status_code}' if status_code else ''}: {exc}") from exc
