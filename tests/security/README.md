# tests/security — the A034 adversarial battery

The cross-cutting **adversarial security battery** for Work Order A034
(spec/security.md S1.0) — attacks the REAL `@arena/security` protocol and
the REAL `@arena/security-service` facade together, through the same wire
envelopes the sibling services use.

`tests/security` is deliberately NOT a pnpm workspace project (the
workspace root does not include `tests/*`, and adding it would be a
root-manifest edit that A034 must not make). The battery therefore runs
through the `services/security` workspace package, which owns the vitest
installation and wires the battery scripts:

```bash
cd services/security
pnpm run battery:test        # vitest run --root ../../tests/security
pnpm run battery:typecheck   # tsc --noEmit -p ../../tests/security/tsconfig.json
```

Workspace imports resolve through explicit aliases to the packages'
TypeScript sources (`vitest.config.ts`), so the battery exercises the
real protocol code — not copies.

## The battery

| File | Attacks |
| --- | --- |
| `battery.test.ts` | **Cross-tenant access denial matrix** — a *generous* tenant-alpha policy (7 allow actions × 3 roles) is probed by a tenant-beta principal against EVERY S1.0 boundary class × every action: 63 cross-tenant cells, all denied; the same policy allows the in-tenant read (the matrix is not vacuous). **Privilege escalation** — duplicate-role self-promotion, wildcard-action policy crafting, untenanted platform operators, the anonymous principal, policy identity conflicts. **Fail-closed defaults** — empty policies deny everything, no ambient policy, malformed wire commands, tampered digests, unknown bundle lookups. |
| `audit-replay.test.ts` | **Audit trail attacks** — replayed event ids (rejected, nothing sealed), stolen event ids, reordered records (chain breaks), removed middle records (sequence discontinuity), tampered payloads (digest mismatch), forged appended records, the no-deletion surface (method allow-list), frozen records, snapshot isolation. |
| `data-rights-violations.test.ts` | **Data-rights violations** — retention expiry, withdrawn publication status, cross-tenant reads of non-public records; **the learning gate is not a rubber stamp** — 8 attacks (no grant, scope escalation, expiry probing, revoked grant, downgraded permitted-use, missing rights record, retention-expired dataset under a valid grant) each denied with a closed machine-readable reason and audited; **the secret gate** — runtime-assembled credential fixtures never enter generic trajectories, scrubbing produces trajectory-safe output, and the battery's own source scans clean under the package's detector. |

## Push-protection discipline

Every credential-shaped fixture in this battery is assembled AT RUNTIME
from string fragments (`['gh', 'p_', ...].join('')`) so no realistic
secret shape ever appears in committed source. The final test in
`data-rights-violations.test.ts` asserts this property on the battery's
own source file.
