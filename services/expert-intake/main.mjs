#!/usr/bin/env node
/**
 * Demo entry for the C003 expert-intake reference service (Work Order
 * gate: a typed programmatic API + this main.mjs demo entry is the
 * required surface; REST/HTTP layers are NOT).
 *
 * Drives ONE deterministic end-to-end scenario against the REAL
 * @arena/expert-intake engine and the injected A006/A007 port fakes:
 *   start-interview command (envelope round trip) → adaptive ask/answer
 *   loop (expected-information-value selection with inspectable
 *   rationale) → submit → assess (typed outcome) → the IntakeProfile
 *   handoff to the A006 registry proposal port + the A007 qualification
 *   claim port → negative probes (cross-tenant read, idempotency
 *   conflict) → an observability dump.
 *
 * Everything is deterministic: fixed timestamps, fixed seeds and fixed
 * content (the scripted reference interviewer model — no live model
 * calls, no randomness).
 *
 * Run:
 *   cd services/expert-intake && pnpm demo     (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and the
 * 20-line .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL
 * workspace packages run straight from their TypeScript sources — no
 * build step, zero new dependencies. (Mirrors the A007 demo entry's
 * bootstrap verbatim.)
 */

// ---------------------------------------------------------------------------
// Bootstrap: run under `node --experimental-strip-types` with the
// workspace's .js→.ts source-remap hook registered.
// ---------------------------------------------------------------------------

if (
  !process.execArgv.some((arg) => arg.includes('strip-types')) &&
  process.env.ARENA_C003_DEMO !== 'respawned'
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
    { stdio: 'inherit', env: { ...process.env, ARENA_C003_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');
const { createHash } = await import('node:crypto');
const { ExpertIntakeService } = await import('./src/index.js');
const { FakeRegistryProposalPort, FakeQualificationClaimPort } = await import('./src/index.js');

const digest = (seed) => createHash('sha256').update(seed).digest('hex');
const ref = (kind, id, version = '1.0.0') => ({ kind, id, version, digest: digest(`${kind}:${id}:${version}`) });

const T0 = '2026-10-07T09:30:00.000Z';
const T_ASK = '2026-10-07T09:31:00.000Z';
const T_ANSWER = '2026-10-07T09:32:00.000Z';
const T_SUBMIT = '2026-10-07T09:40:00.000Z';
const T_ASSESS = '2026-10-07T09:41:00.000Z';
const CORR = toCorrelationId('corr-c003-demo-0001');

const log = (label, value) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

const registry = new FakeRegistryProposalPort();
const qualification = new FakeQualificationClaimPort();
const service = new ExpertIntakeService({ registry, qualification });

const CATALOG_SEED = {
  competencyRefs: [ref('capability', 'financial-audit'), ref('skill', 'regression-analysis')],
  toolRefs: [ref('tool', 'ledger-cli')],
  domainRef: ref('domain', 'finance'),
  demandLocales: ['en-US'],
};

// 1. start-interview (command, idempotency key REQUIRED)
const { session, envelope } = await service.startInterview(
  {
    sessionId: 'intake-demo-0001',
    tenant: 'acme',
    expertId: 'expert-alice-01',
    catalogSeed: CATALOG_SEED,
    selectionSeed: 'demo-seed-0001',
    privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
  },
  { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-c003-start-0001'), at: T0 },
);
log('start-interview command envelope', {
  kind: envelope.kind,
  schema: envelope.schema,
  idempotencyKey: envelope.idempotencyKey,
});
log('session created', { sessionId: session.sessionId, state: session.state, catalogItems: session.catalog.length });

// 2. Adaptive ask/answer loop (every catalog item, typed default answers)
const defaultAnswer = (item) => {
  switch (item.expected.answerKind) {
    case 'proficiency-selection':
      return { answerKind: 'proficiency-selection', proficiency: 'proficient' };
    case 'locale-declaration':
      return { answerKind: 'locale-declaration', locales: ['en-US'] };
    case 'jurisdiction-declaration':
      return { answerKind: 'jurisdiction-declaration', jurisdictions: [{ jurisdictionVersion: 1, country: 'US' }] };
    case 'years-experience':
      return { answerKind: 'years-experience', years: 7 };
    case 'evidence-pointer':
      return {
        answerKind: 'evidence-pointer',
        evidenceKind: 'work-product-ref',
        evidenceDigest: digest(`evidence:${item.itemId}`),
        description: 'audit work product reference',
      };
    case 'scenario-response':
      return { answerKind: 'scenario-response', response: 'I would re-run the ledger reconciliation and report the delta.' };
    case 'availability-window':
      return { answerKind: 'availability-window', windows: [{ windowVersion: 1, recurrence: 'weekly', dayOfWeek: 2, startUtc: '09:00', endUtc: '17:00' }] };
    case 'privacy-consent':
      return { answerKind: 'privacy-consent', consentGranted: true, transcriptRetentionConsent: true };
    default:
      throw new Error(`no default answer for ${item.itemId}`);
  }
};

let askedCount = 0;
for (;;) {
  const asked = await service
    .askNextQuestionAt('intake-demo-0001', 'acme', { correlationId: CORR, at: T_ASK })
    .catch(() => null);
  if (asked === null) break;
  askedCount += 1;
  if (askedCount <= 2) {
    log(`adaptive selection #${askedCount} (inspectable rationale)`, {
      chosenItemId: asked.rationale.chosenItemId,
      topScored: [...asked.rationale.scored].sort((a, b) => b.score - a.score).slice(0, 3),
      question: asked.question,
    });
  }
  await service.recordAnswer('intake-demo-0001', 'acme', asked.item.itemId, defaultAnswer(asked.item), {
    correlationId: CORR,
    at: T_ANSWER,
  });
}
log('interview complete', { asked: askedCount });

// 3. submit + assess (commands, idempotency keys REQUIRED)
await service.submitInterview('intake-demo-0001', 'acme', {
  correlationId: CORR,
  idempotencyKey: toIdempotencyKey('idem-c003-submit-0001'),
  at: T_SUBMIT,
});
const assessment = await service.assessInterview('intake-demo-0001', 'acme', {
  correlationId: CORR,
  idempotencyKey: toIdempotencyKey('idem-c003-assess-0001'),
  at: T_ASSESS,
});
log('typed intake outcome', {
  outcome: assessment.outcome.outcome,
  envelopes: assessment.envelopes.map((e) => `${e.kind}:${e.schema.split('/').pop().split('@')[0]}`),
});
if (assessment.outcome.outcome === 'complete-with-claims') {
  log('IntakeProfile handoff (A006/A007 public ports)', {
    profileDigest: assessment.outcome.profile.digest,
    competencyClaims: assessment.outcome.profile.competencyClaims.map((claim) => ({
      capability: claim.capability.id,
      proficiency: claim.proficiency,
      evidence: claim.evidence.map((pointer) => pointer.evidenceKind),
    })),
    registryReceipt: assessment.handoff.registryProposal,
    claimReceipts: assessment.handoff.claimCandidates,
  });
}

// 4. Negative probes: cross-tenant read fails closed; idempotency conflict
const crossTenant = await service
  .getTranscript('intake-demo-0001', 'globex', { correlationId: CORR })
  .then(() => 'LEASED?!')
  .catch((error) => `${error.code}: ${error.message.slice(0, 90)}…`);
log('cross-tenant transcript read (fail closed)', crossTenant);

const conflict = await service
  .startInterview(
    {
      sessionId: 'intake-demo-9999',
      tenant: 'acme',
      expertId: 'expert-bob-02',
      catalogSeed: CATALOG_SEED,
      selectionSeed: 'different-seed',
      privacyPolicy: { dataClassification: 'internal', pii: 'minimal' },
    },
    { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-c003-start-0001'), at: T0 },
  )
  .then(() => 'NO CONFLICT?!')
  .catch((error) => `${error.code}: ${error.message.slice(0, 90)}…`);
log('idempotency conflict (same key + different tuple)', conflict);

// 5. Observability dump
log('observability', { ...service.describe(), registryProposals: registry.proposals.length, claimCandidates: qualification.claims.length });

console.log('\nC003 expert-intake demo complete — deterministic, claims are input to qualification, never an access grant.');
