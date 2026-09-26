/**
 * @arena/web — placeholder app (Work Order A001).
 *
 * A plain TypeScript app that consumes @arena/protocol-core. Its purpose is
 * to prove the layer direction apps -> packages (enforced by
 * `pnpm boundary`) and to exercise the protocol primitives end to end:
 * build an envelope, serialize it canonically, digest it, verify it.
 *
 * Run with: pnpm --filter @arena/web start
 */

import {
  envelopeDigest,
  makeEnvelope,
  newCorrelationId,
  newIdempotencyKey,
  parseEnvelope,
  serializeEnvelope,
  verifyEnvelope,
  coreSchemaRef,
} from '@arena/protocol-core';

async function main(): Promise<void> {
  const envelope = makeEnvelope({
    kind: 'command',
    schema: coreSchemaRef('protocol/envelope'),
    correlationId: newCorrelationId(),
    idempotencyKey: newIdempotencyKey(),
    payload: { app: 'arena-web', action: 'selfcheck' },
  });

  const wire = serializeEnvelope(envelope);
  const digest = await envelopeDigest(envelope);
  const verified = await verifyEnvelope(wire, digest);
  const roundTripped = parseEnvelope(wire);

  console.log('[arena-web] envelope id:      ', verified.id);
  console.log('[arena-web] schema:           ', verified.schema);
  console.log('[arena-web] canonical bytes:  ', wire.length);
  console.log('[arena-web] sha256 digest:    ', digest);
  console.log('[arena-web] round-trip equal: ', JSON.stringify(roundTripped) === JSON.stringify(envelope));
}

main().catch((error: unknown) => {
  console.error('[arena-web] FAILED', error);
  process.exitCode = 1;
});
