#!/usr/bin/env node
/**
 * Demo entry for the A007 reference expert-matching fabric (Work Order
 * gate: a typed programmatic API + this main.mjs demo entry is the
 * required surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/expert-qualification protocol:
 *   register an expert card + evidence (2 work products + 1 passing
 *   verification) + a qualification policy → register the claim →
 *   qualify-claim command (envelope round trip, idempotent replay) →
 *   match-experts query (envelope round trip) → the ranked result with
 *   per-requirement evidence → negative probes (proficiency threshold,
 *   tenant isolation, decay/expiry append) → an observability dump.
 *
 * Everything is deterministic: fixed timestamps and fixed content (no
 * Math.random anywhere).
 *
 * Run:
 *   cd services/expert-matching && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and a
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors the A012/A013 demo
 * entries' bootstrap verbatim.)
 */

// ---------------------------------------------------------------------------
// Bootstrap: run under `node --experimental-strip-types` with the
// workspace's .js→.ts source-remap hook registered (zero dependencies —
// the workspace exports TypeScript sources, so this is what lets the
// demo run the REAL packages straight from src/). Relaunch once with
// the flag when invoked plainly (`node main.mjs` / `pnpm demo`).
// ---------------------------------------------------------------------------

if (
  !process.execArgv.some((arg) => arg.includes('strip-types')) &&
  process.env.ARENA_A007_DEMO !== 'respawned'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--',
      import.meta.filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, ARENA_A007_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const {
  createQualificationEvidence,
  createCompetencyClaim,
  EXPERT_QUALIFICATION_PROTOCOL_VERSION,
} = await import('@arena/expert-qualification');
const { ExpertMatchingFabric } = await import('./src/index.js');
const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');

const T0 = '2026-01-15T09:30:00.000Z';
const T_FRESH = '2026-01-10T09:30:00.000Z';
const CORR = toCorrelationId('corr-a007-demo-0001');
const IDEM_QUALIFY = toIdempotencyKey('idem-a007-qualify-0001');
const IDEM_QUALIFY_REPLAY = toIdempotencyKey('idem-a007-qualify-0001');
const IDEM_EXPIRY = toIdempotencyKey('idem-a007-expiry-0001');

const log = (label, value) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

// ---------------------------------------------------------------------------
// 1. Registration: card, evidence, policy, claim
// ---------------------------------------------------------------------------

const fabric = new ExpertMatchingFabric();

const card = await fabric.registerExpertCard(
  await (
    await import('@arena/expert-qualification')
  ).createQualifiedExpertCard({
    expertId: 'expert-ada',
    tenant: 'tenant-alpha',
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: '3333333333333333333333333333333333333333333333333333333333333333' },
    ],
    jurisdictions: [{ country: 'US' }],
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
  }),
);
log('expert card registered', { expertId: card.expertId, tenant: card.tenant, digest: card.digest });

const work1 = await createQualificationEvidence({
  kind: 'work-product-ref',
  observedAt: T_FRESH,
  workProduct: {
    digest: '4444444444444444444444444444444444444444444444444444444444444444',
    description: 'reviewed pull request with verification notes',
  },
});
const work2 = await createQualificationEvidence({
  kind: 'work-product-ref',
  observedAt: T_FRESH,
  workProduct: {
    digest: '5555555555555555555555555555555555555555555555555555555555555555',
    description: 'reviewed pull request with follow-up fixes',
  },
});
const verification = await createQualificationEvidence({
  kind: 'verification-ref',
  observedAt: T_FRESH,
  verification: {
    recordDigest: '6666666666666666666666666666666666666666666666666666666666666666',
    outcome: 'pass',
  },
});
for (const evidence of [work1, work2, verification]) fabric.registerEvidence(evidence);
log('evidence registered', [work1.kind, work2.kind, verification.kind]);

const policy = await fabric.registerQualificationPolicy(
  await (
    await import('@arena/expert-qualification')
  ).createQualificationPolicy({
    policyId: 'policy-rust-review',
    version: '1.4.0',
    description: 'Two fresh work products plus one passing verification record, valid 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  }),
);
log('qualification policy registered', { policyId: policy.policyId, version: policy.version });

const registeredClaim = await fabric.registerClaim(
  await createCompetencyClaim({
    expertId: 'expert-ada',
    tenant: 'tenant-alpha',
    capability: {
      kind: 'skill',
      id: 'rust-code-review',
      version: '2.1.0',
      digest: '1111111111111111111111111111111111111111111111111111111111111111',
    },
    proficiency: 'proficient',
    evidence: [work1.digest, work2.digest, verification.digest],
    declaredAt: T_FRESH,
  }),
);
const claim = registeredClaim.claim;
log('competency claim registered', { claimDigest: claim.digest, proficiency: claim.proficiency });

// ---------------------------------------------------------------------------
// 2. qualify-claim command (envelope round trip + idempotent replay)
// ---------------------------------------------------------------------------

const qualified = await fabric.qualifyClaim(
  { claimRef: claim.digest, policyRef: policy.digest, evaluatedAt: T0, renew: false },
  { correlationId: CORR, idempotencyKey: IDEM_QUALIFY },
);
log('qualification record appended', {
  status: qualified.record.status,
  validFrom: qualified.record.validFrom,
  validUntil: qualified.record.validUntil,
  digest: qualified.record.digest,
  requirementOutcomes: qualified.record.requirementOutcomes.map((outcome) => ({
    requirementId: outcome.requirementId,
    freshCount: outcome.freshCount,
    satisfied: outcome.satisfied,
  })),
  eventSchema: qualified.event.schema,
});

const replay = await fabric.qualifyClaim(
  { claimRef: claim.digest, policyRef: policy.digest, evaluatedAt: T0, renew: false },
  { correlationId: CORR, idempotencyKey: IDEM_QUALIFY_REPLAY },
);
console.log(`\n=== idempotent replay: same key + same command → same record (${
  replay.record.digest === qualified.record.digest ? 'OK' : 'DRIFT'
}) ===`);

// ---------------------------------------------------------------------------
// 3. match-experts query (envelope round trip) — the golden path
// ---------------------------------------------------------------------------

const { createMatchRequest, createMatchingPolicy } = await import('@arena/expert-qualification');
const request = await createMatchRequest({
  tenant: 'tenant-alpha',
  requirements: [
    {
      requirementId: 'req-rust',
      capability: {
        kind: 'skill',
        id: 'rust-code-review',
        version: '2.1.0',
        digest: '1111111111111111111111111111111111111111111111111111111111111111',
      },
      minimumProficiency: 'proficient',
    },
  ],
  evaluatedAt: T0,
  domainRef: { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: '3333333333333333333333333333333333333333333333333333333333333333' },
  jurisdictions: [{ country: 'US' }],
});
const matchingPolicy = await createMatchingPolicy({
  policyId: 'policy-match-standard',
  version: '1.2.0',
  description: 'Standard deterministic matching with digest tie-breaks',
  maxCandidates: 10,
  includePartialMatches: true,
  availabilityRequired: true,
});
const matched = await fabric.matchExperts(request, matchingPolicy, { correlationId: CORR });
log('match result', {
  candidates: matched.result.candidates.map((candidate) => ({
    expertId: candidate.expertId,
    satisfiedAll: candidate.satisfiedAll,
    evidenceCount: candidate.evidenceCount,
    perRequirement: candidate.perRequirement.map((entry) =>
      entry.satisfied
        ? { requirementId: entry.requirementId, matchedProficiency: entry.matchedProficiency, recordDigest: entry.recordDigest }
        : { requirementId: entry.requirementId, unmatchedReason: entry.unmatchedReason },
    ),
  })),
  requirementsUnmet: matched.result.requirementsUnmet,
  truncated: matched.result.truncated,
  querySchema: matched.query.schema,
  responseSchema: matched.response.schema,
});

// ---------------------------------------------------------------------------
// 4. Negative probes (deterministic, no best-effort)
// ---------------------------------------------------------------------------

// 4a. proficiency threshold: request 'advanced' — the claim is 'proficient'
const strictRequest = await createMatchRequest({
  tenant: 'tenant-alpha',
  requirements: [
    {
      requirementId: 'req-rust',
      capability: {
        kind: 'skill',
        id: 'rust-code-review',
        version: '2.1.0',
        digest: '1111111111111111111111111111111111111111111111111111111111111111',
      },
      minimumProficiency: 'advanced',
    },
  ],
  evaluatedAt: T0,
});
const strictMatch = await fabric.matchExperts(strictRequest, matchingPolicy, { correlationId: CORR });
console.log('\n=== proficiency-below-threshold probe ===');
console.log(
  strictMatch.result.candidates[0]?.perRequirement[0]?.unmatchedReason ??
    'UNEXPECTED MATCH',
);

// 4b. tenant isolation: a foreign tenant sees nothing
const foreignMatch = await fabric.matchExperts(
  await createMatchRequest({
    tenant: 'tenant-beta',
    requirements: [
      {
        requirementId: 'req-rust',
        capability: {
          kind: 'skill',
          id: 'rust-code-review',
          version: '2.1.0',
          digest: '1111111111111111111111111111111111111111111111111111111111111111',
        },
        minimumProficiency: 'proficient',
      },
    ],
    evaluatedAt: T0,
  }),
  matchingPolicy,
  { correlationId: CORR },
);
console.log('\n=== tenant isolation probe (tenant-beta sees NO candidates) ===');
console.log(`candidate count: ${foreignMatch.result.candidates.length}`);

// 4c. decay: append the expired record after the window lapses
const after = new Date(
  Date.parse(qualified.record.validUntil) + 48 * 60 * 60 * 1000,
).toISOString();
const expired = await fabric.recordQualificationExpiry(
  { claimRef: claim.digest, evaluatedAt: after },
  { correlationId: CORR, idempotencyKey: IDEM_EXPIRY },
);
log('decay record appended (history untouched)', {
  status: expired.record.status,
  supersedes: expired.record.supersedes,
  priorRecordStillQualified: fabric.pool.getQualificationRecord(qualified.record.digest)?.status,
});

// 4d. matching after decay: the requirement is now unmet, with the reason
const lateMatch = await fabric.matchExperts(
  await createMatchRequest({
    tenant: 'tenant-alpha',
    requirements: [
      {
        requirementId: 'req-rust',
        capability: {
          kind: 'skill',
          id: 'rust-code-review',
          version: '2.1.0',
          digest: '1111111111111111111111111111111111111111111111111111111111111111',
        },
        minimumProficiency: 'proficient',
      },
    ],
    evaluatedAt: after,
  }),
  matchingPolicy,
  { correlationId: CORR },
);
console.log('\n=== post-decay match (explicit reason, no silent best-effort) ===');
console.log(
  lateMatch.result.candidates[0]?.perRequirement[0]?.unmatchedReason ??
    'UNEXPECTED MATCH',
  '| requirementsUnmet:',
  lateMatch.result.requirementsUnmet,
);

// ---------------------------------------------------------------------------
// 5. Observability dump
// ---------------------------------------------------------------------------

log('observability', {
  protocolVersion: EXPERT_QUALIFICATION_PROTOCOL_VERSION,
  describe: fabric.describe(),
  eventSchemas: fabric.listEvents().map((event) => event.schema),
});

console.log('\n=== A007 demo complete (deterministic) ===');
