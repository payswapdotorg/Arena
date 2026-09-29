/**
 * ForgeService — the in-process reference FORGE FABRIC (Work Order
 * A021 item 7; requirement R18): submit(manifest, policy) →
 * validate → compose → emit ForgeRecord + the BodyVersion proposal.
 *
 * Pure TypeScript, ZERO external runtime dependencies (only
 * @arena/protocol-core + @arena/body-forge — the domain package whose
 * pure compose core and REAL A003 projection anchor the fabric to the
 * protocol — plus @arena/learning and @arena/skill-extraction for the
 * compose-from-learning demo path, see learning-demo.ts). In-process
 * only: no network, no database (the A021 reference slice, mirroring
 * the A019/A020 reference fabrics).
 *
 * `submit(manifest, policy, options)` is PURE ORCHESTRATION:
 *   1. enforce the input contracts — the manifest and policy must be
 *      structurally valid AND tamper-verified (digest recomputation
 *      fails closed);
 *   2. compose through the package's deterministic core (forge()),
 *      under the caller-supplied recipe (no hidden clock reads);
 *   3. append the ForgeRecord to the digest-addressed, append-only
 *      registry and store the proposal.
 *
 * Idempotency (architecture-lock rule 17): the same forge key + the
 * same (manifest, policy) tuple replays as a no-op returning the
 * STORED result — byte-identical, never duplicated; the same key + a
 * different tuple is an IDEMPOTENCY_CONFLICT.
 *
 * Version consistency (mirroring the A003 registry semantics — lock
 * rule 5): the forge never mutates BodyVersions, and its record
 * registry additionally refuses to record TWO DIFFERENT digests for
 * the same (body identity, version number): a version number
 * addresses immutable content (the A003 body-version registry append
 * remains the single authority; this fabric-level guard keeps the
 * forge's own history consistent with it). Re-forging identical content under
 * a new key is recorded as a new execution with the same emitted
 * digest.
 *
 * The ledger is append-only and content-addressed: no update/delete
 * APIs, every record stays addressable by digest forever, queries are
 * pure projections (by forge key, by body, by manifest).
 */

import {
  BODY_FORGE_ERROR_CODES,
  BodyForgeError,
  forge,
  isBodyManifest,
  isForgePolicy,
  verifyBodyManifest,
  verifyForgePolicy,
  verifyForgeRecord,
} from '@arena/body-forge';
import type {
  BodyManifest,
  ForgePolicy,
  ForgeRecipe,
  ForgeRecord,
  ForgeResult,
} from '@arena/body-forge';
import { isIdempotencyKey } from '@arena/protocol-core';

/** Options for one forge submission. */
export interface SubmitOptions {
  /** REQUIRED idempotency key — the forge execution address (lock rule 17). */
  readonly forgeKey: string;
  /** The deterministic composition context (principal, timestamp, correlation id). */
  readonly recipe: ForgeRecipe;
  /** Free-form provenance notes recorded onto the ForgeRecord. */
  readonly notes?: string | null;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

function commandCanonicalOf(manifestDigest: string, policyDigest: string): string {
  return JSON.stringify([manifestDigest, policyDigest]);
}

/** The in-process reference forge fabric. */
export class ForgeService {
  /** ForgeRecords by digest — the append-only, content-addressed registry. */
  private readonly recordsByDigest = new Map<string, ForgeRecord>();
  /** forge key → the execution it authorized (idempotent replay). */
  private readonly forgeKeys = new Map<string, IdempotencyBinding>();
  /** record digests in append order. */
  private readonly ledger: ForgeRecord[] = [];
  /** body key (`tenant/name@version`) → the recorded version digest (immutability mirror). */
  private readonly versionDigests = new Map<string, string>();
  /** The stored results by forge key (replay returns the stored proposal too). */
  private readonly resultsByKey = new Map<string, ForgeResult>();

  /**
   * Submit one forge execution: validate → compose → record.
   * Deterministic replay: the same key + tuple returns the stored
   * result byte-identically; the same key + a different tuple is an
   * IDEMPOTENCY_CONFLICT.
   */
  async submit(manifest: BodyManifest, policy: ForgePolicy, options: SubmitOptions): Promise<ForgeResult> {
    if (!isIdempotencyKey(options.forgeKey)) {
      throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECORD, {
        message: `submit requires a valid forge key (idempotency key): ${JSON.stringify(options.forgeKey)}`,
      });
    }
    if (!isBodyManifest(manifest)) {
      throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_MANIFEST, {
        message: 'submit requires a structurally valid body manifest',
      });
    }
    await verifyBodyManifest(manifest); // fail closed on tampering
    if (!isForgePolicy(policy)) {
      throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_POLICY, {
        message: 'submit requires a structurally valid forge policy',
      });
    }
    await verifyForgePolicy(policy); // fail closed on tampering

    const command = commandCanonicalOf(manifest.digest as string, policy.digest as string);
    const binding = this.forgeKeys.get(options.forgeKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new BodyForgeError(BODY_FORGE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `forge key ${JSON.stringify(options.forgeKey)} is already bound to a different command (same key + different manifest/policy is a conflict, not a rerun)`,
          details: {
            forgeKey: options.forgeKey,
            bound: binding.commandCanonical,
            attempted: command,
          },
        });
      }
      const stored = this.resultsByKey.get(options.forgeKey);
      if (stored !== undefined) return stored;
    }

    const result = await forge(manifest, policy, options.recipe, {
      forgeKey: options.forgeKey,
      ...(options.notes === undefined ? {} : { notes: options.notes }),
    });
    await verifyForgeRecord(result.record); // belt and braces

    // Version-consistency mirror of the A003 registry semantics (lock
    // rule 5): a version number addresses immutable content. The
    // conflict is thrown BEFORE anything is recorded.
    const versionKey = `${manifest.body.tenant}/${manifest.body.name}@${manifest.targetVersion}`;
    const recordedDigest = this.versionDigests.get(versionKey);
    if (recordedDigest !== undefined && result.bodyVersion.digest !== recordedDigest) {
      throw new BodyForgeError(BODY_FORGE_ERROR_CODES.VERSION_CONFLICT, {
        message: `body version ${versionKey} is already forged with a different digest (recorded: ${recordedDigest}; attempted: ${result.bodyVersion.digest}) — body versions are immutable and content-addressed, so history is never rewritten`,
        details: { version: versionKey, recorded: recordedDigest, attempted: result.bodyVersion.digest },
      });
    }

    // Append to the digest-addressed, append-only registry.
    const existing = this.recordsByDigest.get(result.record.digest as string);
    if (existing !== undefined) {
      // Byte-identical record already present: record-once semantics.
      this.forgeKeys.set(options.forgeKey, {
        commandCanonical: command,
        recordDigest: existing.digest as string,
      });
      this.resultsByKey.set(options.forgeKey, result);
      return result;
    }
    this.recordsByDigest.set(result.record.digest as string, result.record);
    this.ledger.push(result.record);
    this.versionDigests.set(versionKey, result.bodyVersion.digest as string);
    this.forgeKeys.set(options.forgeKey, {
      commandCanonical: command,
      recordDigest: result.record.digest as string,
    });
    this.resultsByKey.set(options.forgeKey, result);
    return result;
  }

  /** Look up a forge record by its content digest. */
  getRecord(digest: string): ForgeRecord | undefined {
    return this.recordsByDigest.get(digest);
  }

  /** The full registry in append order (observability dump). */
  listRecords(): readonly ForgeRecord[] {
    return [...this.ledger];
  }

  /** Records for one body (tenant/name), in append order. */
  listRecordsByBody(tenant: string, name: string): readonly ForgeRecord[] {
    return this.ledger.filter(
      (record) => record.bodyVersionRef.tenant === tenant && record.bodyVersionRef.name === name,
    );
  }

  /** Records whose source manifest had the given digest, in append order. */
  listRecordsByManifest(manifestDigest: string): readonly ForgeRecord[] {
    return this.ledger.filter((record) => record.manifestDigest === manifestDigest);
  }
}
