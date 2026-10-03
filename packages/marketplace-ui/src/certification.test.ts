import { describe, expect, it } from 'vitest';

import {
  buildCertificationPresence,
  buildPurchaseActionView,
  certificationRecordInput,
  compositionCertificationRecordInput,
} from './index.js';

describe('certification presence (B013 — purchase is never certification)', () => {
  it('builds presence from a read-model certification record (positive)', () => {
    const presence = buildCertificationPresence(certificationRecordInput());
    expect(presence.status).toBe('certified');
    expect(presence.statusLabel).toBe('Certified');
    expect(presence.truthClass).toBe('certification');
    expect(presence.certificationId).toBe('cert-software-engineer-1-1-0');
    expect(presence.subject?.bodyVersion).toBe('body-software-engineer@1.1.0');
    expect(presence.basis).toBe('evaluation pass + independent verification pass');
    expect(presence.scopeNote).toContain('composition tuple');
  });

  it('builds presence from a composition-scoped record (subject refs + suite) (positive)', () => {
    const presence = buildCertificationPresence(compositionCertificationRecordInput());
    expect(presence.status).toBe('certified');
    expect(presence.subject?.suite).toBeDefined();
    expect(presence.subject?.substrate).toBe('substrate-llm-a');
    expect(presence.unknownFields).toHaveLength(0);
  });

  it('renders not certified when no record is supplied (negative)', () => {
    const presence = buildCertificationPresence(undefined);
    expect(presence.status).toBe('not-certified');
    expect(presence.statusLabel).toBe('Not certified');
    expect(presence.truthClass).toBe('unknown');
    expect(presence.subject).toBeUndefined();
    expect(presence.scopeNote).toContain('purchase');
  });

  it('renders unknown for an unreadable record — never a guessed badge (negative)', () => {
    const presence = buildCertificationPresence({ garbage: 'x' });
    expect(presence.status).toBe('unknown');
    expect(presence.statusLabel).toBe('Certification unknown');
    expect(presence.truthClass).toBe('unknown');
    expect(presence.scopeNote).toContain('never as a guessed badge');
  });

  it('never implies certification from a purchase (negative)', () => {
    const purchase = buildPurchaseActionView({
      family: 'artifact',
      mode: 'session',
      state: 'registered',
      offers: [],
      rights: { license: 'CC-BY-4.0', commercialUse: 'allowed', redistribution: 'allowed', customerData: 'none' },
    });
    expect(purchase.doesNotGrant[0]).toContain('Certification');
    expect(purchase.doesNotGrant[0]).toContain('never certifies');
    expect(JSON.stringify(purchase)).not.toContain('certification upon purchase');
  });

  it('is deterministic and frozen (positive)', () => {
    const a = buildCertificationPresence(certificationRecordInput());
    expect(a).toEqual(buildCertificationPresence(certificationRecordInput()));
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.subject)).toBe(true);
  });
});
