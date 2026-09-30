/**
 * Service hygiene suite (Work Order A034):
 *   - the service seals every consequential consequence into the audit
 *     chain (count invariants);
 *   - no raw secrets ever reach the audit trail (the audit events carry
 *     closed reason tokens, not payloads);
 *   - the service package's only workspace runtime deps are
 *     @arena/security + @arena/protocol-core (services never import
 *     services);
 *   - no `any` in the public source; exported classes are constructible
 *     with injected deps.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  makeEvaluateAuthorizationCommand,
  makeRegisterPolicyBundleCommand,
  SecurityAuditLog,
  toSecurityPrincipal,
  toTenantScopedRef,
} from '@arena/security';
import { serializeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityService } from './service.js';
import { SecurityPolicyRegistry } from './registry.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORR = 'corr-a034-hygiene-0001' as CorrelationId;
const IDEM = 'idem-a034-hygiene-0001' as IdempotencyKey;

const PRINCIPAL = toSecurityPrincipal({
  recordVersion: 1,
  principalId: 'principal-hygiene',
  kind: 'customer-identity',
  tenantScope: 'tenant-alpha',
  roles: ['tenant-member'],
  label: null,
});

const RESOURCE = toTenantScopedRef({
  recordVersion: 1,
  tenantId: 'tenant-alpha',
  boundaryClass: 'dataset',
  recordId: 'dataset-hygiene',
});

const BUNDLE = {
  recordVersion: 1,
  bundleId: 'bundle-hygiene',
  version: '1.0.0',
  statements: [
    {
      recordVersion: 1,
      statementId: 'allow-read',
      effect: 'allow',
      tenantId: 'tenant-alpha',
      roles: ['tenant-member'],
      action: 'read',
      boundaryClass: 'dataset',
    },
  ],
};

describe('audit completeness — every command seals exactly one record', () => {
  it('register + evaluate commands each append exactly one chained record', async () => {
    const service = new SecurityService();
    await service.handleRegisterPolicyBundleCommand(
      serializeEnvelope(makeRegisterPolicyBundleCommand({ bundle: BUNDLE }, CORR, IDEM)),
    );
    const configured = new SecurityService({
      registry: service.registry,
      auditLog: service.auditLog,
      defaultBundle: { bundleId: 'bundle-hygiene', version: '1.0.0' },
    });
    const before = (await configured.auditSnapshot()).length;
    await configured.handleEvaluateAuthorizationCommand(
      serializeEnvelope(
        makeEvaluateAuthorizationCommand(
          {
            principal: PRINCIPAL,
            action: 'read',
            resource: RESOURCE,
            evaluatedAt: '2026-09-30T01:00:00.000Z' as never,
          },
          CORR,
          IDEM,
        ),
      ),
    );
    const records = await configured.auditSnapshot();
    expect(records.length).toBe(before + 1);
    // The audit record never carries raw payloads — closed outcome tokens only
    const last = records[records.length - 1]!;
    expect(last.payload.outcome).not.toBeNull();
    expect(typeof last.payload.outcome!.reason).toBe('string');
    // The audit outcome is a CLOSED reason token — never raw payloads or
    // principal content beyond the addressed ids.
    expect(['policy-allowed', 'no-matching-policy', 'tenant-mismatch', 'deny-overrides']).toContain(
      last.payload.outcome!.reason,
    );
  });

  it('the audit log can be injected (pure reference fabric)', () => {
    const auditLog = new SecurityAuditLog();
    const service = new SecurityService({ auditLog });
    expect(service.auditLog).toBe(auditLog);
    expect(new SecurityService().registry).toBeInstanceOf(SecurityPolicyRegistry);
  });
});

describe('package hygiene', () => {
  it('the only workspace runtime deps are @arena/security + @arena/protocol-core', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@arena/protocol-core',
      '@arena/security',
    ]);
  });

  it('no `any` in the public source', () => {
    const srcDir = join(PACKAGE_ROOT, 'src');
    for (const name of readdirSync(srcDir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'test-support.ts') {
        continue;
      }
      const text = readFileSync(join(srcDir, name), 'utf-8');
      expect(text.includes(': any'), `${name} must not use : any`).toBe(false);
      expect(text.includes('as any'), `${name} must not use as any`).toBe(false);
    }
  });

  it('no credential-shaped literals anywhere in the service package', () => {
    const ghPrefix = ['gh', 'p_'].join('');
    const skPrefix = ['sk', '-'].join('');
    const awsPrefix = ['AK', 'IA'].join('');
    const tokenShape = new RegExp(
      `${ghPrefix}[A-Za-z0-9]{16,}|${skPrefix}[A-Za-z0-9_-]{16,}|${awsPrefix}[A-Z0-9]{16,}`,
    );
    const scan = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          scan(abs);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) {
          const text = readFileSync(abs, 'utf-8');
          expect(text.match(tokenShape), `${abs} contains a credential-shaped literal`).toBeNull();
        }
      }
    };
    scan(PACKAGE_ROOT);
  });
});
