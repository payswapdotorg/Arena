/**
 * The console HTTP server (Work Order A018, gate 5): Node's BUILT-IN
 * node:http module serving the rendered control-plane pages — ZERO
 * external runtime dependencies.
 *
 * Architectural note (why the handler is INJECTED): @arena/web's manifest
 * is frozen (it declares only @arena/protocol-core) and the app-level
 * tsconfig builds every non-test .ts under src/ with rootDir=src — so a
 * compiled-in import of @arena/control-ui or the domain packages is not
 * possible from this file. The console therefore keeps this transport
 * module app-tree-pure: it owns HTTP concerns only (request-path
 * normalization, status/content-type/allow headers, HEAD suppression,
 * fail-closed 500), while ALL routing and rendering decisions come from
 * the injected `ConsoleHandler` — the pure `handleConsoleRequest` of
 * @arena/control-ui, wired in by main.mjs together with the seeded
 * corpus. The handler and corpus are captured at wiring time and every
 * request renders from the same frozen reference state (read-only
 * guarantee, gate 7).
 */

import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Default port the console listens on (override via options or env). */
export const DEFAULT_CONSOLE_PORT = 8787;

/** Default bind address (loopback — the console is an inspection surface). */
export const DEFAULT_CONSOLE_HOST = '127.0.0.1';

/** A console request as the transport sees it (method + path only). */
export interface ConsoleRequestInput {
  readonly method: string;
  readonly path: string;
}

/** A rendered console response (the transport contract of the handler). */
export interface ConsoleResponseOutput {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/**
 * The injected request handler: @arena/control-ui's pure
 * `handleConsoleRequest` bound to the frozen corpus. Given a normalized
 * request it returns the rendered response — it performs no I/O and never
 * mutates the corpus.
 */
export type ConsoleHandler = (request: ConsoleRequestInput) => ConsoleResponseOutput;

/** Normalize a raw request URL into a routable path (no query, no fragment). */
export function requestPath(rawUrl: string | undefined): string {
  const withoutQuery = (rawUrl ?? '/').split('?')[0] ?? '/';
  const withoutFragment = withoutQuery.split('#')[0] ?? '/';
  return withoutFragment;
}

/** Write a rendered console response to the transport. */
function writeResponse(
  response: ServerResponse,
  result: ConsoleResponseOutput,
  headOnly: boolean,
): void {
  const body = Buffer.from(result.html, 'utf-8');
  response.statusCode = result.status;
  response.setHeader('Content-Type', result.contentType);
  response.setHeader('Content-Length', String(body.length));
  if (result.allow !== undefined) {
    response.setHeader('Allow', result.allow);
  }
  response.end(headOnly ? undefined : body);
}

/** The transport's fail-closed 500 page (the handler is total by construction). */
function writeInternalError(response: ServerResponse, detail: string): void {
  response.statusCode = 500;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const safeDetail = detail.replace(/[<&>]/g, (ch) =>
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;',
  );
  response.end(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Console error</title></head><body><h1>Console error</h1><p>The console failed to render this page: ${safeDetail}</p></body></html>`,
  );
}

/** Create the console server over an injected (pure) handler. */
export function createConsoleServer(handler: ConsoleHandler): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = requestPath(request.url);
    try {
      const result = handler({ method: request.method ?? 'GET', path });
      writeResponse(response, result, request.method === 'HEAD');
    } catch (error: unknown) {
      // Fail closed: the pure handler should never throw; the transport
      // still must not crash the process.
      writeInternalError(
        response,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  });
}

/** A running console server handle. */
export interface RunningConsole {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  /** Stop the server (resolves once no connections remain). */
  close(): Promise<void>;
}

/** Start the console server and resolve once it is accepting connections. */
export function startConsoleServer(
  handler: ConsoleHandler,
  options: { port?: number; host?: string } = {},
): Promise<RunningConsole> {
  const port = options.port ?? DEFAULT_CONSOLE_PORT;
  const host = options.host ?? DEFAULT_CONSOLE_HOST;
  const server = createConsoleServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      // With port 0 the kernel assigns the actual port; surface THAT.
      const actualPort =
        typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://${host}:${actualPort}/`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error !== undefined) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}
