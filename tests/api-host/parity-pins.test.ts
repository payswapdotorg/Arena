/**
 * tests/api-host/parity-pins.test.ts — the P003 mirror pins (Work Order
 * P003; issue #155).
 *
 * The http-host/mcp-host surfaces declare STRUCTURAL MIRRORS of the
 * frozen vocabularies (the packages' own discipline —
 * packages/runtime-host/src/ports.ts: "a typed seam stays consumer-owned,
 * versioned and frozen"). Every mirror's doc comment says "pinned by
 * tests/api-host": this file IS that pin. Value-for-value against the
 * REAL sets, imported from the REAL packages — no invented vocabulary,
 * no drift, no missing codes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DENIAL_ERROR_CODES,
  DEVELOPER_KEY_DENIAL_REASONS,
  DEVELOPER_KEY_ENVIRONMENTS,
  DEVELOPER_KEY_SCOPES,
  DEVELOPER_KEY_SECRET_PATTERN_SOURCE,
  DEVELOPER_PLATFORM_ERROR_CODES,
  categoryForDeveloperPlatformCode,
} from '@arena/developer-platform';
import {
  ESCALATION_ERROR_CODES,
  categoryForEscalationCode,
} from '@arena/escalation';
import {
  LENS_ERROR_CODES,
  LIFECYCLE_ERROR_CODES,
  TRUTH_LENSES,
} from '@arena/runtime-host';
import { PROVIDER_CAPACITY_STATUSES } from '@arena/persistence';
import { EscalationApiService, McpToolServer } from '@arena/escalation-api';
import {
  API_KEY_DENIAL_REASONS,
  API_KEY_ENVIRONMENTS,
  API_KEY_SCOPES,
  HOST_CAPACITY_STATUSES,
  HOST_TRUTH_LENSES,
  DEVELOPER_CODE_HTTP,
  DEVELOPER_CODE_MIRROR,
  DEVELOPER_CODE_CATEGORY_MIRROR,
  DENIAL_CODE_MIRROR,
  ESCALATION_CODE_HTTP,
  RUNTIME_CODE_HTTP,
  RUNTIME_CODE_MIRROR,
  API_KEY_SECRET_PATTERN_SOURCE,
} from '@arena/escalation-api/http-host';
import { listMcpTools, MCP_TOOL_NAMES } from '@arena/escalation-api/mcp-host';
import { MCP_TOOL_NAMES as C001_MCP_TOOL_NAMES } from '@arena/escalation-api';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('the http-host mirrors are pinned value-for-value against the REAL vocabularies', () => {
  it('scope, environment, denial-reason and secret-pattern mirrors match the developer-platform sets', () => {
    expect([...API_KEY_SCOPES]).toEqual([...DEVELOPER_KEY_SCOPES]);
    expect([...API_KEY_ENVIRONMENTS]).toEqual([...DEVELOPER_KEY_ENVIRONMENTS]);
    expect([...API_KEY_DENIAL_REASONS]).toEqual([...DEVELOPER_KEY_DENIAL_REASONS]);
    expect(API_KEY_SECRET_PATTERN_SOURCE).toBe(DEVELOPER_KEY_SECRET_PATTERN_SOURCE);
    // The non-delegation law rides the vocabulary itself: no keys:manage scope.
    expect([...API_KEY_SCOPES]).not.toContain('keys:manage');
  });

  it('the developer code mirror is the FULL closed set, value-for-value, both directions', () => {
    const real = Object.values(DEVELOPER_PLATFORM_ERROR_CODES).sort();
    const mirror = Object.values(DEVELOPER_CODE_MIRROR).sort();
    expect(mirror).toEqual(real);
    // Key-for-key equality too (no aliased keys, no extras).
    expect(Object.keys(DEVELOPER_CODE_MIRROR).sort()).toEqual(
      Object.keys(DEVELOPER_PLATFORM_ERROR_CODES).sort(),
    );
  });

  it('the category mirror matches the real category function for EVERY code', () => {
    for (const code of Object.values(DEVELOPER_PLATFORM_ERROR_CODES)) {
      expect(DEVELOPER_CODE_CATEGORY_MIRROR[code]).toBe(categoryForDeveloperPlatformCode(code));
    }
  });

  it('the denial→code mirror matches the real DENIAL_ERROR_CODES table exactly', () => {
    for (const reason of DEVELOPER_KEY_DENIAL_REASONS) {
      expect(DENIAL_CODE_MIRROR[reason]).toBe(DENIAL_ERROR_CODES[reason]);
    }
    expect(Object.keys(DENIAL_CODE_MIRROR).sort()).toEqual(
      [...DEVELOPER_KEY_DENIAL_REASONS].sort(),
    );
  });

  it('the lens + capacity mirrors match the frozen vocabularies', () => {
    expect([...HOST_TRUTH_LENSES]).toEqual([...TRUTH_LENSES]);
    expect([...HOST_CAPACITY_STATUSES]).toEqual([...PROVIDER_CAPACITY_STATUSES]);
  });

  it('the runtime boundary code mirror covers the frozen lifecycle + lens namespaces and invents nothing', () => {
    const mirror = [...RUNTIME_CODE_MIRROR];
    // Every code the frozen lifecycle/lens namespaces can throw is COVERED.
    for (const code of Object.values(LIFECYCLE_ERROR_CODES)) {
      expect(mirror).toContain(code);
    }
    for (const code of Object.values(LENS_ERROR_CODES)) {
      expect(mirror).toContain(code);
    }
    // No invented vocabulary: every mirrored code exists in the frozen
    // host sources (the service composition root + the frozen package).
    const frozenSources = [
      '../../services/runtime-host/src/host.ts',
      '../../services/runtime-host/src/durable.ts',
      '../../packages/runtime-host/src/lifecycle.ts',
      '../../packages/runtime-host/src/lens.ts',
    ]
      .map((rel) => readFileSync(join(here, rel), 'utf-8'))
      .join('\n');
    for (const code of mirror) {
      expect(frozenSources).toContain(`'${code}'`);
    }
    expect(new Set(mirror).size).toBe(mirror.length);
  });

  it('the escalation rendering table covers the FULL real code set', () => {
    expect(Object.keys(ESCALATION_CODE_HTTP).sort()).toEqual(
      Object.values(ESCALATION_ERROR_CODES).sort(),
    );
    for (const code of Object.values(ESCALATION_ERROR_CODES)) {
      expect(ESCALATION_CODE_HTTP[code]).toBeTypeOf('number');
      expect(categoryForEscalationCode(code)).toBeTypeOf('string');
    }
  });

  it('the documented HTTP renderings keep their classes (auth 401, authorization 403, validation 400, fail-closed capacity 503)', () => {
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_SECRET_INVALID).toBe(401);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_KEY_NOT_FOUND).toBe(401);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_SCOPE_MISSING).toBe(403);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_CROSS_TENANT_ACCESS).toBe(403);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_ENVIRONMENT_MISMATCH).toBe(403);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_INVALID_REQUEST).toBe(400);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED).toBe(503);
    expect(DEVELOPER_CODE_HTTP.DEVELOPER_UNKNOWN_ERROR).toBe(500);
    expect(ESCALATION_CODE_HTTP.ESCALATION_IDENTITY_CONFLICT).toBe(409);
    expect(ESCALATION_CODE_HTTP.ESCALATION_CROSS_TENANT_ACCESS).toBe(403);
    expect(ESCALATION_CODE_HTTP.ESCALATION_UNKNOWN_ERROR).toBe(500);
    expect(RUNTIME_CODE_HTTP.RUNTIME_ESCALATION_NOT_FOUND).toBe(404);
    expect(RUNTIME_CODE_HTTP.RUNTIME_NOT_STARTED).toBe(503);
    expect(RUNTIME_CODE_HTTP.RUNTIME_CROSS_TENANT_ACCESS).toBe(403);
    expect(RUNTIME_CODE_HTTP.RUNTIME_INVALID_TRANSITION).toBe(409);
  });
});

describe('the mcp-host mirrors are pinned value-for-value against the C001 MCP tool layer', () => {
  it('tool names match the C001 MCP_TOOL_NAMES', () => {
    expect([...MCP_TOOL_NAMES]).toEqual([...C001_MCP_TOOL_NAMES]);
  });

  it('the tool catalog matches the C001 McpToolServer.listTools() verbatim', () => {
    // A real C001 server instance (listTools reads no service state —
    // the descriptor catalog is contract metadata).
    const c001 = new McpToolServer(new EscalationApiService({}));
    expect(listMcpTools()).toEqual(c001.listTools());
  });
});
