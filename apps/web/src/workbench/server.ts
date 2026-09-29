/**
 * The workbench HTTP server (Work Order A017): Node's BUILT-IN
 * node:http module serving the rendered Expert Workbench pages — ZERO
 * external runtime dependencies. This replicates the A018 console
 * transport (apps/web/src/console/server.ts) exactly.
 *
 * Architectural note (why the handler is INJECTED — same reason as the
 * console): @arena/web's manifest is frozen (it declares only
 * @arena/protocol-core) and the app-level tsconfig builds every
 * non-test .ts under src/ with rootDir=src — so a compiled-in import of
 * @arena/workbench or the domain packages is not possible from this
 * file. The workbench therefore keeps this transport module
 * app-tree-pure: it owns HTTP concerns only (request-path
 * normalization, status/content-type/allow headers, HEAD suppression,
 * fail-closed 500), while ALL routing and rendering decisions come from
 * the injected `WorkbenchHandler` — the pure `handleWorkbenchRequest`
 * of @arena/workbench, wired in by main.mjs together with the seeded
 * corpus. The handler and corpus are captured at wiring time and every
 * request renders from the same frozen reference state (read-only
 * guarantee).
 */

import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Default port the workbench listens on (override via options or env). */
export const DEFAULT_WORKBENCH_PORT = 8788;

/** Default bind address (loopback — the workbench is an operational surface). */
export const DEFAULT_WORKBENCH_HOST = '127.0.0.1';

/** A workbench request as the transport sees it (method + path only). */
export interface WorkbenchRequestInput {
  readonly method: string;
  readonly path: string;
}

/** A rendered workbench response (the transport contract of the handler). */
export interface WorkbenchResponseOutput {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/**
 * The injected request handler: @arena/workbench's pure
 * `handleWorkbenchRequest` bound to the frozen corpus. Given a
 * normalized request it returns the rendered response — it performs no
 * I/O and never mutates the corpus.
 */
export type WorkbenchHandler = (request: WorkbenchRequestInput) => WorkbenchResponseOutput;

/** Normalize a raw request URL into a routable path (no query, no fragment). */
export function requestPath(rawUrl: string | undefined): string {
  const withoutQuery = (rawUrl ?? '/').split('?')[0] ?? '/';
  const withoutFragment = withoutQuery.split('#')[0] ?? '/';
  return withoutFragment;
}

/** Write a rendered workbench response to the transport. */
function writeResponse(
  response: ServerResponse,
  result: WorkbenchResponseOutput,
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
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Workbench error</title></head><body><h1>Workbench error</h1><p>The workbench failed to render this page: ${safeDetail}</p></body></html>`,
  );
}

/** Create the workbench server over an injected (pure) handler. */
export function createWorkbenchServer(handler: WorkbenchHandler): Server {
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

/** A running workbench server handle. */
export interface RunningWorkbench {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  /** Stop the server (resolves once no connections remain). */
  close(): Promise<void>;
}

/** Start the workbench server and resolve once it is accepting connections. */
export function startWorkbenchServer(
  handler: WorkbenchHandler,
  options: { port?: number; host?: string } = {},
): Promise<RunningWorkbench> {
  const port = options.port ?? DEFAULT_WORKBENCH_PORT;
  const host = options.host ?? DEFAULT_WORKBENCH_HOST;
  const server = createWorkbenchServer(handler);
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
