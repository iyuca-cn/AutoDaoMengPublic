from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TextIO


def to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return {"type": "bytes", "length": len(value)}
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(child) for key, child in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    return str(value)


def format_records(records: list[dict], preferred_fields: list[str] | tuple[str, ...]) -> str:
    if not records:
        return "(空)"

    lines = []
    for index, record in enumerate(records, start=1):
        fields = []
        used = set()
        for field in preferred_fields:
            if field in record and record[field] not in (None, ""):
                fields.append(f"{field}={record[field]}")
                used.add(field)
        for key, value in record.items():
            if key in used or value in (None, ""):
                continue
            fields.append(f"{key}={value}")
            if len(fields) >= 6:
                break
        lines.append(f"{index}. " + " | ".join(fields))
    return "\n".join(lines)


def render_text(payload: dict[str, Any]) -> str:
    parts = []
    message = payload.get("message")
    if message:
        parts.append(str(message))

    if "records" in payload:
        parts.append(
            format_records(
                payload.get("records") or [],
                payload.get("preferred_fields") or (),
            )
        )
    elif "value" in payload:
        parts.append(str(payload.get("value")))

    if not parts and "data" in payload:
        data = payload.get("data")
        if isinstance(data, (dict, list)):
            parts.append(json.dumps(to_jsonable(data), ensure_ascii=False, indent=2))
        else:
            parts.append(str(data))

    return "\n".join(parts)


def print_result(
    payload: dict[str, Any],
    *,
    as_json: bool = False,
    stream: TextIO | None = None,
) -> None:
    if stream is None:
        import sys

        stream = sys.stdout

    if as_json:
        print(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2), file=stream)
        return

    print(render_text(payload), file=stream)
