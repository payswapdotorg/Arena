/**
 * services/webhook-delivery/src/http-transport.ts — the REAL webhook HTTP
 * transport (Work Order P003; issue #155).
 *
 * Implements adapters/escalation's `WebhookHttpTransport` wire port over
 * Node's built-in fetch (zero external dependencies — Node >= 22):
 *
 *   - 2xx → `{ ok: true, status }`; any other status → `{ ok: false,
 *     status }` (a failed attempt — the adapter's retry policy owns the
 *     next step);
 *   - a bounded per-request timeout (AbortSignal.timeout — default 10s):
 *     a hanging endpoint FAILS the attempt by THROWING (the adapter treats
 *     a thrown transport error as one failed attempt with no HTTP status
 *     — it never crashes a sweep);
 *   - non-absolute / non-http(s) URLs throw synchronously (fail closed
 *     before any network I/O — the endpoint URL is host configuration).
 */

import type { WebhookHttpTransport } from '@arena/escalation-adapters';

/** Default per-attempt delivery timeout (10 seconds). */
export const DEFAULT_WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

/** Options for `createNodeWebhookHttpTransport`. */
export interface NodeWebhookHttpTransportOptions {
  readonly timeoutMs?: number;
}

/** Validate one endpoint URL (fail closed before any network I/O). */
export function validateWebhookEndpointUrl(url: string): { readonly outcome: 'ok' } | { readonly outcome: 'rejected'; readonly reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { outcome: 'rejected', reason: 'not-a-valid-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { outcome: 'rejected', reason: `unsupported-protocol:${parsed.protocol}` };
  }
  return { outcome: 'ok' };
}

/**
 * The real webhook delivery transport: node fetch with a bounded timeout.
 * Timeouts and network failures THROW (one failed attempt — never a
 * crash); HTTP statuses resolve as `{ ok, status }`.
 */
export function createNodeWebhookHttpTransport(
  options: NodeWebhookHttpTransportOptions = {},
): WebhookHttpTransport {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_WEBHOOK_DELIVERY_TIMEOUT_MS;
  return {
    async post(url, headers, body) {
      const verdict = validateWebhookEndpointUrl(url);
      if (verdict.outcome === 'rejected') {
        throw new Error(`webhook endpoint rejected: ${verdict.reason} (${url})`);
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: response.ok, status: response.status };
    },
  };
}
