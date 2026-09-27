/**
 * Substrate ≢ Body anti-aliasing suite (gate 5; spec AB1.0 Compatibility
 * Profile: "It may NOT declare any model as semantically identical to the
 * Body"; architecture-lock rules 2, 3, 4).
 *
 * Three independent tripwires:
 *   1. NO exported equality/alias API exists: the module surface is
 *      reflected at runtime and scanned for name shapes that would assert
 *      substrate ≡ body (or model ≡ profession) equality;
 *   2. the CompatibilityProfile STRUCTURE has no member that can carry a
 *      model identity — only capability requirements; smuggling an
 *      identity-asserting field into construction fails with
 *      AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN;
 *   3. compatibility is a per-profile capability predicate: the SAME body
 *      version can be compatible with two DIFFERENT substrates (which are
 *      not equal to each other, and neither is equal to the body), and the
 *      evaluation result never asserts equivalence — only satisfied or
 *      failed REQUIREMENTS with reasons.
 *
 * Certification interpretation (spec AB1.0): nothing here or elsewhere in
 * the package can express "Substrate = Profession" (requirements R43, R46).
 */

import { describe, expect, it } from 'vitest';
import * as agentBody from './index.js';
import { AGENT_BODY_SCHEMAS } from './envelopes.js';
import { evaluateSubstrateCompatibility } from './compatibility.js';
import {
  createBodyVersion,
  isBodyVersion,
} from './body.js';
import { makeBodyVersion, makeProfile, makeSubstrate } from './test-support.js';

/**
 * Export-name shapes that would signal a substrate/model ≡ body equality
 * API. Substring-normalized (lowercase) so camelCase, snake_case and
 * kebab-case all trip.
 */
const FORBIDDEN_EXPORT_NAME_FRAGMENTS = [
  'substrateequalsbody',
  'bodyequalssubstrate',
  'substrateisbody',
  'issubstratethebody',
  'substratetobody',
  'modelisbody',
  'bodyismodel',
  'samemodelas',
  'samesubstrateas',
  'equivalentmodel',
  'modelequivalent',
  'identicalmodel',
  'modelidentity',
  'bodyalias',
  'aliasbody',
  'substratesemanticallyequal',
  'semanticallyequal',
  'assertsubstrateidentity',
  'substrateidentity',
];

function normalizeExportName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

describe('gate 5 — no substrate ≡ Body semantic-equality API exists (negative)', () => {
  it('the public module surface exports no equality/alias/identity-assertion function', () => {
    const exportNames = Object.keys(agentBody);
    expect(exportNames.length).toBeGreaterThan(50); // the surface exists and is rich
    const offenders: string[] = [];
    for (const name of exportNames) {
      const normalized = normalizeExportName(name);
      for (const fragment of FORBIDDEN_EXPORT_NAME_FRAGMENTS) {
        if (normalized.includes(fragment)) {
          offenders.push(`${name} (matches /${fragment}/)`);
        }
      }
    }
    expect(offenders, `equality-alias exports found: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no exported function name asserts profession/identity equality of a substrate', () => {
    // Broader sweep: anything mixing substrate/model with an equality verb
    // AND the body (e.g. "substrateEqualsBody", "modelIsTheBody").
    const offenders: string[] = [];
    for (const name of Object.keys(agentBody)) {
      const normalized = normalizeExportName(name);
      const mixesSubjectAndBody =
        (normalized.includes('substrate') || normalized.includes('model')) &&
        normalized.includes('body');
      const hasEqualityVerb = /equals|equalto|identical|equivalent|sameas|is/.test(normalized);
      if (mixesSubjectAndBody && hasEqualityVerb) {
        offenders.push(name);
      }
    }
    expect(offenders, `equality-verb exports found: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the CompatibilityProfile shape has no model-identity member (structural impossibility)', async () => {
    const bodyVersion = await makeBodyVersion();
    const profile = bodyVersion.substrateCompatibility;
    const memberNames = Object.keys(profile);
    // Every member is a capability requirement — none can address a model.
    for (const member of memberNames) {
      expect(normalizeExportName(member)).not.toMatch(/model|adapter|provider|family/);
    }
    // And the substrate-side identity fields are NOT present in the profile.
    for (const absent of ['adapterId', 'modelFamily', 'modelId', 'modelRevision']) {
      expect(memberNames).not.toContain(absent);
    }
  });

  it('smuggling an identity-asserting field into profile construction fails with SUBSTRATE_ALIAS_FORBIDDEN', async () => {
    const base = await makeBodyVersion();
    const input = {
      ...base.substrateCompatibility,
      equivalentModels: ['reasoner-general-2'],
    } as never;
    // The direct profile validator is the tripwire:
    expect(() => agentBody.toSubstrateCompatibilityProfile(input)).toThrow(
      /may not declare any model as semantically identical to the Body/,
    );
    // And so is BodyVersion construction (the profile is re-normalized even
    // when the caller passes a pre-validated profile object):
    let thrown: unknown;
    try {
      await createBodyVersion({
        ...(base as unknown as Parameters<typeof createBodyVersion>[0]),
        version: '2.0.0',
        substrateCompatibility: input,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(agentBody.AgentBodyError);
    expect((thrown as agentBody.AgentBodyError).code).toBe(
      agentBody.AGENT_BODY_ERROR_CODES.SUBSTRATE_ALIAS_FORBIDDEN,
    );
  });

  it('substrateAdaptations reference substrates BY CONTENT DIGEST, never by model identity', async () => {
    const substrate = await makeSubstrate();
    const profile = makeProfile({
      substrateAdaptations: [
        {
          substrateDigest: substrate.integrity.contentDigest,
          adaptation: {
            namespace: 'tenant-a',
            name: 'adaptation-prompting',
            version: '1.0.0',
            digest: 'b'.repeat(64),
          },
        },
      ],
    });
    const adaptation = profile.substrateAdaptations[0];
    expect(adaptation?.substrateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(adaptation ?? {})).not.toContain('modelId');
  });
});

describe('gate 5 — compatibility is declared per-profile, never as identity (positive shape)', () => {
  it('ONE body version, TWO different substrates, both compatible — with no equivalence anywhere', async () => {
    const bodyVersion = await makeBodyVersion();
    expect(isBodyVersion(bodyVersion)).toBe(true);
    const profile = bodyVersion.substrateCompatibility;

    const substrateA = await makeSubstrate({ modelId: 'reasoner-general-2' });
    const substrateB = await makeSubstrate({
      adapterId: 'adapter-planning-2',
      adapterVersion: '2.0.0',
      modelFamily: 'planner',
      modelId: 'planner-heavy-9',
      modelRevision: 'r1',
    });

    const resultA = evaluateSubstrateCompatibility(profile, substrateA);
    const resultB = evaluateSubstrateCompatibility(profile, substrateB);
    expect(resultA.compatible).toBe(true);
    expect(resultB.compatible).toBe(true);

    // The two substrates are distinct content (not equal models)...
    expect(substrateA.integrity.contentDigest).not.toBe(substrateB.integrity.contentDigest);
    // ...and neither digest equals the body version digest (not the body).
    for (const substrate of [substrateA, substrateB]) {
      expect(substrate.integrity.contentDigest).not.toBe(bodyVersion.digest);
    }
    // ...and the evaluation result carries ONLY requirement outcomes.
    expect(resultA.reasons).toEqual([]);
    expect(JSON.stringify(resultA)).not.toMatch(/equival|identical|alias/i);
  });

  it('a failing substrate fails with REASONS, never with an identity judgment', async () => {
    const profile = await makeBodyVersion().then((version) => version.substrateCompatibility);
    const incapable = await makeSubstrate({
      toolCallingProfile: 'none',
      contextLimits: { maxContextUnits: 1000, maxOutputUnits: 100 },
      conditions: ['deprecated'],
    });
    const result = evaluateSubstrateCompatibility(profile, incapable);
    expect(result.compatible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) {
      expect(reason).not.toMatch(/equival|identical|alias|same as the body/i);
    }
  });

  it('the certification schema vocabulary has no profession/equality member', () => {
    // Schema names owned by this package: none speaks of equivalence.
    for (const name of Object.keys(AGENT_BODY_SCHEMAS)) {
      expect(name.toLowerCase()).not.toMatch(/equival|identical|alias/);
    }
  });
});
