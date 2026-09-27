/**
 * Identifier tests — node kinds, ids, versions, addresses, keys, semver
 * precedence (Work Order A004). Positive and negative for every validator.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE,
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
  CAPABILITY_NODE_KINDS,
  CAPABILITY_NODE_VERSION_PATTERN_SOURCE,
  capabilityNodeKey,
  capabilityNodeLogicalKey,
  compareCapabilityNodeVersions,
  formatCapabilityNodeAddress,
  formatCapabilityNodeRefString,
  isCapabilityNodeId,
  isCapabilityNodeKind,
  isCapabilityNodeVersion,
  parseCapabilityNodeAddress,
  toCapabilityNodeId,
  toCapabilityNodeVersion,
} from './identifiers.js';
import { CapabilityGraphError } from './errors.js';

describe('node kinds (positive)', () => {
  it('the closed set has exactly the eleven §4 kinds', () => {
    expect([...CAPABILITY_NODE_KINDS].sort()).toEqual([
      'body-version',
      'capability',
      'domain',
      'evaluator',
      'expert-competency',
      'observed-failure',
      'skill',
      'sub-capability',
      'task-family',
      'tool',
      'verifier',
    ]);
    expect(CAPABILITY_NODE_KINDS).toHaveLength(11);
    for (const kind of CAPABILITY_NODE_KINDS) {
      expect(isCapabilityNodeKind(kind)).toBe(true);
    }
  });
});

describe('node kinds (negative)', () => {
  it('unknown kinds are rejected', () => {
    expect(isCapabilityNodeKind('model')).toBe(false);
    expect(isCapabilityNodeKind('agent')).toBe(false);
    expect(isCapabilityNodeKind('')).toBe(false);
    expect(isCapabilityNodeKind(42)).toBe(false);
    expect(isCapabilityNodeKind(null)).toBe(false);
  });
});

describe('node ids (positive)', () => {
  it('accepts lowercase slugs and rejects everything else', () => {
    expect(isCapabilityNodeId('read-diff')).toBe(true);
    expect(isCapabilityNodeId('a')).toBe(true);
    expect(toCapabilityNodeId('code-review')).toBe('code-review');
    expect(() => toCapabilityNodeId('Read-Diff')).toThrow(CapabilityGraphError);
    expect(() => toCapabilityNodeId('read diff')).toThrow(/invalid capability node id/);
    expect(() => toCapabilityNodeId('')).toThrow(/invalid capability node id/);
    expect(() => toCapabilityNodeId('1read')).toThrow(/invalid capability node id/);
    expect(() => toCapabilityNodeId(`x${'a'.repeat(200)}`)).toThrow(/invalid capability node id/);
    expect(isCapabilityNodeId(undefined)).toBe(false);
  });
});

describe('node versions (positive + negative)', () => {
  it('accepts semver with prerelease, rejects build metadata and garbage', () => {
    expect(isCapabilityNodeVersion('1.0.0')).toBe(true);
    expect(isCapabilityNodeVersion('0.2.13')).toBe(true);
    expect(isCapabilityNodeVersion('2.0.0-rc.1')).toBe(true);
    expect(toCapabilityNodeVersion('1.2.3')).toBe('1.2.3');
    expect(isCapabilityNodeVersion('1.0.0+build.5')).toBe(false);
    expect(() => toCapabilityNodeVersion('1.0.0+build.5')).toThrow(
      /build metadata is not allowed/,
    );
    expect(() => toCapabilityNodeVersion('01.0.0')).toThrow(
      /invalid capability node version/,
    );
    expect(isCapabilityNodeVersion('1.0')).toBe(false);
    expect(isCapabilityNodeVersion('v1.0.0')).toBe(false);
    expect(isCapabilityNodeVersion('')).toBe(false);
  });
});

describe('node addresses (positive)', () => {
  it('formats and round-trips an address for every kind', () => {
    for (const kind of CAPABILITY_NODE_KINDS) {
      const address = formatCapabilityNodeAddress({
        kind,
        id: 'fixture',
        version: '1.2.3',
      });
      expect(address).toBe(`arena:capnode/${kind}/fixture@1.2.3`);
      const parsed = parseCapabilityNodeAddress(address);
      expect(parsed.kind).toBe(kind);
      expect(parsed.id).toBe('fixture');
      expect(parsed.version).toBe('1.2.3');
    }
  });

  it('formats full refs with the digest suffix', () => {
    expect(
      formatCapabilityNodeRefString({
        kind: 'skill',
        id: 'read-diff',
        version: '1.0.0',
        digest: 'a'.repeat(64),
      }),
    ).toBe(`arena:capnode/skill/read-diff@1.0.0#${'a'.repeat(64)}`);
  });
});

describe('pattern sources', () => {
  it('id and version pattern sources are anchored and bounded', () => {
    expect(CAPABILITY_NODE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
    expect(CAPABILITY_NODE_VERSION_PATTERN_SOURCE).toContain('-[0-9A-Za-z-]+');
    expect(CAPABILITY_NODE_VERSION_PATTERN_SOURCE.startsWith('^(0|')).toBe(true);
  });
});

describe('node addresses (negative)', () => {
  it('rejects malformed addresses', () => {
    expect(() => parseCapabilityNodeAddress('skill/read-diff@1.0.0')).toThrow(
      CapabilityGraphError,
    );
    expect(() => parseCapabilityNodeAddress('arena:capnode/skill/read-diff@1')).toThrow(
      /invalid capability node address/,
    );
    expect(() => parseCapabilityNodeAddress('arena:capnode/model/x@1.0.0')).toThrow(
      /unknown capability node kind/,
    );
    expect(() => parseCapabilityNodeAddress('')).toThrow(/invalid capability node address/);
    expect(CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE).toContain('arena:capnode');
  });
});

describe('keys', () => {
  it('identity keys are stable and logical keys drop the version', () => {
    expect(capabilityNodeKey({ kind: 'skill', id: 'read-diff', version: '1.0.0' })).toBe(
      'skill/read-diff@1.0.0',
    );
    expect(capabilityNodeLogicalKey({ kind: 'skill', id: 'read-diff' })).toBe(
      'skill/read-diff',
    );
  });
});

describe('semver precedence (positive + negative)', () => {
  it('orders core, prerelease and numeric identifiers per semver 2.0.0', () => {
    expect(compareCapabilityNodeVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareCapabilityNodeVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareCapabilityNodeVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareCapabilityNodeVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareCapabilityNodeVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareCapabilityNodeVersions('1.0.0-2', '1.0.0-10')).toBeLessThan(0);
    expect(compareCapabilityNodeVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
    expect(compareCapabilityNodeVersions('1.0.0-a', '1.0.0-1')).toBeGreaterThan(0);
    expect(compareCapabilityNodeVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    // A negative control: precedence is not equality of strings.
    expect(compareCapabilityNodeVersions('1.0.0', '1.0.0-alpha')).not.toBe(0);
  });
});
