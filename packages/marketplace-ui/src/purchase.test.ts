import { describe, expect, it } from 'vitest';

import {
  buildPurchaseActionView,
  DEMO_MARKETPLACE_NOTE,
  malformedArtifactListingInput,
  malformedExpertListingInput,
  PURCHASE_NOT_CERTIFICATION_NOTE,
  purchaseActionInput,
} from './index.js';

describe('purchase action view model (B013 — fail closed)', () => {
  it('states what an artifact purchase grants — access under licence terms (positive)', () => {
    const view = buildPurchaseActionView(purchaseActionInput('artifact', 'session'));
    expect(view.family).toBe('artifact');
    expect(view.availability).toBe('offered');
    expect(view.availabilityLabel).toBe('Available');
    expect(view.grants[0]).toContain('licence terms');
    expect(view.grants[0]).toContain('CC-BY-4.0');
    expect(view.grants[1]).toContain('append-only entitlement grant');
    // Artifact records carry no price — rendered as unknown, never fabricated.
    expect(view.price).toBeUndefined();
    expect(view.priceNote).toContain('never fabricated');
  });

  it('states what an expert-service purchase grants, with the recorded price (positive)', () => {
    const view = buildPurchaseActionView(purchaseActionInput('expert-service', 'session'));
    expect(view.family).toBe('expert-service');
    expect(view.availability).toBe('offered');
    expect(view.price?.display).toBe('USD 125.00 per-session');
    expect(view.price?.amountMinor).toBe(12500);
    expect(view.grants[0]).toContain('engagement session');
  });

  it('explicitly separates purchase from certification (negative)', () => {
    const view = buildPurchaseActionView(purchaseActionInput('artifact', 'session'));
    expect(view.doesNotGrant).toHaveLength(4);
    expect(view.doesNotGrant[0]).toContain('Certification — a purchase never certifies');
    expect(view.truthNote).toBe(PURCHASE_NOT_CERTIFICATION_NOTE);
    expect(view.mode).toBe('session');
  });

  it('marks demo mode as not purchasable — no real pricing, no real purchase (positive)', () => {
    const view = buildPurchaseActionView(purchaseActionInput('expert-service', 'demo'));
    expect(view.mode).toBe('demo');
    expect(view.availability).toBe('demo');
    expect(view.availabilityLabel).toBe('Demo — not purchasable');
    expect(view.demoNote).toBe(DEMO_MARKETPLACE_NOTE);
    // The price still renders (it is recorded data) but under the demo label.
    expect(view.price?.display).toBe('USD 125.00 per-session');
  });

  it('fails closed to unavailable without readable offers or a registered state (negative)', () => {
    expect(
      buildPurchaseActionView({ family: 'expert-service', mode: 'session', offers: [] }).availability,
    ).toBe('unavailable');
    expect(
      buildPurchaseActionView({ family: 'artifact', mode: 'session', state: 'retired' }).availability,
    ).toBe('unavailable');
    expect(buildPurchaseActionView(42).availability).toBe('unavailable');
    expect(buildPurchaseActionView(42).unknownFields).toContain('family');
  });

  it('is deterministic and frozen (positive)', () => {
    const a = buildPurchaseActionView(purchaseActionInput('artifact', 'session'));
    expect(a).toEqual(buildPurchaseActionView(purchaseActionInput('artifact', 'session')));
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.doesNotGrant)).toBe(true);
    expect(Object.isFrozen(a.grants)).toBe(true);
  });

  it('survives adversarial listing inputs without throwing (negative)', () => {
    expect(() => buildPurchaseActionView(malformedArtifactListingInput())).not.toThrow();
    expect(() => buildPurchaseActionView(malformedExpertListingInput())).not.toThrow();
  });
});
