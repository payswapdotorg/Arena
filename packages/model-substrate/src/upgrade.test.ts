/**
 * SubstrateUpgrade tests (gate 6, requirement R45): old substrate digest →
 * new substrate digest with the recertification-required flag, and the
 * hard invariant that an upgrade NEVER silently rebinds a Possession (a
 * new Possession version is required) — enforced at type level, at
 * construction and at API level.
 */

import { describe, expect, it } from 'vitest';
import {
  SUBSTRATE_UPGRADE_INPUT_FIELDS,
  createSubstrateUpgrade,
  isSubstrateUpgrade,
} from './upgrade.js';
import type { SubstrateUpgrade } from './upgrade.js';

const DIGEST_OLD = '1'.repeat(64);
const DIGEST_NEW = '2'.repeat(64);

const UPGRADE_INPUT = {
  upgradeId: 'upgrade-reasoner-r7-to-r8',
  fromSubstrateDigest: DIGEST_OLD,
  toSubstrateDigest: DIGEST_NEW,
  recertificationRequired: true as const,
  declaredAt: '2026-01-15T09:30:00.000Z',
};

const ADAPTATION = {
  namespace: 'tenant-a',
  name: 'adapt-reasoner',
  version: '1.0.0',
  digest: '3'.repeat(64),
};

describe('SubstrateUpgrade (positive)', () => {
  it('declares old digest → new digest with recertification required', () => {
    const upgrade = createSubstrateUpgrade(UPGRADE_INPUT);
    expect(upgrade.recordVersion).toBe(1);
    expect(upgrade.upgradeId).toBe('upgrade-reasoner-r7-to-r8');
    expect(upgrade.fromSubstrateDigest).toBe(DIGEST_OLD);
    expect(upgrade.toSubstrateDigest).toBe(DIGEST_NEW);
    expect(upgrade.recertificationRequired).toBe(true);
    expect(upgrade.adaptations).toEqual([]);
    expect(upgrade.declaredAt).toBe('2026-01-15T09:30:00.000Z');
    expect(isSubstrateUpgrade(upgrade)).toBe(true);
    expect(Object.isFrozen(upgrade)).toBe(true);
  });

  it('carries content-addressed adaptation artifacts', () => {
    const upgrade = createSubstrateUpgrade({
      ...{ ...UPGRADE_INPUT },
      adaptations: [ADAPTATION],
    });
    expect(upgrade.adaptations).toEqual([ADAPTATION]);
  });

  it('declaredAt defaults to now', () => {
    const { declaredAt: _omit, ...rest } = UPGRADE_INPUT;
    const upgrade = createSubstrateUpgrade(rest);
    expect(upgrade.declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('SubstrateUpgrade — R45 hard invariant: NEVER silently rebinds a Possession', () => {
  it('TYPE level: the upgrade type has no possession field (compile-time absence)', () => {
    const upgrade: SubstrateUpgrade = createSubstrateUpgrade(UPGRADE_INPUT);
    expect(upgrade.fromSubstrateDigest).toBe(DIGEST_OLD);
    // @ts-expect-error — possessionDigest is not part of SubstrateUpgrade
    const absent: undefined = upgrade.possessionDigest;
    // @ts-expect-error — possession is not part of SubstrateUpgrade
    const absent2: undefined = upgrade.possession;
    // @ts-expect-error — rebind is not part of SubstrateUpgrade
    const absent3: undefined = upgrade.rebind;
    expect(absent).toBeUndefined();
    expect(absent2).toBeUndefined();
    expect(absent3).toBeUndefined();
    expect(Object.keys(upgrade).sort()).toEqual(
      [
        'recordVersion',
        'upgradeId',
        'fromSubstrateDigest',
        'toSubstrateDigest',
        'recertificationRequired',
        'adaptations',
        'declaredAt',
      ].sort(),
    );
  });

  it('CONSTRUCTION level: possession-shaped input fields are rejected', () => {
    for (const field of [
      'possession',
      'possessionDigest',
      'possessionId',
      'targetPossession',
      'rebind',
      'rebinds',
      'rebindPossession',
      'silentlyRebind',
      'updatePossession',
      'replacePossession',
      'mutatePossession',
    ]) {
      expect(() =>
        createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, [field]: 'x' } as never),
      ).toThrow(/never rebinds a Possession/);
    }
  });

  it('API level: the package exports no possession-mutating upgrade function', async () => {
    const modelSubstrate = await import('./index.js');
    for (const forbidden of [
      'rebindPossession',
      'upgradePossession',
      'applyUpgradeToPossession',
      'mutatePossession',
      'updatePossession',
      'rebind',
    ]) {
      expect(Object.keys(modelSubstrate)).not.toContain(forbidden);
    }
  });

  it('structural guard: a possession-shaped extra field disqualifies a value', () => {
    const upgrade = createSubstrateUpgrade(UPGRADE_INPUT);
    expect(
      isSubstrateUpgrade({ ...upgrade, possessionDigest: DIGEST_OLD }),
    ).toBe(false);
    expect(isSubstrateUpgrade({ ...upgrade, rebind: true })).toBe(false);
    expect(isSubstrateUpgrade(upgrade)).toBe(true);
  });
});

describe('SubstrateUpgrade (negative — fails closed)', () => {
  it('rejects recertificationRequired: false — no recertification-free upgrade exists (R45)', () => {
    expect(() =>
      createSubstrateUpgrade({
        ...{ ...UPGRADE_INPUT },
        recertificationRequired: false as never,
      }),
    ).toThrow(/recertificationRequired must be true/);
  });

  it('rejects identical digests (self-upgrade), malformed digests and ids', () => {
    expect(() =>
      createSubstrateUpgrade({
        ...{ ...UPGRADE_INPUT },
        fromSubstrateDigest: DIGEST_NEW,
        toSubstrateDigest: DIGEST_NEW,
      }),
    ).toThrow(/self-upgrade/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, fromSubstrateDigest: 'nope' }),
    ).toThrow(/from-substrate digest/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, toSubstrateDigest: 'nope' }),
    ).toThrow(/to-substrate digest/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, upgradeId: 'BAD_ID' }),
    ).toThrow(/invalid upgrade id/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, upgradeId: 'gpt-upgrade' }),
    ).toThrow(/provider brand name/);
  });

  it('rejects unknown fields (closed shape) and malformed adaptations', () => {
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, note: 'extra' } as never),
    ).toThrow(/unknown substrate upgrade field/);
    expect(() =>
      createSubstrateUpgrade({
        ...{ ...UPGRADE_INPUT },
        adaptations: [{ namespace: 'x', name: 'y', version: '1', digest: 'z' }],
      }),
    ).toThrow(/invalid adaptation artifact/);
    expect(() =>
      createSubstrateUpgrade({
        ...{ ...UPGRADE_INPUT },
        adaptations: [ADAPTATION, ADAPTATION],
      }),
    ).toThrow(/duplicate adaptation artifact/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, declaredAt: '2026-01-15T09:30:00Z' }),
    ).toThrow(/declaration timestamp/);
    expect(() =>
      createSubstrateUpgrade({ ...{ ...UPGRADE_INPUT }, apiKey: 'sk-1' } as never),
    ).toThrow(/credential-shaped field/);
  });

  it('the input field set is exactly the declared closed set', () => {
    expect([...SUBSTRATE_UPGRADE_INPUT_FIELDS].sort()).toEqual(
      [
        'upgradeId',
        'fromSubstrateDigest',
        'toSubstrateDigest',
        'recertificationRequired',
        'adaptations',
        'declaredAt',
      ].sort(),
    );
    expect(isSubstrateUpgrade({ recordVersion: 1 })).toBe(false);
  });
});
