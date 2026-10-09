#!/usr/bin/env bash
# tests/runtime-host/evidence/neon-evidence.sh — the P002 live-Neon
# evidence runner (Work Order P002; issue #154).
#
# Provisions the DEDICATED Neon evidence project and runs the live
# acceptance battery against a FRESH branch of it (so the zero→latest
# migration proof is canonical every run). Credentials are NEVER printed
# and NEVER written to the repository: the connection string exists only
# in the child process environment for the duration of the run.
#
# Safety law (the same one the live suite encodes):
#   - the ONLY project this script will ever touch is the one NAMED
#     "arena-p002-evidence" — it CREATES that project when missing and
#     reuses it when present; every other project in the org is
#     read-only-to-this-script (listed, never modified);
#   - every run creates a FRESH branch (p002-evidence-<timestamp>) with
#     its own read/write endpoint, so the battery always migrates
#     zero→latest on a clean database;
#   - the branch is disposable evidence state — delete old
#     p002-evidence-* branches at will; the project is the retention unit.
#
# Credentials (source /home/z/my-project/scripts/env.sh or export):
#   NEON_API_KEY_ALT (preferred) or NEON_API_KEY — the org-scoped console
#   key used ONLY for project listing/creation + branch creation on the
#   dedicated project.
#   ARENA_P002_NEON_PASSWORD — REQUIRED on re-runs against an
#   already-existing project (the neondb_owner password minted at project
#   creation; Neon never returns it again — keep it in the operator's
#   secret store, never in the repo). When THIS script creates the
#   project it uses the password from the creation response directly.
#
# Usage:
#   source /home/z/my-project/scripts/env.sh       # or export the vars
#   bash tests/runtime-host/evidence/neon-evidence.sh
#
# Output: the battery transcript (tests/runtime-host/evidence/
# live-neon-transcript.md) + the console run summary. Exit nonzero on
# any failed stage.

set -euo pipefail

API_BASE="https://console.neon.tech/api/v2"
PROJECT_NAME="arena-p002-evidence"

if [[ -n "${NEON_API_KEY_ALT:-}" ]]; then
  API_KEY="$NEON_API_KEY_ALT"
elif [[ -n "${NEON_API_KEY:-}" ]]; then
  API_KEY="$NEON_API_KEY"
else
  echo "[p002-evidence] FAIL: NEON_API_KEY_ALT (or NEON_API_KEY) is required" >&2
  exit 1
fi

auth_header() {
  printf 'Authorization: Bearer %s' "$API_KEY"
}

echo "[p002-evidence] looking up the dedicated project '$PROJECT_NAME' ..."
PROJECTS_JSON="$(curl -sS -m 30 "$API_BASE/projects" -H "$(auth_header)" -H 'accept: application/json')"
PROJECT_ID="$(printf '%s' "$PROJECTS_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for project in data.get('projects', []):
    if project.get('name') == '$PROJECT_NAME':
        print(project['id'])
        break
")"

PASSWORD="${ARENA_P002_NEON_PASSWORD:-}"
CREATE_JSON=""
if [[ -z "$PROJECT_ID" ]]; then
  echo "[p002-evidence] project '$PROJECT_NAME' does not exist — creating it (the ONLY write this script may make) ..."
  CREATE_JSON="$(curl -sS -m 120 -X POST "$API_BASE/projects" \
    -H "$(auth_header)" -H 'Content-Type: application/json' -H 'accept: application/json' \
    -d "{\"project\":{\"name\":\"$PROJECT_NAME\"}}")"
  PROJECT_ID="$(printf '%s' "$CREATE_JSON" | python3 -c "
import json, sys
print(json.load(sys.stdin)['project']['id'])
")"
  if [[ -z "$PASSWORD" ]]; then
    PASSWORD="$(printf '%s' "$CREATE_JSON" | python3 -c "
import json, sys
print(json.load(sys.stdin)['connection_uris'][0]['connection_parameters']['password'])
")"
  fi
  echo "[p002-evidence] created project $PROJECT_ID (password minted at creation — NEVER re-derivable; on future re-runs pass ARENA_P002_NEON_PASSWORD)"
else
  echo "[p002-evidence] found project $PROJECT_ID — reusing it (no other project is ever touched)"
fi

if [[ -z "$PASSWORD" ]]; then
  echo "[p002-evidence] FAIL: an existing project's password cannot be recovered — re-run with ARENA_P002_NEON_PASSWORD set (the value minted at project creation)" >&2
  exit 1
fi

# The default branch of the project (branch parents carry the role
# password forward to child branches — verified against live Neon).
DEFAULT_BRANCH_ID="$(curl -sS -m 30 "$API_BASE/projects/$PROJECT_ID/branches" \
  -H "$(auth_header)" -H 'accept: application/json' | python3 -c "
import json, sys
for branch in json.load(sys.stdin).get('branches', []):
    if branch.get('default'):
        print(branch['id'])
        break
")"

BRANCH_NAME="p002-evidence-$(date -u +%Y%m%dT%H%M%SZ)"
echo "[p002-evidence] creating fresh branch '$BRANCH_NAME' (clean database for the zero→latest proof) ..."
BRANCH_JSON="$(curl -sS -m 120 -X POST "$API_BASE/projects/$PROJECT_ID/branches" \
  -H "$(auth_header)" -H 'Content-Type: application/json' -H 'accept: application/json' \
  -d "{\"branch\":{\"name\":\"$BRANCH_NAME\",\"parent_id\":\"$DEFAULT_BRANCH_ID\"},\"endpoints\":[{\"type\":\"read_write\"}]}")"
BRANCH_ID="$(printf '%s' "$BRANCH_JSON" | python3 -c "
import json, sys
print(json.load(sys.stdin)['branch']['id'])
")"
BRANCH_HOST="$(printf '%s' "$BRANCH_JSON" | python3 -c "
import json, sys
print(json.load(sys.stdin)['endpoints'][0]['host'])
")"

echo "[p002-evidence] project=$PROJECT_ID branch=$BRANCH_NAME ($BRANCH_ID) host=$BRANCH_HOST db=neondb role=neondb_owner password=<redacted>"

# Build the connection string WITHOUT printing it, then run the battery.
export ARENA_P002_NEON_EVIDENCE_URL
ARENA_P002_NEON_EVIDENCE_URL="$(printf 'postgresql://neondb_owner:%s@%s/neondb?sslmode=require' "$PASSWORD" "$BRANCH_HOST")"

cd "$(dirname "$0")/../../.."  # repository root
node tests/runtime-host/run.mjs

echo "[p002-evidence] green — transcript: tests/runtime-host/evidence/live-neon-transcript.md"
