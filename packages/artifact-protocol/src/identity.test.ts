import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_IDENTITY_PATTERN_SOURCE,
  ARTIFACT_NAME_PATTERN_SOURCE,
  ARTIFACT_NAMESPACE_PATTERN_SOURCE,
  ARTIFACT_VERSION_PATTERN_SOURCE,
  PUBLIC_NAMESPACE,
  compareArtifactVersions,
  formatArtifactIdentity,
  isArtifactIdentity,
  isSameIdentity,
  parseArtifactIdentity,
  toArtifactIdentity,
  toArtifactName,
  toArtifactNamespace,
  toArtifactVersion,
} from './identity.js';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

const VALID = { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' };

describe('ArtifactIdentity (positive)', () => {
  it('constructs and freezes a valid identity', () => {
    const identity = toArtifactIdentity(VALID);
    expect(identity.namespace).toBe('acme');
    expect(identity.name).toBe('reference-dataset');
    expect(identity.version).toBe('1.4.2');
    expect(Object.isFrozen(identity)).toBe(true);
    expect(isArtifactIdentity(identity)).toBe(true);
  });

  it('accepts the reserved public namespace', () => {
    const identity = toArtifactIdentity({ ...VALID, namespace: PUBLIC_NAMESPACE });
    expect(identity.namespace).toBe('public');
  });

  it('accepts prerelease versions (semver-compatible)', () => {
    for (const version of ['0.0.1', '1.0.0-alpha', '1.0.0-alpha.1', '2.13.0-rc.1']) {
      expect(toArtifactVersion(version)).toBe(version);
    }
  });

  it('round-trips the string form', () => {
    const identity = toArtifactIdentity(VALID);
    const formatted = formatArtifactIdentity(identity);
    expect(formatted).toBe('arena:artifact/acme/reference-dataset@1.4.2');
    expect(parseArtifactIdentity(formatted)).toEqual(identity);
  });

  it('compares identities structurally', () => {
    const a = toArtifactIdentity(VALID);
    const b = toArtifactIdentity(VALID);
    const c = toArtifactIdentity({ ...VALID, version: '1.4.3' });
    expect(isSameIdentity(a, b)).toBe(true);
    expect(isSameIdentity(a, c)).toBe(false);
  });

  it('compares versions by semver 2.0.0 precedence', () => {
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
      '2.1.0-rc.1',
      '2.1.0',
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      const lower = order[i];
      const higher = order[i + 1];
      if (lower === undefined || higher === undefined) continue;
      expect(compareArtifactVersions(toArtifactVersion(lower), toArtifactVersion(higher))).toBeLessThan(0);
      expect(compareArtifactVersions(toArtifactVersion(higher), toArtifactVersion(lower))).toBeGreaterThan(0);
    }
    expect(
      compareArtifactVersions(toArtifactVersion('1.4.2'), toArtifactVersion('1.4.2')),
    ).toBe(0);
  });

  it('brands and validates each part individually', () => {
    expect(toArtifactNamespace('acme')).toBe('acme');
    expect(toArtifactName('dataset-a')).toBe('dataset-a');
    expect(toArtifactVersion('1.0.0')).toBe('1.0.0');
  });
});

describe('ArtifactIdentity (negative — validation fails closed)', () => {
  const invalid = (fn: () => unknown) => {
    expect(fn).toThrow(ArtifactError);
    expect(fn).toThrowError(/invalid artifact/);
  };

  it('rejects invalid namespaces', () => {
    for (const namespace of ['', 'Public', 'acme corp', 'a', 'UPPER', 'x'.repeat(64), 'ac_me']) {
      invalid(() => toArtifactNamespace(namespace));
    }
  });

  it('rejects invalid names', () => {
    for (const name of ['', 'Dataset', '-dataset', 'data set', 'x'.repeat(129), 'data/set']) {
      invalid(() => toArtifactName(name));
    }
  });

  it('rejects non-semver and build-metadata versions', () => {
    for (const version of [
      '',
      '1.0',
      '1.0.0.0',
      'v1.0.0',
      '01.0.0',
      '1.0.0+build.1',
      '1.0.0-alpha+build',
      'not-a-version',
    ]) {
      expect(() => toArtifactVersion(version)).toThrow(ArtifactError);
    }
  });

  it('rejects malformed identity string forms', () => {
    for (const bad of [
      '',
      'artifact/acme/dataset@1.0.0',
      'arena:artifact/acme/dataset@1.0',
      'arena:artifact/Acme/dataset@1.0.0',
      'arena:artifact/acme/data set@1.0.0',
      'arena:artifact/acme/dataset@1.0.0+build',
      'arena:artifact/acme/dataset',
    ]) {
      expect(() => parseArtifactIdentity(bad)).toThrow(ArtifactError);
      try {
        parseArtifactIdentity(bad);
      } catch (error) {
        expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.INVALID_IDENTITY);
      }
    }
  });

  it('isArtifactIdentity rejects non-identity shapes', () => {
    expect(isArtifactIdentity(null)).toBe(false);
    expect(isArtifactIdentity('acme/dataset@1.0.0')).toBe(false);
    expect(isArtifactIdentity({ namespace: 'acme' })).toBe(false);
    expect(isArtifactIdentity({ ...VALID, version: '1.0' })).toBe(false);
  });

  it('exposes pattern sources that the contracts mirror (parity anchor)', () => {
    expect(ARTIFACT_NAMESPACE_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{1,62}$');
    expect(ARTIFACT_NAME_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{1,127}$');
    expect(ARTIFACT_VERSION_PATTERN_SOURCE).toBe(
      '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
    );
    expect(ARTIFACT_IDENTITY_PATTERN_SOURCE.startsWith('^arena:artifact/')).toBe(true);
  });
});
