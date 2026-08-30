#!/usr/bin/env python3
"""Validate SQL emitted by real operational RSVP concurrency harness runs."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


class ContractError(ValueError):
    pass


@dataclass(frozen=True)
class CapturedCall:
    mode: str
    sql: str
    captured_hkt_date: date


@dataclass(frozen=True)
class RunContract:
    token: str
    activity_ids: frozenset[str]
    session_ids: frozenset[str]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def load_calls(capture_dir: Path) -> list[CapturedCall]:
    if not capture_dir.is_dir():
        raise ContractError(f"capture directory is missing: {capture_dir}")
    calls = []
    for path in sorted(capture_dir.glob("call.*")):
        content = path.read_text()
        first_line, separator, sql = content.partition("\n")
        if not separator or not first_line.startswith("MODE:"):
            raise ContractError(f"invalid capture envelope: {path}")
        captured_hkt_date = datetime.fromtimestamp(
            path.stat().st_mtime, ZoneInfo("Asia/Hong_Kong")
        ).date()
        calls.append(
            CapturedCall(first_line.removeprefix("MODE:"), sql, captured_hkt_date)
        )
    if not calls:
        raise ContractError(f"capture directory is empty: {capture_dir}")
    return calls


def extract_parenthesized(text: str, start: int) -> tuple[str, int]:
    if start >= len(text) or text[start] != "(":
        raise ContractError("expected parenthesized SQL expression")
    depth = 0
    quoted = False
    index = start
    while index < len(text):
        char = text[index]
        if quoted:
            if char == "'" and index + 1 < len(text) and text[index + 1] == "'":
                index += 2
                continue
            if char == "'":
                quoted = False
        elif char == "'":
            quoted = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:index], index + 1
        index += 1
    raise ContractError("unterminated parenthesized SQL expression")


def split_top_level(text: str) -> list[str]:
    values = []
    start = 0
    depth = 0
    quoted = False
    index = 0
    while index < len(text):
        char = text[index]
        if quoted:
            if char == "'" and index + 1 < len(text) and text[index + 1] == "'":
                index += 2
                continue
            if char == "'":
                quoted = False
        elif char == "'":
            quoted = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            values.append(text[start:index].strip())
            start = index + 1
        index += 1
    values.append(text[start:].strip())
    return values


def parse_insert(sql: str, table: str) -> list[dict[str, str]]:
    match = re.search(rf"\binsert\s+into\s+public\.{re.escape(table)}\s*", sql, re.IGNORECASE)
    if not match:
        raise ContractError(f"setup SQL is missing insert into public.{table}")
    index = match.end()
    while index < len(sql) and sql[index].isspace():
        index += 1
    columns_text, index = extract_parenthesized(sql, index)
    columns = [column.strip().lower() for column in split_top_level(columns_text)]
    values_match = re.match(r"\s*values\s*", sql[index:], re.IGNORECASE)
    if not values_match:
        raise ContractError(f"public.{table} insert is missing values")
    index += values_match.end()

    rows = []
    while True:
        while index < len(sql) and (sql[index].isspace() or sql[index] == ","):
            index += 1
        if index >= len(sql) or sql[index] == ";":
            break
        row_text, index = extract_parenthesized(sql, index)
        values = split_top_level(row_text)
        if len(values) != len(columns):
            raise ContractError(
                f"public.{table} row has {len(values)} values for {len(columns)} columns"
            )
        rows.append(dict(zip(columns, values)))
    if not rows:
        raise ContractError(f"public.{table} insert has no rows")
    return rows


def sql_literal(value: str, label: str) -> str:
    match = re.fullmatch(r"'((?:''|[^'])*)'", value.strip(), re.DOTALL)
    if not match:
        raise ContractError(f"{label} must be a SQL string literal, got {value!r}")
    return match.group(1).replace("''", "'")


def sql_date(value: str, label: str) -> date:
    match = re.fullmatch(r"date\s+'(\d{4}-\d{2}-\d{2})'", value.strip(), re.IGNORECASE)
    if not match:
        raise ContractError(f"{label} must be an exact SQL date literal, got {value!r}")
    try:
        return date.fromisoformat(match.group(1))
    except ValueError as error:
        raise ContractError(f"{label} is not a valid date: {match.group(1)}") from error


def sql_integer(value: str, label: str, *, nullable: bool = False) -> int | None:
    normalized = value.strip().lower()
    if nullable and normalized == "null":
        return None
    if not re.fullmatch(r"-?\d+", normalized):
        raise ContractError(f"{label} must be an integer literal, got {value!r}")
    return int(normalized)


def sql_boolean(value: str, label: str) -> bool:
    normalized = value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ContractError(f"{label} must be a boolean literal, got {value!r}")
    return normalized == "true"


def parse_in_literals(sql: str, table: str, column: str) -> list[str]:
    match = re.search(
        rf"delete\s+from\s+{re.escape(table)}\s+where\s+{re.escape(column)}\s+in\s*\((.*?)\)\s*;",
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise ContractError(f"cleanup SQL is missing {table}.{column} delete")
    return [sql_literal(value, f"{table}.{column}") for value in split_top_level(match.group(1))]


def find_single_call(calls: list[CapturedCall], marker: str, label: str) -> CapturedCall:
    matches = [call for call in calls if marker in strip_sql_comments(call.sql).lower()]
    if len(matches) != 1:
        raise ContractError(f"expected one {label} call, captured {len(matches)}")
    return matches[0]


def validate_dynamic_date_query(calls: list[CapturedCall]) -> tuple[int, date]:
    query = find_single_call(calls, "concat_ws('|', paid_date", "dynamic date query")
    executable = " ".join(strip_sql_comments(query.sql).split())
    match = re.search(
        r"select \(now\(\) at time zone 'Asia/Hong_Kong'\)::date \+ (\d+) as paid_date",
        executable,
        re.IGNORECASE,
    )
    if not match or int(match.group(1)) <= 0:
        raise ContractError("fixture date query must derive a future date from executable HKT now() SQL")
    if not re.search(
        r"concat_ws\('\|', paid_date, paid_date \+ 1, paid_date \+ 2\)",
        executable,
        re.IGNORECASE,
    ):
        raise ContractError("fixture date query must derive three consecutive dates")
    return int(match.group(1)), query.captured_hkt_date


def validate_run(capture_dir: Path) -> RunContract:
    calls = load_calls(capture_dir)
    date_offset, query_hkt_date = validate_dynamic_date_query(calls)

    setup = find_single_call(
        calls,
        "insert into public.operational_activity_templates",
        "fixture setup",
    )
    cleanup = find_single_call(
        calls,
        "delete from public.operational_activity_templates",
        "fixture cleanup",
    )
    setup_sql = strip_sql_comments(setup.sql)
    cleanup_sql = strip_sql_comments(cleanup.sql)
    templates = parse_insert(setup_sql, "operational_activity_templates")
    sessions = parse_insert(setup_sql, "operational_sessions")
    if len(templates) != 2:
        raise ContractError(f"setup must insert exactly two templates, got {len(templates)}")
    if len(sessions) != 3:
        raise ContractError(f"setup must insert exactly three sessions, got {len(sessions)}")

    template_by_kind: dict[str, dict[str, str]] = {}
    tokens = set()
    activity_ids = set()
    for row in templates:
        activity_id = sql_literal(row["activity_id"], "template activity_id")
        match = re.fullmatch(r"event-concurrency-(paid|rsvp)-([a-z0-9]+)", activity_id)
        if not match:
            raise ContractError(f"template activity ID is not tokenized and SQL-safe: {activity_id}")
        kind, token = match.groups()
        if kind in template_by_kind:
            raise ContractError(f"setup contains duplicate {kind} template")
        template_by_kind[kind] = row
        tokens.add(token)
        activity_ids.add(activity_id)
    if set(template_by_kind) != {"paid", "rsvp"}:
        raise ContractError("setup must contain one paid and one RSVP template")
    if len(tokens) != 1:
        raise ContractError("paid and RSVP templates must share one exact per-run token")
    if len(activity_ids) != 2:
        raise ContractError("paid and RSVP activity IDs must be distinct")
    token = tokens.pop()

    paid_template = template_by_kind["paid"]
    rsvp_template = template_by_kind["rsvp"]
    if (
        sql_integer(paid_template["capacity"], "paid template capacity", nullable=True) != 20
        or sql_integer(paid_template["price_hkd"], "paid template price") != 180
        or sql_boolean(paid_template["requires_rsvp"], "paid template requires_rsvp")
    ):
        raise ContractError("paid template must be capacity 20 / price 180 / requires_rsvp false")
    if (
        sql_integer(rsvp_template["capacity"], "RSVP template capacity", nullable=True) is not None
        or sql_integer(rsvp_template["price_hkd"], "RSVP template price") != 0
        or not sql_boolean(rsvp_template["requires_rsvp"], "RSVP template requires_rsvp")
    ):
        raise ContractError("RSVP template must be uncapped / price 0 / requires_rsvp true")

    session_ids = set()
    session_dates = []
    paid_activity = f"event-concurrency-paid-{token}"
    rsvp_activity = f"event-concurrency-rsvp-{token}"
    paid_sessions = 0
    rsvp_sessions = 0
    for row in sessions:
        session_id = sql_literal(row["id"], "session id")
        activity_id = sql_literal(row["activity_id"], "session activity_id")
        session_date = sql_date(row["session_date"], "session date")
        expected_id = f"{activity_id}-{session_date.isoformat()}"
        if session_id != expected_id:
            raise ContractError(
                f"session ID must equal activity_id-date: expected {expected_id}, got {session_id}"
            )
        if activity_id not in activity_ids:
            raise ContractError(f"session uses unknown activity ID: {activity_id}")
        capacity = sql_integer(row["capacity"], "session capacity", nullable=True)
        price = sql_integer(row["price_hkd"], "session price")
        if activity_id == paid_activity:
            paid_sessions += 1
            if capacity != 20 or price != 180:
                raise ContractError("paid session must be capacity 20 / price 180")
        elif activity_id == rsvp_activity:
            rsvp_sessions += 1
            if capacity is not None or price != 0:
                raise ContractError("RSVP session must be uncapped / price 0")
        session_ids.add(session_id)
        session_dates.append(session_date)
    if paid_sessions != 1 or rsvp_sessions != 2:
        raise ContractError("setup must contain one paid session and two RSVP sessions")
    if len(session_ids) != 3:
        raise ContractError("all setup session IDs must be distinct")

    ordered_dates = sorted(session_dates)
    expected_first_date = query_hkt_date + timedelta(days=date_offset)
    if ordered_dates[0] != expected_first_date:
        raise ContractError(
            "fixture setup must use the future dates returned by its captured HKT query"
        )
    if [value.toordinal() for value in ordered_dates] != list(
        range(ordered_dates[0].toordinal(), ordered_dates[0].toordinal() + 3)
    ):
        raise ContractError("fixture session dates must be three consecutive dates")

    cleanup_sessions = parse_in_literals(
        cleanup_sql, "public.operational_bookings", "session_id"
    )
    cleanup_session_rows = parse_in_literals(
        cleanup_sql, "public.operational_sessions", "id"
    )
    cleanup_activities = parse_in_literals(
        cleanup_sql, "public.operational_activity_templates", "activity_id"
    )
    if set(cleanup_sessions) != session_ids or len(cleanup_sessions) != 3:
        raise ContractError("booking cleanup must use every exact setup session ID once")
    if set(cleanup_session_rows) != session_ids or len(cleanup_session_rows) != 3:
        raise ContractError("session cleanup must use every exact setup session ID once")
    if set(cleanup_activities) != activity_ids or len(cleanup_activities) != 2:
        raise ContractError("template cleanup must use both exact setup activity IDs once")

    cleanup_steps = [
        "delete from public.operational_bookings",
        "delete from public.operational_sessions",
        "delete from public.operational_activity_templates",
        "delete from auth.users",
    ]
    normalized_cleanup = cleanup_sql.lower()
    positions = [normalized_cleanup.find(step) for step in cleanup_steps]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        raise ContractError("cleanup must delete bookings before sessions, templates, and users")

    referenced_session_ids = set()
    for call in calls:
        executable_sql = strip_sql_comments(call.sql)
        for pattern in (
            r"\bsession_id\s*=\s*('(?:''|[^'])*')",
            r"\bfrom\s+public\.operational_sessions\s+where\s+id\s*=\s*('(?:''|[^'])*')",
        ):
            referenced_session_ids.update(
                sql_literal(match.group(1), "captured session reference")
                for match in re.finditer(pattern, executable_sql, re.IGNORECASE)
            )
        if re.search(
            r"\binsert\s+into\s+public\.operational_bookings\b",
            executable_sql,
            re.IGNORECASE,
        ):
            booking_rows = parse_insert(executable_sql, "operational_bookings")
            referenced_session_ids.update(
                sql_literal(row["session_id"], "booking session_id")
                for row in booking_rows
            )
    unexpected_session_references = referenced_session_ids - session_ids
    if unexpected_session_references:
        raise ContractError(
            "psql call uses a session ID outside setup: "
            f"{sorted(unexpected_session_references)}"
        )

    all_sql = "\n".join(strip_sql_comments(call.sql) for call in calls)
    allowed_ids = activity_ids | session_ids
    observed_ids = {
        sql_literal(match.group(0), "captured fixture ID")
        for match in re.finditer(
            r"'(?:event-concurrency-(?:paid|rsvp)[^']*)'",
            all_sql,
            re.IGNORECASE,
        )
    }
    unexpected_ids = observed_ids - allowed_ids
    if unexpected_ids:
        raise ContractError(
            f"psql calls contain fixture IDs outside this run: {sorted(unexpected_ids)}"
        )
    if not allowed_ids.issubset(observed_ids):
        raise ContractError("not every setup activity/session ID reached captured psql SQL")

    return RunContract(token, frozenset(activity_ids), frozenset(session_ids))


def main(arguments: list[str]) -> None:
    if len(arguments) != 2:
        fail("usage: verify_operational_rsvp_capture.py CAPTURE_DIR CAPTURE_DIR")
    try:
        first = validate_run(Path(arguments[0]))
        second = validate_run(Path(arguments[1]))
        if first.token == second.token:
            raise ContractError("separate harness invocations must use distinct run tokens")
        if first.activity_ids & second.activity_ids:
            raise ContractError("separate harness invocations must use distinct activity IDs")
        if first.session_ids & second.session_ids:
            raise ContractError("separate harness invocations must use distinct session IDs")
    except (ContractError, KeyError) as error:
        fail(str(error))
    print(
        "PASS: two real harness captures use distinct run IDs "
        f"({first.token} != {second.token}), exact activity-date sessions, "
        "valid fixture semantics, and matching child-first cleanup"
    )


if __name__ == "__main__":
    main(sys.argv[1:])
