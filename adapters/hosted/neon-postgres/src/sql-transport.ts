/**
 * SQL transport seam for the Neon PostgreSQL adapter (Work Order B002).
 *
 * The adapter's ONLY infrastructure touchpoint is `SqlTransport.execute`:
 * named, parameterized statements. The default transport maps statements
 * onto the Neon serverless HTTP driver; tests (and alternative runtimes)
 * inject a transport implementing the same semantics — this is how the
 * FULL persistence contract suite runs against this adapter without live
 * credentials (FT2.0 "Local parity" / "Tests never require live provider
 * credentials").
 *
 * Statement names are stable identifiers (the prepared-statement idiom):
 * they let a test transport dispatch on semantics without parsing SQL,
 * and let the live transport reuse server-side prepared statements later.
 */

import { neon } from '@neondatabase/serverless';
import { PERSISTENCE_ERROR_CODES, PersistenceError } from '@arena/persistence';

/** One named, parameterized statement ($1..$n placeholders). */
export interface SqlStatement {
  /** Stable statement id (see SQL_STATEMENT_NAMES). */
  readonly name: string;
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** A result row: column name -> value. */
export interface SqlRow {
  readonly [column: string]: unknown;
}

/** The infrastructure seam this adapter requires. */
export interface SqlTransport {
  execute(statement: SqlStatement): Promise<readonly SqlRow[]>;
}

/** The closed statement-name vocabulary issued by this adapter. */
export const SQL_STATEMENT_NAMES = Object.freeze([
  'insert_control_record',
  'select_control_record',
  'select_control_records',
  'select_all_control_records',
  'count_control_records',
  'update_control_record',
  'delete_control_record',
  'ensure_migration_ledger',
  'list_applied_migrations',
  'record_applied_migration',
  'apply_migration',
  'select_1',
  // P002 durable host-runtime statements (see ./runtime-statements.ts).
  'insert_escalation_record',
  'select_escalation_record',
  'select_escalation_by_submission',
  'select_escalations_by_correlation',
  'select_all_escalations',
  'update_escalation_record',
  'append_escalation_event',
  'select_escalation_events',
  'insert_webhook_delivery',
  'select_pending_webhook_deliveries',
  'select_all_webhook_deliveries',
  'mark_webhook_delivery_delivered',
  'record_idempotency_outcome',
  'select_idempotency_outcome',
  'insert_job_record',
  'select_job_record',
  'select_job_by_submission',
  'select_jobs_by_correlation',
  'select_all_jobs',
  'update_job_record',
  'stamp_job_lease',
  'clear_expired_job_leases',
  'insert_dead_letter',
  'select_dead_letters',
  'insert_job_event',
  'select_job_events',
  'insert_audit_record',
  'select_last_audit_record',
  'select_all_audit_records',
  'upsert_projection_state',
  'select_projection_state',
] as const);

export type SqlStatementName = (typeof SQL_STATEMENT_NAMES)[number];

/**
 * Wrap transport failures in the typed TRANSPORT_FAILED error. Transport
 * error messages from the driver can carry endpoint detail — they are
 * attached as `cause` (never surfaced in the message) and the typed
 * message stays provider-detail-free.
 */
export async function executeStatement(
  transport: SqlTransport,
  statement: SqlStatement,
): Promise<readonly SqlRow[]> {
  try {
    return await transport.execute(statement);
  } catch (cause) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
      message: `statement ${statement.name} failed on the hosted control-plane transport`,
      details: { statement: statement.name },
      cause,
    });
  }
}

/**
 * The default transport over the Neon serverless HTTP driver (Vercel
 * compatible: plain fetch, no sockets). The connection string is used
 * ONLY to construct the driver client and is never logged.
 *
 * One-command-per-request law: the Neon HTTP SQL proxy executes ONE
 * command per prepared statement — a multi-command query string fails
 * with `cannot insert multiple commands into a prepared statement`
 * (proven against live Neon by the P002 live-acceptance battery). The
 * ONLY multi-command statement in the vocabulary is `apply_migration`
 * (each migration source carries table + index DDL and comments), so
 * this transport splits a multi-command statement into its top-level
 * commands (quote/comment/dollar-quote aware — see
 * splitTopLevelStatements) and executes them IN SOURCE ORDER. All other
 * statements are executed verbatim as single commands. A multi-command
 * statement that also carries bind parameters fails closed: parameters
 * cannot bind across multiple commands (protocol violation).
 *
 * Execution is sequential WITHOUT a wrapping transaction: the HTTP
 * driver has no cross-request session (each call lands on the proxy
 * pool), so BEGIN/COMMIT in separate calls cannot wrap the batch. The
 * migration runner's DDL is idempotent by contract (CREATE ... IF NOT
 * EXISTS guards; the ledger records the version only AFTER the source
 * applied fully), so a mid-sequence failure re-runs cleanly — the same
 * recovery posture the ledger's from-version logic already implements.
 */
export function createNeonHttpSqlTransport(connectionString: string): SqlTransport {
  const sql = neon(connectionString);
  return {
    async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
      const commands = splitTopLevelStatements(statement.sql);
      if (commands.length > 1 && statement.params.length > 0) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
          message:
            `statement ${statement.name} carries ${String(statement.params.length)} bind parameters across ${String(commands.length)} commands — parameters cannot bind across multiple commands (fail closed)`,
        });
      }
      let rows: readonly SqlRow[] = [];
      for (const command of commands) {
        // The last command's rows are the statement's rows: multi-command
        // statements in this vocabulary are DDL (no rows); single-command
        // statements (every SELECT/DML) return theirs verbatim.
        rows = (await sql(command, [...statement.params])) as readonly SqlRow[];
      }
      return rows;
    },
  };
}

/**
 * Split a PostgreSQL command string into its top-level commands.
 *
 * Aware of everything that can contain a `;` or otherwise break a naive
 * split: single-quoted strings ('' escape), double-quoted identifiers
 * ("" escape), line comments (--), NESTED block comments (/* *\/), and
 * dollar-quoted strings ($tag$ ... $tag$, including the empty $$ form).
 * Comment-only / whitespace-only fragments are dropped (PostgreSQL's
 * simple-query protocol treats them as empty queries; the HTTP driver
 * would reject them as empty commands).
 */
export function splitTopLevelStatements(source: string): readonly string[] {
  const commands: string[] = [];
  const fragment: string[] = [];
  let index = 0;
  const length = source.length;

  while (index < length) {
    const char = source.charAt(index);
    const next = index + 1 < length ? source.charAt(index + 1) : '';

    if (char === "'") {
      // Single-quoted string literal ('' escapes a quote).
      const start = index;
      index += 1;
      while (index < length) {
        if (source[index] === "'") {
          if (source.charAt(index + 1) === "'") {
            index += 2; // escaped quote — stays inside the literal
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      fragment.push(source.slice(start, index));
      continue;
    }

    if (char === '"') {
      // Double-quoted identifier ("" escapes a quote).
      const start = index;
      index += 1;
      while (index < length) {
        if (source[index] === '"') {
          if (source.charAt(index + 1) === '"') {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      fragment.push(source.slice(start, index));
      continue;
    }

    if (char === '-' && next === '-') {
      // Line comment: consumed to the newline (the newline itself stays
      // — it can be statement whitespace).
      const start = index;
      while (index < length && source[index] !== '\n') {
        index += 1;
      }
      fragment.push(source.slice(start, index));
      continue;
    }

    if (char === '/' && next === '*') {
      // Block comment — PostgreSQL NESTS block comments.
      const start = index;
      let depth = 1;
      index += 2;
      while (index < length && depth > 0) {
        if (source[index] === '/' && source[index + 1] === '*') {
          depth += 1;
          index += 2;
          continue;
        }
        if (source[index] === '*' && source[index + 1] === '/') {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      fragment.push(source.slice(start, index));
      continue;
    }

    if (char === '$') {
      // Dollar-quoted string: $tag$ ... $tag$ (tag = empty or an
      // identifier); anything else ($1 placeholders, ::numeric casts)
      // is ordinary text.
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index));
      if (match !== null) {
        const delimiter = match[0];
        const start = index;
        index += delimiter.length;
        const closing = source.indexOf(delimiter, index);
        if (closing === -1) {
          index = length; // unterminated — the server will reject it
        } else {
          index = closing + delimiter.length;
        }
        fragment.push(source.slice(start, index));
        continue;
      }
    }

    if (char === ';') {
      // Top-level statement separator.
      index += 1;
      const command = fragment.join('').trim();
      fragment.length = 0;
      if (command.length > 0 && hasNonCommentContent(command)) {
        commands.push(command);
      }
      continue;
    }

    fragment.push(char);
    index += 1;
  }

  const tail = fragment.join('').trim();
  if (tail.length > 0 && hasNonCommentContent(tail)) {
    commands.push(tail);
  }
  return commands;
}

/** True when a trimmed fragment carries anything but whitespace/comments. */
function hasNonCommentContent(command: string): boolean {
  let index = 0;
  while (index < command.length) {
    const char = command.charAt(index);
    if (char === '-' && command.charAt(index + 1) === '-') {
      while (index < command.length && command[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && command.charAt(index + 1) === '*') {
      let depth = 1;
      index += 2;
      while (index < command.length && depth > 0) {
        if (command[index] === '/' && command.charAt(index + 1) === '*') {
          depth += 1;
          index += 2;
          continue;
        }
        if (command[index] === '*' && command.charAt(index + 1) === '/') {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      continue;
    }
    if (/\s/.test(char) === false) {
      return true;
    }
    index += 1;
  }
  return false;
}
