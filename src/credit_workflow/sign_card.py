from __future__ import annotations


def has_activity_sign_card(dmapi, activity_id: str) -> bool:
    if not hasattr(dmapi, "get_signid"):
        return True

    sign_id = dmapi.get_signid(activity_id)
    return bool(str(sign_id or "").strip())
