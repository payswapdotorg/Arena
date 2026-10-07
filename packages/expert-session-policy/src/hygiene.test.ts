/**
 * Hygiene tests (Work Order C018) — house discipline: deep-frozen records,
 * closed vocabularies, no ambient clock in the domain core (every time
 * input is injected), no mutation surface on the audit log.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as domain from './index.js';
import { toPolicyAuditEvent } from './audit.js';
import { resolveEffectiveSessionPolicy } from './resolution.js';
import { T0, validEscalationRecord, validPolicyPack } from './test-support.js';

describe('record hygiene', () => {
  it('packs and resolved policies are deep-frozen (mutation throws in strict mode)', async () => {
    const pack = await validPolicyPack();
    expect(() => {
      'use strict';
      (pack as unknown as Record<string, unknown>)['displayName'] = 'mutated';
    }).toThrow();
    const escalation = await validEscalationRecord();
    const policy = resolveEffectiveSessionPolicy({ resolutionId: 'resolution-9000', escalation, pack, now: T0 });
    expect(() => {
      'use strict';
      (policy as unknown as Record<string, unknown>)['resolvedAt'] = '1970-01-01T00:00:00.000Z';
    }).toThrow();
    expect(() => {
      'use strict';
      (policy.barrier as unknown as Record<string, unknown>)['identityMasking'] = false;
    }).toThrow();
  });

  it('audit events are frozen at birth', () => {
    const event = toPolicyAuditEvent({
      recordVersion: 1,
      eventId: randomUUID(),
      kind: 'pack-registered',
      tenantId: 'tenant-alpha',
      principalId: null,
      action: 'register-pack',
      boundaryClass: null,
      outcome: { effect: 'recorded', reason: 'pack-valid' },
      correlationId: 'corr-1',
      causationId: null,
      occurredAt: T0,
    });
    expect(Object.isFrozen(event)).toBe(true);
  });
});

describe('closed vocabularies', () => {
  it('exports the closed outcome/reason/state vocabularies', () => {
    expect(domain.PACK_VALIDATION_OUTCOMES).toContain('infeasible-for-session-modes');
    expect(domain.DISPOSITION_STATES).toEqual(['RETAIN', 'ANONYMIZE', 'DELETE_PENDING', 'DELETED']);
    expect(domain.RETENTION_ARTIFACT_CLASSES.length).toBe(4);
    expect(domain.POLICY_CONTROL_KINDS.length).toBe(11);
    expect(domain.CROSS_TENANT_AUTHORIZATION_REASONS.length).toBe(7);
    expect(domain.POLICY_AUDIT_EVENT_KINDS.length).toBe(9);
  });

  it('the disposition transition graph is closed (DELETED terminal)', () => {
    expect(domain.DISPOSITION_TRANSITIONS.DELETED).toEqual([]);
    expect(domain.DISPOSITION_TRANSITIONS.RETAIN).toEqual(['ANONYMIZE', 'DELETE_PENDING']);
  });
});

describe('domain purity', () => {
  it('the domain source reads no wall clock (grep-level guarantee)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(new URL('./', import.meta.url))).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    for (const file of files) {
      const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source.includes('Date.now()'), `${file} must not read the wall clock`).toBe(false);
    }
  });
});
