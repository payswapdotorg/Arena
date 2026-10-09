/**
 * P004 live-provider environment gates (tests/hosted-provider-e2e).
 *
 * The live suites never REQUIRE credentials (the house pattern: they
 * self-skip with an explicit reason when the environment is absent — CI
 * has no provider credentials by design). Two gates exist:
 *
 *   R2       — a usable base configuration (the adapter's own env reader,
 *              `readR2ConfigFromEnv`) PLUS an explicit dedicated evidence
 *              bucket in `ARENA_HOSTED_E2E_R2_BUCKET`. The lifecycle
 *              suite WRITES and DELETES objects; because blob keys are
 *              content-addressed (the key IS the sha256 digest), a
 *              key-prefix isolation is not representable — the only safe
 *              isolation is a dedicated bucket. Without the dedicated
 *              bucket name the live suite refuses to run (it must never
 *              mutate an undedicated/production bucket's objects).
 *
 *   Upstash  — a usable REST configuration (`readUpstashConfigFromEnv`).
 *              The live suite isolates itself with a run-unique
 *              keyNamespacePrefix (the adapter's hermetic-live-run
 *              contract), so the shared free-tier Redis never carries
 *              state between runs.
 */

import {
  readR2ConfigFromEnv,
  type R2AdapterConfig,
  type R2EnvVarName,
} from '@arena/hosted-r2-object-store';
import { readUpstashConfigFromEnv, type UpstashAdapterConfig } from '@arena/hosted-upstash-redis';

/** The env-var name carrying the dedicated R2 evidence bucket (P004 gate). */
export const R2_EVIDENCE_BUCKET_ENV_VAR = 'ARENA_HOSTED_E2E_R2_BUCKET';

export interface R2LiveEnvironment {
  /** The adapter configuration pointing at the DEDICATED evidence bucket. */
  readonly config: R2AdapterConfig;
  readonly evidenceBucket: string;
}

export interface UpstashLiveEnvironment {
  readonly config: UpstashAdapterConfig;
  /** Run-unique namespace prefix (hermetic live runs; see adapter options). */
  readonly keyNamespacePrefix: string;
}

function firstMissingR2Names(): readonly R2EnvVarName[] {
  const env = process.env;
  const missing: R2EnvVarName[] = [];
  for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
    if (env[name] === undefined || env[name]!.trim() === '') missing.push(name);
  }
  if (
    (env['R2_S3_ENDPOINT'] === undefined || env['R2_S3_ENDPOINT']!.trim() === '') &&
    (env['R2_ACCOUNT_ID'] === undefined || env['R2_ACCOUNT_ID']!.trim() === '')
  ) {
    missing.push('R2_S3_ENDPOINT', 'R2_ACCOUNT_ID');
  }
  return missing;
}

/** Resolve the R2 live environment, or the explicit skip reason. */
export function resolveR2Live(): { live: R2LiveEnvironment | null; skipReason: string | null } {
  const base = readR2ConfigFromEnv();
  if (base === null) {
    return {
      live: null,
      skipReason: `R2 adapter configuration incomplete (missing env names: ${firstMissingR2Names().join(', ')}) — the hosted R2 adapter resolves to its DISABLED fail-closed posture without these`,
    };
  }
  const bucket = process.env[R2_EVIDENCE_BUCKET_ENV_VAR];
  if (bucket === undefined || bucket.trim() === '') {
    return {
      live: null,
      skipReason: `${R2_EVIDENCE_BUCKET_ENV_VAR} is not set — the live lifecycle suite refuses to write/delete objects in an undedicated bucket (content-addressed keys admit no prefix isolation; a dedicated evidence bucket is the only safe isolation)`,
    };
  }
  const evidenceBucket = bucket.trim();
  return {
    live: {
      config: { ...base, bucket: evidenceBucket },
      evidenceBucket,
    },
    skipReason: null,
  };
}

/** Resolve the Upstash live environment, or the explicit skip reason. */
export function resolveUpstashLive(): {
  live: UpstashLiveEnvironment | null;
  skipReason: string | null;
} {
  const config = readUpstashConfigFromEnv();
  if (config === null) {
    return {
      live: null,
      skipReason:
        'Upstash REST configuration incomplete (missing env names: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN) — the hosted coordination adapter resolves to its DISABLED fail-closed posture without these',
    };
  }
  return {
    live: {
      config,
      keyNamespacePrefix: runUniquePrefix(),
    },
    skipReason: null,
  };
}

/** A run-unique, adapter-valid key namespace prefix (`p004-<hex>:`). */
function runUniquePrefix(): string {
  const random = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  return `p004-${random}:`;
}

/**
 * An env source for `new R2BlobStore({ env })` pointing at the dedicated
 * evidence bucket (base credentials from the real environment; the bucket
 * overridden to the evidence bucket).
 */
export function r2AdapterEnv(evidenceBucket: string): Record<string, string | undefined> {
  return {
    R2_ACCESS_KEY_ID: process.env['R2_ACCESS_KEY_ID'],
    R2_SECRET_ACCESS_KEY: process.env['R2_SECRET_ACCESS_KEY'],
    R2_S3_ENDPOINT: process.env['R2_S3_ENDPOINT'],
    R2_ACCOUNT_ID: process.env['R2_ACCOUNT_ID'],
    R2_BUCKET: evidenceBucket,
  };
}
