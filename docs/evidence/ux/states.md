# G003 evidence — loading/empty/error/denied states

## Error state (404, fresh browser)

Unknown route `/nonexistent-g003-audit` renders the 404 state (HTTP 404 — see G002 http
evidence; screenshot `screenshots/not-found.png`).

## Loading / empty states

Covered by the B017 UX battery `states.test.ts` (10 tests, all passing on the G001 fresh
run, 2026-10-07) — loading.tsx / error.tsx / not-found.tsx exist in the app tree.

## Denied state

The B019 acceptance harness (G002 evidence, run live 2026-10-07 13:21 UTC) verified:
"Operations surface gated by server-side fail-closed session validation" — the denied
posture is server-side, not cosmetic.

## Notes

This audit did not trigger a synthetic API-failure surface beyond the 404; that is covered
by the repo's own state suites. Recorded honestly as a scope note, not a gap hidden.
