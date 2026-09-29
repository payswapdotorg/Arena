/**
 * Fabric registry tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError, CERTIFICATION_ERROR_CODES, createCertificationSuite } from '@arena/certification';
import { createCertificationRegistry } from './registry.js';
import { makeSuite } from './test-support.js';
import { T0 } from './test-support.js';

describe('CertificationRegistry', () => {
  it('registers a suite by descriptor digest (idempotent)', async () => {
    const registry = createCertificationRegistry();
    const suite = await makeSuite('suite-a');
    const a = registry.registerSuite(suite);
    expect(a.digest).toBe(suite.digest);
    const b = registry.registerSuite(suite); // idempotent re-registration
    expect(b.digest).toBe(suite.digest);
    expect(registry.listSuites()).toHaveLength(1);
  });

  it('rejects a structurally invalid descriptor', async () => {
    const registry = createCertificationRegistry();
    expect(() => registry.registerSuite({} as never)).toThrowError(CertificationError);
  });

  it('rejects a different digest under the same (suiteId, version) identity', async () => {
    const registry = createCertificationRegistry();
    const suite = await makeSuite('suite-conflict');
    registry.registerSuite(suite);
    // Construct a DIFFERENT descriptor under the SAME (suiteId, version)
    // identity — the title differs, so the digest differs.
    const different = await createCertificationSuite({
      suiteId: 'suite-conflict',
      version: '1.0.0',
      title: 'A different suite title (different content yields a different digest)',
      scopeStatement:
        'Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X.',
      components: suite.components.map((c) => ({ kind: c.kind, refs: [...c.refs] })),
      verdictSemantics: {
        pass: suite.verdictSemantics.pass,
        'conditional-pass': suite.verdictSemantics['conditional-pass'],
        fail: suite.verdictSemantics.fail,
        unknown: suite.verdictSemantics.unknown,
      },
      inputSchema: { ...suite.inputSchema },
      outputSchema: { ...suite.outputSchema },
      provenance: {
        authoredBy: suite.provenance.authoredBy,
        submittedAt: T0,
        notes: suite.provenance.notes,
      },
    });
    expect(different.digest).not.toBe(suite.digest); // sanity
    expect(() => registry.registerSuite(different)).toThrowError(CertificationError);
    try {
      registry.registerSuite(different);
    } catch (error) {
      expect((error as CertificationError).code).toBe(
        CERTIFICATION_ERROR_CODES.IDENTITY_CONFLICT,
      );
    }
  });

  it('getSuite returns undefined for an unknown digest', async () => {
    const registry = createCertificationRegistry();
    expect(registry.getSuite('0'.repeat(64))).toBeUndefined();
  });

  it('listSuites returns insertion-order digests', async () => {
    const registry = createCertificationRegistry();
    const a = await makeSuite('suite-list-1');
    const b = await makeSuite('suite-list-2');
    registry.registerSuite(a);
    registry.registerSuite(b);
    const listed = registry.listSuites();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.digest).toBe(a.digest);
    expect(listed[1]?.digest).toBe(b.digest);
  });

  it('createCertificationRegistry produces a fresh registry', () => {
    const a = createCertificationRegistry();
    const b = createCertificationRegistry();
    expect(a).not.toBe(b);
    expect(a.listSuites()).toEqual([]);
  });
});
