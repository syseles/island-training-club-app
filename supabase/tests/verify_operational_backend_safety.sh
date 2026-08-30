#!/usr/bin/env bash
# Island Training Club — safety-only harness for the operational backend
# destructive verifier. Exercises the gate without ever touching a database.
#
# This script must NOT require psql or any database URL. It verifies the
# destructive gates, then runs the actual concurrency harness against a
# controlled fake psql and validates the exact SQL emitted at that boundary.
#
# Usage:
#   bash supabase/tests/verify_operational_backend_safety.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/supabase/tests/verify_operational_backend.sh"
concurrency="$repo_root/supabase/tests/operational_rsvp_concurrency.sh"
capture_validator="$repo_root/supabase/tests/verify_operational_rsvp_capture.py"

if [[ ! -x "$verifier" ]]; then
  chmod +x "$verifier"
fi
if [[ ! -x "$concurrency" ]]; then
  echo "FAIL: bounded RSVP concurrency harness is missing or not executable" >&2
  exit 1
fi
bash -n "$concurrency"
if [[ ! -f "$capture_validator" ]]; then
  echo "FAIL: RSVP rendered-SQL capture validator is missing" >&2
  exit 1
fi
if ! grep -Fq 'operational_rsvp_concurrency.sh' "$verifier"; then
  echo "FAIL: operational verifier does not invoke the RSVP concurrency harness" >&2
  exit 1
fi

run_case() {
  local label="$1" expect="$2" command="$3"
  shift 3
  set +e
  "$command" "$@"
  local actual=$?
  set -e
  if [[ "$actual" != "$expect" ]]; then
    echo "FAIL: $label expected exit $expect, got $actual" >&2
    exit 1
  fi
  echo "PASS: $label (exit $actual)"
}

run_case "missing URL is refused" 2 "$verifier"
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example" \
  run_case "missing ITC_ALLOW_DATABASE_RESET is refused (env set)" 2 "$verifier"

# Ensure --safety-check-only is honored when no URL is supplied: must not
# attempt any database connection.
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example.invalid:5432/postgres" \
  run_case "missing ITC_ALLOW_DATABASE_RESET still refuses" 2 "$verifier"

# When the gate is acknowledged but no URL is supplied, the script must
# refuse with exit 2 (not 3, which would imply a connection attempt).
ITC_ALLOW_DATABASE_RESET=1 run_case "URL required even when acknowledged" 2 "$verifier"

run_case "concurrency harness refuses missing URL" 2 "$concurrency"
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://example" \
  run_case "concurrency harness refuses missing acknowledgment" 2 "$concurrency"
ITC_ALLOW_DATABASE_RESET=1 \
  run_case "concurrency harness requires a URL when acknowledged" 2 "$concurrency"

# Acknowledged source-only mode must parse and exit without touching psql.
fake_dir="$(mktemp -d)"
trap 'rm -rf "$fake_dir"' EXIT
cat >"$fake_dir/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${ITC_FAKE_PSQL_CALLED:-}" ]]; then
  touch "$ITC_FAKE_PSQL_CALLED"
fi

mode=""
payload=""
capture_file=""
args=("$@")
for ((index = 0; index < ${#args[@]}; index += 1)); do
  case "${args[$index]}" in
    -Atqc|-c)
      mode="${args[$index]}"
      payload="${args[$((index + 1))]}"
      break
      ;;
    -f)
      mode="-f"
      payload="$(<"${args[$((index + 1))]}")"
      break
      ;;
  esac
done

if [[ -z "$mode" ]]; then
  echo "fake psql did not receive a supported SQL option" >&2
  exit 98
fi

if [[ -n "${ITC_FAKE_PSQL_CAPTURE_DIR:-}" ]]; then
  mkdir -p "$ITC_FAKE_PSQL_CAPTURE_DIR"
  capture_file="$(mktemp "$ITC_FAKE_PSQL_CAPTURE_DIR/call.XXXXXX")"
  printf 'MODE:%s\n%s' "$mode" "$payload" >"$capture_file"
fi

if [[ "$payload" == *"select to_regclass('public.operational_bookings') is not null"* ]]; then
  printf 't\n'
  exit 0
fi
if [[ "$payload" == *"concat_ws('|', paid_date"* ]]; then
  python3 - "$capture_file" <<'PY'
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

hkt = ZoneInfo("Asia/Hong_Kong")
anchor = (
    datetime.fromtimestamp(Path(sys.argv[1]).stat().st_mtime, hkt)
    if sys.argv[1]
    else datetime.now(hkt)
)
paid = anchor.date() + timedelta(days=500)
print("|".join(str(paid + timedelta(days=offset)) for offset in range(3)))
PY
  exit 0
fi
if [[ "$mode" == "-f" ]]; then
  ready_path="$(printf '%s\n' "$payload" | awk '/^\\! touch "/ { sub(/^\\! touch "/, ""); sub(/"$/, ""); print; exit }')"
  if [[ -n "$ready_path" ]]; then
    : >"$ready_path"
  fi
fi
if [[ -n "${ITC_FAKE_PSQL_CLEANUP_EXIT:-}" && "$payload" == *"delete from public.operational_bookings"* ]]; then
  exit "$ITC_FAKE_PSQL_CLEANUP_EXIT"
fi
if [[ -n "${ITC_FAKE_PSQL_BODY_EXIT:-}" && "$payload" == *"mark_operational_payment("* ]]; then
  exit "$ITC_FAKE_PSQL_BODY_EXIT"
fi
exit 0
EOF
chmod +x "$fake_dir/psql"
ITC_FAKE_PSQL_CALLED="$fake_dir/called" \
ITC_OPERATIONS_PSQL_BIN="$fake_dir/psql" \
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://source-only.invalid/postgres" \
ITC_ALLOW_DATABASE_RESET=1 \
  run_case "concurrency source safety mode is non-destructive" 0 "$concurrency" --safety-check-only
if [[ -e "$fake_dir/called" ]]; then
  echo "FAIL: concurrency source safety mode invoked psql" >&2
  exit 1
fi

capture_one="$fake_dir/capture-one"
capture_two="$fake_dir/capture-two"
for capture_dir in "$capture_one" "$capture_two"; do
  ITC_FAKE_PSQL_CAPTURE_DIR="$capture_dir" \
  ITC_OPERATIONS_PSQL_BIN="$fake_dir/psql" \
  ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://capture.invalid/postgres" \
  ITC_ALLOW_DATABASE_RESET=1 \
    run_case "actual concurrency harness renders complete SQL ($(basename "$capture_dir"))" 0 "$concurrency"
done
run_case "separate real harness invocations render distinct valid fixture SQL" 0 \
  python3 "$capture_validator" "$capture_one" "$capture_two"

make_mutation() {
  local mutation="$1" destination="$2"
  python3 - "$capture_one" "$destination" "$mutation" <<'PY'
import re
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
mutation = sys.argv[3]
shutil.copytree(source, destination)
paths = sorted(destination.glob("call.*"))
texts = {path: path.read_text() for path in paths}
joined = "\n".join(texts.values())
token_match = re.search(r"event-concurrency-rsvp-([a-z0-9]+)", joined)
if not token_match:
    raise SystemExit("mutation fixture is missing the captured RSVP token")
token = token_match.group(1)
paid_activity = f"event-concurrency-paid-{token}"
rsvp_activity = f"event-concurrency-rsvp-{token}"

def replace_across(old, new, minimum=1):
    count = 0
    for path, text in list(texts.items()):
        occurrences = text.count(old)
        if occurrences:
            texts[path] = text.replace(old, new)
            count += occurrences
    if count < minimum:
        raise SystemExit(f"{mutation} mutation did not find {old!r}")
    return count

if mutation == "duplicate-ids":
    replace_across(rsvp_activity, paid_activity, 2)
elif mutation == "invalid-session-id":
    child_path = next(
        (path for path, text in texts.items() if "for share;" in text.lower()),
        None,
    )
    if child_path is None:
        raise SystemExit("invalid-session mutation could not find the FOR SHARE child SQL")
    child_sql = texts[child_path]
    match = re.search(
        rf"{re.escape(paid_activity)}-\d{{4}}-\d{{2}}-\d{{2}}",
        child_sql,
    )
    if not match:
        raise SystemExit("invalid-session mutation could not find the child session ID")
    texts[child_path] = child_sql.replace(match.group(0), "invalid-paid-session", 1)
elif mutation == "static-dates":
    captured_dates = sorted(set(re.findall(
        rf"(?:{re.escape(paid_activity)}|{re.escape(rsvp_activity)})-(\d{{4}}-\d{{2}}-\d{{2}})",
        joined,
    )))
    if len(captured_dates) != 3:
        raise SystemExit("static-date mutation could not find three captured fixture dates")
    for captured_date, static_date in zip(
        captured_dates,
        ("2099-01-01", "2099-01-02", "2099-01-03"),
    ):
        replace_across(captured_date, static_date, 2)
elif mutation == "inverted-semantics":
    replacements = [
        (
            "time '11:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false)",
            "time '11:00', 60, null, 0, true, false, 'HYROX', 'BFT Causeway Bay', true)",
            1,
        ),
        (
            "time '12:00', 60, null, 0, true, false, 'Socials', null, true)",
            "time '12:00', 60, 20, 180, true, false, 'Socials', null, false)",
            1,
        ),
        ("60, 'BFT Causeway Bay', 20, 180, true)", "60, 'BFT Causeway Bay', null, 0, true)", 1),
        ("60, 'TBC', null, 0, true)", "60, 'TBC', 20, 180, true)", 2),
    ]
    for old, new, minimum in replacements:
        replace_across(old, new, minimum)
elif mutation == "parent-first-cleanup":
    cleanup_path = next(
        (
            path
            for path, text in texts.items()
            if "delete from public.operational_activity_templates" in text
        ),
        None,
    )
    if cleanup_path is None:
        raise SystemExit("parent-first mutation could not find cleanup SQL")
    text = texts[cleanup_path]
    patterns = [
        r"\s*delete from public\.operational_bookings\s+where session_id in \(.*?\);",
        r"\s*delete from public\.operational_sessions\s+where id in \(.*?\);",
        r"\s*delete from public\.operational_activity_templates\s+where activity_id in \(.*?\);",
        r"\s*delete from auth\.users where id in \(.*?\);",
    ]
    matches = [re.search(pattern, text, re.DOTALL) for pattern in patterns]
    if any(match is None for match in matches):
        raise SystemExit("parent-first mutation could not parse every cleanup step")
    blocks = [match.group(0).strip("\n") for match in matches]
    start = min(match.start() for match in matches)
    end = max(match.end() for match in matches)
    texts[cleanup_path] = text[:start] + "\n".join(
        [blocks[2], blocks[1], blocks[0], blocks[3]]
    ) + text[end:]
else:
    raise SystemExit(f"unknown mutation: {mutation}")

for path, text in texts.items():
    path.write_text(text)
PY
}

for mutation in duplicate-ids invalid-session-id static-dates inverted-semantics parent-first-cleanup; do
  mutation_dir="$fake_dir/mutation-$mutation"
  make_mutation "$mutation" "$mutation_dir"
  run_case "rendered SQL mutation is rejected: $mutation" 1 \
    python3 "$capture_validator" "$mutation_dir" "$capture_two"
done

failure_capture="$fake_dir/failure-capture"
ITC_FAKE_PSQL_CAPTURE_DIR="$failure_capture" \
ITC_FAKE_PSQL_BODY_EXIT=7 \
ITC_FAKE_PSQL_CLEANUP_EXIT=99 \
ITC_OPERATIONS_PSQL_BIN="$fake_dir/psql" \
ITC_OPERATIONS_TEST_DATABASE_URL="postgresql://capture.invalid/postgres" \
ITC_ALLOW_DATABASE_RESET=1 \
  run_case "concurrency cleanup preserves the original body exit" 7 "$concurrency"
python3 - "$failure_capture" <<'PY'
import sys
from pathlib import Path

if not any(
    "delete from public.operational_bookings" in path.read_text()
    for path in Path(sys.argv[1]).glob("call.*")
):
    print("FAIL: body-failure run did not execute actual cleanup SQL", file=sys.stderr)
    raise SystemExit(1)
print("PASS: body-failure run emitted actual cleanup SQL before restoring exit 7")
PY

echo "Safety verifier passed: destructive gates, real rendered SQL, adversarial contracts, and bounded cleanup behavior are valid."
