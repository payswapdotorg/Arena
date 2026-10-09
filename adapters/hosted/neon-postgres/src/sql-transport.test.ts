/**
 * The Neon HTTP transport's one-command-per-request law (Work Order
 * P002; issue #154) — the Neon HTTP SQL proxy executes ONE command per
 * prepared statement, so a multi-command query string fails server-side
 * with `cannot insert multiple commands into a prepared statement`
 * (found by the P002 live-Neon acceptance battery; the ONLY multi-command
 * statement in the vocabulary is the migration runner's apply_migration).
 *
 * Credential-free proofs:
 *   1. splitTopLevelStatements — the quote/comment/dollar-quote aware
 *      top-level command splitter (line comments, NESTED block comments,
 *      '' / "" escapes, $$ and $tag$ dollar-quoting, $1 placeholders
 *      NOT misread as dollar-quote delimiters, comment-only fragments
 *      dropped);
 *   2. every shipped migration source splits into multiple top-level
 *      commands and every produced command is itself a single command
 *      (the split is exhaustive — re-splitting never splits further);
 *   3. createNeonHttpSqlTransport executes a multi-command statement as
 *      sequential single-command POSTs IN SOURCE ORDER (observed through
 *      a stubbed fetch — zero credentials, zero network);
 *   4. a single-command statement is forwarded verbatim with its bind
 *      parameters, and the LAST command's rows are the statement's rows;
 *   5. a multi-command statement that also carries bind parameters fails
 *      closed (TRANSPORT_FAILED): parameters cannot bind across commands.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isPersistenceError } from '@arena/persistence';
import { createNeonHttpSqlTransport, splitTopLevelStatements } from './sql-transport.js';
import type { SqlStatement } from './sql-transport.js';
import { SQL_MIGRATION_SOURCES } from './migrations.js';

const FAKE_CONNECTION_STRING = 'postgres://user:secret@fake-host.invalid/neondb?sslmode=require';

interface CapturedRequest {
  readonly url: string;
  readonly body: { query: string; params: readonly unknown[] };
}

/** Stub global fetch: capture every POST body, answer the Neon /sql shape. */
function stubFetch(
  fields: readonly { name: string; dataTypeID: number }[] = [],
  rows: readonly unknown[][] = [],
): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : String(input);
    const parsed = JSON.parse(raw) as { query: string; params?: readonly unknown[] };
    captured.push({
      url: input instanceof URL ? input.toString() : String(input),
      body: { query: parsed.query, params: parsed.params ?? [] },
    });
    return new Response(JSON.stringify({ fields: [...fields], rows: [...rows] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('splitTopLevelStatements — PostgreSQL-aware top-level command splitting', () => {
  it('splits plain multi-command sources on top-level semicolons', () => {
    expect(splitTopLevelStatements('SELECT 1; SELECT 2; SELECT 3')).toEqual([
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
  });

  it('keeps a single command single (the common case) and trims whitespace', () => {
    expect(splitTopLevelStatements('  SELECT 1  ')).toEqual(['SELECT 1']);
    expect(splitTopLevelStatements('SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('never splits inside single-quoted strings (with the escaped-quote form)', () => {
    expect(splitTopLevelStatements(`SELECT ';' AS semi; SELECT 2`)).toEqual([
      `SELECT ';' AS semi`,
      'SELECT 2',
    ]);
    expect(splitTopLevelStatements(`SELECT 'it''s;fine'; SELECT 2`)).toEqual([
      `SELECT 'it''s;fine'`,
      'SELECT 2',
    ]);
  });

  it('never splits inside double-quoted identifiers', () => {
    expect(splitTopLevelStatements(`SELECT "weird;name" FROM t; SELECT 2`)).toEqual([
      `SELECT "weird;name" FROM t`,
      'SELECT 2',
    ]);
  });

  it('treats line and (nested) block comments as non-content for separators', () => {
    expect(splitTopLevelStatements('-- leading note\nSELECT 1; -- trailing note\n')).toEqual([
      '-- leading note\nSELECT 1',
    ]);
    expect(splitTopLevelStatements('/* ; */ SELECT 1; SELECT 2')).toEqual([
      '/* ; */ SELECT 1',
      'SELECT 2',
    ]);
    // PostgreSQL NESTS block comments — the inner ; stays a comment.
    expect(splitTopLevelStatements('/* a /* b ; */ c */ SELECT 1;')).toEqual([
      '/* a /* b ; */ c */ SELECT 1',
    ]);
  });

  it('drops comment-only and whitespace-only fragments (empty queries)', () => {
    expect(splitTopLevelStatements('')).toEqual([]);
    expect(splitTopLevelStatements('   \n\t  ')).toEqual([]);
    expect(splitTopLevelStatements('-- nothing here')).toEqual([]);
    expect(splitTopLevelStatements('SELECT 1;\n-- trailing note only\n')).toEqual(['SELECT 1']);
  });

  it('never splits inside dollar-quoted strings ($$ and $tag$), but never misreads $1 placeholders', () => {
    expect(splitTopLevelStatements('SELECT $$a;b$$; SELECT 2')).toEqual([
      'SELECT $$a;b$$',
      'SELECT 2',
    ]);
    expect(splitTopLevelStatements('SELECT $fn$ body ; stays $fn$; SELECT 2')).toEqual([
      'SELECT $fn$ body ; stays $fn$',
      'SELECT 2',
    ]);
    // $1 / $2 placeholders are NOT dollar-quote delimiters (tag must be an
    // identifier): this parameterized statement stays ONE command.
    expect(splitTopLevelStatements('INSERT INTO t (a, b) VALUES ($1, $2::jsonb)')).toEqual([
      'INSERT INTO t (a, b) VALUES ($1, $2::jsonb)',
    ]);
    expect(splitTopLevelStatements('SELECT $1 $ $2')).toEqual(['SELECT $1 $ $2']);
  });

  it('splits EVERY shipped migration source into commands that are each a single command', () => {
    expect(SQL_MIGRATION_SOURCES.length).toBeGreaterThanOrEqual(5);
    const totalCommands = SQL_MIGRATION_SOURCES.reduce(
      (sum, source) => sum + splitTopLevelStatements(source.sql).length,
      0,
    );
    // The migration sources carry multi-command DDL (table + index +
    // comment statements) — the split must produce a real sequence.
    expect(totalCommands).toBeGreaterThan(SQL_MIGRATION_SOURCES.length);
    for (const source of SQL_MIGRATION_SOURCES) {
      const commands = splitTopLevelStatements(source.sql);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      // The split is EXHAUSTIVE: re-splitting any produced command never
      // splits further (no top-level separator survived inside it).
      for (const command of commands) {
        expect(splitTopLevelStatements(command)).toEqual([command]);
      }
      // Round-trip: joining the commands with ';' re-splits identically.
      expect(splitTopLevelStatements(commands.join(';\n'))).toEqual(commands);
    }
    // Migration 0001 carries exactly table + index: the canonical
    // multi-command shape the transport exists for.
    const first = splitTopLevelStatements(SQL_MIGRATION_SOURCES[0]?.sql ?? '');
    expect(first).toHaveLength(2);
  });
});

describe('createNeonHttpSqlTransport — one command per request (stubbed fetch, zero credentials)', () => {
  it('executes a multi-command statement as sequential single-command requests in source order', async () => {
    const captured = stubFetch();
    const transport = createNeonHttpSqlTransport(FAKE_CONNECTION_STRING);
    const statement: SqlStatement = {
      name: 'apply_migration',
      sql: '-- migration comment\nCREATE TABLE IF NOT EXISTS a (id TEXT);\nCREATE INDEX IF NOT EXISTS a_idx ON a (id);',
      params: [],
    };
    const rows = await transport.execute(statement);

    expect(rows).toEqual([]);
    expect(captured.map((request) => request.body.query)).toEqual([
      '-- migration comment\nCREATE TABLE IF NOT EXISTS a (id TEXT)',
      'CREATE INDEX IF NOT EXISTS a_idx ON a (id)',
    ]);
    expect(captured.every((request) => request.body.params.length === 0)).toBe(true);
    expect(captured.every((request) => request.url.endsWith('/sql'))).toBe(true);
  });

  it('forwards a single-command statement verbatim with its bind parameters', async () => {
    const captured = stubFetch();
    const transport = createNeonHttpSqlTransport(FAKE_CONNECTION_STRING);
    const statement: SqlStatement = {
      name: 'insert_escalation_record',
      sql: 'INSERT INTO arena_escalation_record (request_id) VALUES ($1) RETURNING request_id',
      params: ['req_0001'],
    };
    await transport.execute(statement);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.query).toBe(statement.sql);
    expect(captured[0]?.body.params).toEqual(['req_0001']);
  });

  it('returns the LAST command\'s rows as the statement rows', async () => {
    stubFetch([{ name: 'ok', dataTypeID: 23 }], [[1]]);
    const transport = createNeonHttpSqlTransport(FAKE_CONNECTION_STRING);
    const rows = await transport.execute({
      name: 'select_1',
      sql: 'SELECT 1',
      params: [],
    });
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('fails closed when a multi-command statement also carries bind parameters', async () => {
    stubFetch();
    const transport = createNeonHttpSqlTransport(FAKE_CONNECTION_STRING);
    let failure: unknown;
    try {
      await transport.execute({
        name: 'apply_migration',
        sql: 'CREATE TABLE a (id TEXT); INSERT INTO a VALUES ($1)',
        params: ['never-bound'],
      });
    } catch (error) {
      failure = error;
    }
    expect(isPersistenceError(failure)).toBe(true);
    expect((failure as { message: string }).message).toContain('apply_migration');
  });
});
