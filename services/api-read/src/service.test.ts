import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES, AuthError } from '@arena/auth';
import { FakeControlPlaneRepository, ManualClock } from '@arena/persistence';
import type { ControlPlaneInsertInput } from '@arena/persistence';
import { READ_MODEL_ERROR_CODES, ReadModelError } from '@arena/read-model';
import {
  READ_MODEL_KINDS,
  decodeContinuation,
  encodeByKindContinuation,
  toCanonicalRead,
} from '@arena/read-model';
import type {
  CanonicalRead,
  CanonicalReadModel,
  KindInventory,
  ReadPage,
  TenantListingPage,
} from '@arena/read-model';
import { ReadApiService } from './service.js';
import type { SessionValidator } from './service.js';
import {
  makeReadApiError,
  makeReadApiResponse,
  parseReadApiEnvelope,
  parseReadApiRequest,
} from './protocol.js';

const TENANT_A = 'northwind';
const TENANT_B = 'contoso';
const READ_AT = 1_000_000;

// ---------------------------------------------------------------------------
// Test fakes (services never import services — spec/service-boundaries.md;
// the B004 AuthService and the @arena/read-model-service implementation are
// contract-tested in their own workspaces; here the boundary is tested
// against the versioned-contract ports).
// ---------------------------------------------------------------------------

/** A fake B004 session validator over in-memory opaque cookie values. */
class FakeSessionValidator implements SessionValidator {
  private readonly sessions = new Map<string, { tenantId: string; revoked: boolean }>();

  issue(tenantId: string): string {
    const cookie = `sealed-${tenantId}-${this.sessions.size + 1}`;
    this.sessions.set(cookie, { tenantId, revoked: false });
    return cookie;
  }

  revoke(cookie: string): void {
    const session = this.sessions.get(cookie);
    if (session !== undefined) session.revoked = true;
  }

  async validateSession(cookieValue: string): Promise<{ tenantId: string }> {
    const session = this.sessions.get(cookieValue);
    if (session === undefined) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, {
        message: 'session validation failed: not-found',
      });
    }
    if (session.revoked) {
      throw new AuthError(AUTH_ERROR_CODES.SESSION_REVOKED, {
        message: 'session validation failed: revoked',
      });
    }
    return { tenantId: session.tenantId };
  }
}

/** A fake canonical read model over the B002 fake control plane. */
class FakeCanonicalReadModel implements CanonicalReadModel {
  private readonly repo: FakeControlPlaneRepository;
  private readonly clock: ManualClock;

  constructor(repo: FakeControlPlaneRepository, clock: ManualClock) {
    this.repo = repo;
    this.clock = clock;
  }

  async readCanonical(tenantId: string, recordId: string): Promise<CanonicalRead> {
    const record = await this.repo.get(recordId);
    if (record === null) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `no control-plane record ${JSON.stringify(recordId)} exists`,
      });
    }
    if (String(record.tenantId) !== String(tenantId)) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `record ${JSON.stringify(recordId)} exists but belongs to another tenant`,
        details: { recordTenant: String(record.tenantId), authenticatedTenant: String(tenantId) },
      });
    }
    return toCanonicalRead(record, this.clock.now());
  }

  async scrollByKind(
    tenantId: string,
    recordKind: (typeof READ_MODEL_KINDS)[number],
    continuation?: string,
    limit?: number,
  ): Promise<ReadPage> {
    const effective = limit ?? 50;
    const offset =
      continuation !== undefined
        ? decodeContinuation(continuation, 'by-kind', recordKind).offset
        : 0;
    const rows = await this.repo.list({ tenantId, kind: recordKind });
    const readAt = this.clock.now();
    const page = rows.slice(offset, offset + effective);
    const hasMore = rows.length > offset + effective;
    return {
      recordVersion: 1,
      kind: 'by-kind',
      recordKind,
      records: page.map((record) => toCanonicalRead(record, readAt)),
      ...(hasMore ? { continuation: encodeByKindContinuation(recordKind, offset + effective) } : {}),
      readAt,
    };
  }

  async listByTenant(
    tenantId: string,
    continuation?: string,
    limit?: number,
  ): Promise<TenantListingPage> {
    const effective = limit ?? 50;
    const offset =
      continuation !== undefined ? decodeContinuation(continuation, 'by-tenant').offset : 0;
    const rows = await this.repo.list({ tenantId });
    const readAt = this.clock.now();
    return {
      recordVersion: 1,
      kind: 'by-tenant',
      records: rows
        .slice(offset, offset + effective)
        .map((record) => toCanonicalRead(record, readAt)),
      readAt,
    };
  }

  async listKinds(tenantId: string): Promise<KindInventory> {
    const kinds: { kind: (typeof READ_MODEL_KINDS)[number]; count: number }[] = [];
    for (const kind of READ_MODEL_KINDS) {
      const count = await this.repo.count({ tenantId, kind });
      if (count > 0) kinds.push({ kind, count });
    }
    return { recordVersion: 1, kinds };
  }
}

async function makeStack(): Promise<{
  api: ReadApiService;
  auth: FakeSessionValidator;
  repo: FakeControlPlaneRepository;
}> {
  const repo = new FakeControlPlaneRepository();
  const clock = new ManualClock(READ_AT);
  const inputs: ControlPlaneInsertInput[] = [
    { recordId: 'cap-1', tenantId: TENANT_A, kind: 'capability-case', version: 2, data: { title: 'Case 1' } },
    { recordId: 'cap-2', tenantId: TENANT_A, kind: 'capability-case', version: 2, data: { title: 'Case 2' } },
    { recordId: 'cap-3', tenantId: TENANT_A, kind: 'capability-case', version: 1, data: { title: 'Case 3' } },
    { recordId: 'cert-1', tenantId: TENANT_A, kind: 'certification', version: 1, data: { level: 'bronze' } },
    { recordId: 'cap-101', tenantId: TENANT_B, kind: 'capability-case', version: 1, data: { title: 'B case' } },
  ];
  for (const input of inputs) {
    await repo.insert(input);
  }
  const auth = new FakeSessionValidator();
  const api = new ReadApiService({
    auth,
    readModel: new FakeCanonicalReadModel(repo, clock),
  });
  return { api, auth, repo };
}

describe('parseReadApiRequest (closed grammar)', () => {
  it('accepts the three request kinds', () => {
    expect(parseReadApiRequest({ kind: 'read-canonical', recordId: 'cap-1' })).toEqual({
      kind: 'read-canonical',
      recordId: 'cap-1',
    });
    expect(parseReadApiRequest({ kind: 'scroll-by-kind', recordKind: 'capability-case', limit: 2 })).toEqual({
      kind: 'scroll-by-kind',
      recordKind: 'capability-case',
      limit: 2,
    });
    expect(parseReadApiRequest({ kind: 'list-kinds' })).toEqual({ kind: 'list-kinds' });
  });

  it('rejects unknown kinds, unknown fields and malformed payloads', () => {
    expect(() => parseReadApiRequest(null)).toThrow();
    expect(() => parseReadApiRequest('list-kinds')).toThrow();
    expect(() => parseReadApiRequest({ kind: 'delete-everything' })).toThrow();
    expect(() => parseReadApiRequest({ kind: 'read-canonical', recordId: '' })).toThrow();
    expect(() => parseReadApiRequest({ kind: 'read-canonical', recordId: 'x', extra: 1 })).toThrow();
    expect(() => parseReadApiRequest({ kind: 'scroll-by-kind', recordKind: 'not-a-kind' })).toThrow();
    expect(() => parseReadApiRequest({ kind: 'scroll-by-kind', recordKind: 'certification', limit: 101 })).toThrow();
  });

  it('the grammar has NO tenant field — tenant fields are typed-rejected', () => {
    let error: unknown;
    try {
      parseReadApiRequest({ kind: 'list-kinds', tenantId: TENANT_A });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('NO tenant field');
  });
});

describe('envelope construction + parsing parity', () => {
  it('success envelopes round-trip', () => {
    const envelope = makeReadApiResponse('list-kinds', { recordVersion: 1, kinds: [] });
    const parsed = parseReadApiEnvelope(envelope);
    expect(parsed.ok).toBe(true);
    expect(parsed).toEqual(envelope);
  });

  it('error envelopes round-trip with category/code coherence', () => {
    const envelope = makeReadApiError(
      READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION,
      'cross-tenant',
      { recordId: 'cap-1' },
    );
    const parsed = parseReadApiEnvelope(envelope);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('READ_MODEL_TENANT_SCOPE_VIOLATION');
      expect(parsed.error.category).toBe('scope');
      expect(parsed.error.details).toEqual({ recordId: 'cap-1' });
    }
  });

  it('parses fail-closed (bad versions, unknown codes, category mismatches)', () => {
    expect(() => parseReadApiEnvelope({ recordVersion: 99, ok: true, kind: 'list-kinds', result: {} })).toThrow();
    expect(() =>
      parseReadApiEnvelope({
        recordVersion: 1,
        ok: false,
        error: { code: 'NOPE', category: 'scope', message: 'x' },
      }),
    ).toThrow();
    expect(() =>
      parseReadApiEnvelope({
        recordVersion: 1,
        ok: false,
        error: { code: 'READ_MODEL_INVALID_QUERY', category: 'wrong', message: 'x' },
      }),
    ).toThrow();
    expect(() => parseReadApiEnvelope({ recordVersion: 1, ok: 'yes' })).toThrow();
  });
});

describe('handleReadRequest — authentication first (fail closed)', () => {
  it('a missing session token is a typed auth error envelope (no anonymous reads)', async () => {
    const { api } = await makeStack();
    const outcome = await api.handleReadRequest(undefined, { kind: 'list-kinds' });
    expect(outcome.session).toBeUndefined();
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(AUTH_ERROR_CODES.INVALID_COOKIE);
      expect(outcome.envelope.error.category).toBe('validation');
    }
    expect(outcome.envelope).toEqual(
      makeReadApiError(
        AUTH_ERROR_CODES.INVALID_COOKIE,
        'a read request requires an authenticated session (the sealed session cookie value); anonymous reads are not representable',
      ),
    );
  });

  it('an unknown session token is a typed AUTH_SESSION_NOT_FOUND envelope', async () => {
    const { api } = await makeStack();
    const outcome = await api.handleReadRequest('unknown-token', { kind: 'list-kinds' });
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(AUTH_ERROR_CODES.SESSION_NOT_FOUND);
    }
  });

  it('a revoked session fails closed with the typed AUTH_SESSION_REVOKED envelope', async () => {
    const { api, auth } = await makeStack();
    const cookie = auth.issue(TENANT_A);
    const live = await api.handleReadRequest(cookie, { kind: 'list-kinds' });
    expect(live.envelope.ok).toBe(true);
    auth.revoke(cookie);
    const outcome = await api.handleReadRequest(cookie, { kind: 'list-kinds' });
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(AUTH_ERROR_CODES.SESSION_REVOKED);
    }
  });

  it('an authenticated session reads its own tenant (happy paths)', async () => {
    const { api, auth } = await makeStack();
    const cookie = auth.issue(TENANT_A);

    const byId = await api.handleReadRequest(cookie, {
      kind: 'read-canonical',
      recordId: 'cap-1',
    });
    expect(byId.envelope.ok).toBe(true);
    if (byId.envelope.ok) {
      expect(byId.envelope.kind).toBe('read-canonical');
      const read = byId.envelope.result as {
        recordId: string;
        tenantId: string;
        sourceVersion: number;
        sourceRevision: number;
        provenance: { createdAt: number; updatedAt: number };
        readAt: number;
      };
      expect(read.recordId).toBe('cap-1');
      expect(read.tenantId).toBe(TENANT_A);
      expect(read.sourceVersion).toBe(2);
      expect(read.sourceRevision).toBe(1);
      expect(read.provenance.createdAt).toBe(read.provenance.updatedAt);
      expect(read.readAt).toBe(READ_AT);
    }

    const scroll = await api.handleReadRequest(cookie, {
      kind: 'scroll-by-kind',
      recordKind: 'capability-case',
      limit: 2,
    });
    if (scroll.envelope.ok) {
      const page = scroll.envelope.result as unknown as {
        records: { recordId: string }[];
        continuation?: string;
      };
      expect(page.records.map((r) => r.recordId)).toEqual(['cap-1', 'cap-2']);
      expect(page.continuation).toBeDefined();
    } else {
      expect.unreachable('scroll should succeed');
    }

    const kinds = await api.handleReadRequest(cookie, { kind: 'list-kinds' });
    if (kinds.envelope.ok) {
      const inventory = kinds.envelope.result as unknown as {
        kinds: { kind: string; count: number }[];
      };
      expect(inventory.kinds).toEqual([
        { kind: 'capability-case', count: 3 },
        { kind: 'certification', count: 1 },
      ]);
    } else {
      expect.unreachable('list-kinds should succeed');
    }
  });

  it('cross-tenant reads are TENANT_SCOPE_VIOLATION, not RECORD_NOT_FOUND', async () => {
    const { api, auth } = await makeStack();
    const cookieB = auth.issue(TENANT_B);
    const outcome = await api.handleReadRequest(cookieB, {
      kind: 'read-canonical',
      recordId: 'cap-1', // owned by tenant-a
    });
    expect(outcome.session?.tenantId).toBe(TENANT_B);
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION);
      expect(outcome.envelope.error.category).toBe('scope');
    }
  });

  it('same-tenant absent records are RECORD_NOT_FOUND', async () => {
    const { api, auth } = await makeStack();
    const cookie = auth.issue(TENANT_A);
    const outcome = await api.handleReadRequest(cookie, {
      kind: 'read-canonical',
      recordId: 'does-not-exist',
    });
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND);
    }
  });

  it('tenant NEVER comes from the payload: tenant fields are rejected', async () => {
    const { api, auth } = await makeStack();
    const cookieB = auth.issue(TENANT_B);
    // A tenant-B session attempting to pass tenantId: tenant-a — the
    // payload field is structurally rejected; the read stays scoped to B.
    const outcome = await api.handleReadRequest(cookieB, {
      kind: 'read-canonical',
      recordId: 'cap-1',
      tenantId: TENANT_A,
    });
    expect(outcome.envelope.ok).toBe(false);
    if (!outcome.envelope.ok) {
      expect(outcome.envelope.error.code).toBe(READ_MODEL_ERROR_CODES.INVALID_QUERY);
      expect(outcome.envelope.error.message).toContain('NO tenant field');
    }
  });

  it('malformed requests are typed INVALID_QUERY envelopes', async () => {
    const { api, auth } = await makeStack();
    const cookie = auth.issue(TENANT_A);
    for (const raw of [null, 'list-kinds', { kind: 'nope' }, { kind: 'scroll-by-kind', recordKind: 'x' }]) {
      const outcome = await api.handleReadRequest(cookie, raw);
      expect(outcome.envelope.ok).toBe(false);
      if (!outcome.envelope.ok) {
        expect(outcome.envelope.error.code).toBe(READ_MODEL_ERROR_CODES.INVALID_QUERY);
      }
    }
  });

  it('requires injected auth + read-model ports', async () => {
    const module = await import('./service.js');
    expect(() => new module.ReadApiService({ auth: null as never, readModel: null as never })).toThrow();
  });
});
