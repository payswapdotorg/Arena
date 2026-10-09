# P008 — Branch protection record (hard gate 4)

- **Work order:** P008 (issue #160) · **Governing rule:** `spec/post-roadmap-release-gate.md`
  §4.4 — "main branch protection and required checks confirmed by a repository
  administrator, recorded in the repo."
- **Check window:** 2026-10-09T13:28:36Z–13:41Z (fresh API reads; commands verbatim below).
- **Reader identity:** the platform credential authenticates as GitHub user `payswapdotorg`
  (the repository OWNER account; the repo API reports `permissions: {admin: true, maintain:
  true, push: true, triage: true, pull: true}` for this token). The reads below are therefore
  made WITH repository-admin scope — this is NOT an access-denied record.

## 1. What the API actually says (fresh reads, 2026-10-09T13:28:36Z)

```bash
source /home/z/my-project/scripts/env.sh   # GITHUB_TOKEN (payswapdotorg, repo-admin scope)

# (a) branch protection detail
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/payswapdotorg/Arena/branches/main/protection"
# -> HTTP 404
#    {"message": "Branch not protected", "status": 404}
#    (documentation_url: .../get-branch-protection)

# (b) branch summary (readable by anyone)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/payswapdotorg/Arena/branches/main"
# -> {"name": "main", "protected": false,
#     "required_status_checks": {"enforcement_level": "off", "contexts": [], "checks": []}}

# (c) re-verification at 2026-10-09T13:41Z — same answers (404 "Branch not protected").
```

## 2. Honest finding

**main branch protection is ABSENT.** This is not an "operator-confirmation-required"
record: the endpoint is readable with repository-admin scope and it answers definitively —
`protected: false`, no required status checks, no required reviews, nothing. The historical
uncertainty in `docs/LLM-ARCHITECT-FINAL-HANDOFF.md` limitation 10 ("could not be verified
through the current GitHub integration — the endpoint returned 403; a previous review
reported protection disabled") is resolved by these fresh admin-scoped reads: **protection
is disabled.**

**Required checks exist as workflow runs but are advisory only.** The CI workflow
(`ci.yml`, check name **"Battery (install / governance / boundary / typecheck / lint /
test / build)"**) runs on PRs and main pushes (e.g. PR #170's head run), and the Deploy
preview workflow gates its deploy job behind its wiring self-test — but with branch
protection off, NOTHING enforces them: a direct push to main (or a merge without a green
Battery) cannot be blocked. In fact the fresh history already shows the effect: Deploy
preview has been failing on every main push since 2026-10-09T07:52Z (see
`hosted-availability-and-deploy-linkage.md` §2.3) without blocking anything.

## 3. Gate disposition (hard gate 4)

**NOT SATISFIED.** Per release-gate §6 ("Every hard gate is satisfied or waived in writing
by the release owner") and §4.4, this is a NO-GO contributing fact. The TL cannot waive it
(§4: "These cannot be waived by the TL").

## 4. Operator action (repository administrator — exact commands)

```bash
# With an admin token (gh CLI or REST), e.g. requiring the CI Battery check + PR reviews:
gh api -X PUT repos/payswapdotorg/Arena/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Battery (install / governance / boundary / typecheck / lint / test / build)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

# then RECORD the confirmation in the repo (re-run this file's §1 reads — they must answer
# 200 with the protection payload, and branches/main must show protected: true):
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://api.github.com/repos/payswapdotorg/Arena/branches/main/protection"
```

Notes for the operator:
- The context string must match the check-run name exactly ("Battery (install / governance /
  boundary / typecheck / lint / test / build)" as observed on PR #170 / main runs). Consider
  also adding the Deploy preview workflow's jobs as required contexts once it is green again
  (it is currently red on main — see the linkage record §2.3 — so requiring it now would
  block merges until the deploy wiring test is fixed).
- `enforce_admins: true` matters: without it, admin pushes bypass the required checks.
- After enabling protection, the release-gate §4.4 record is satisfied by a fresh read whose
  payload is committed to the repo (this file, §1, re-run by the TL or a gate re-run).

## 5. Current-state summary for the gate record

| Item | State at 2026-10-09T13:28Z |
|---|---|
| main protected | **false** (API 404 "Branch not protected", admin-scoped read) |
| required status checks | none (`enforcement_level: off`) |
| required reviews | none |
| Battery check exists | yes (CI workflow, runs on PRs + main pushes — advisory only) |
| Hard gate 4 | **NOT SATISFIED — NO-GO contributing fact; operator action above** |
