from __future__ import annotations

from typing import Any


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def validate_schema(value: Any, schema: dict[str, Any]) -> str | None:
    if isinstance(schema.get("oneOf"), list):
        branches = [b for b in schema["oneOf"] if isinstance(b, dict) and validate_schema(value, b) is None]
        if not branches:
            return "the value matches none of the allowed shapes"
    if "const" in schema and value != schema["const"]:
        return f"the value must be {schema['const']!r}"
    if isinstance(schema.get("enum"), list) and value not in schema["enum"]:
        return f"the value must be one of {schema['enum']!r}"
    stype = schema.get("type")
    if isinstance(stype, str) and not _matches_type(value, stype):
        return f"the value must be a {stype}"
    props = schema.get("properties")
    if isinstance(props, dict) and isinstance(value, dict):
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                return f'"{key}" is missing'
        for key, sub in props.items():
            if key not in value or not isinstance(sub, dict):
                continue
            err = validate_schema(value[key], sub)
            if err:
                return f'"{key}": {err}'
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    return f'"{key}" is not allowed'
    items = schema.get("items")
    if isinstance(items, dict) and isinstance(value, list):
        for item in value:
            err = validate_schema(item, items)
            if err:
                return err
    return None


def _matches_type(value: Any, typ: str) -> bool:
    if typ == "string":
        return isinstance(value, str)
    if typ == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if typ == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if typ == "boolean":
        return isinstance(value, bool)
    if typ == "array":
        return isinstance(value, list)
    if typ == "object":
        return isinstance(value, dict)
    if typ == "null":
        return value is None
    return True
