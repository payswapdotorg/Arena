/**
 * ExperimentRegistry — the in-process registry of experiment
 * descriptors for the reference fabric (Work Order A020; requirement
 * R15).
 *
 * Registration is IDEMPOTENT BY DIGEST (bit-identical re-registration
 * is a no-op); a DIFFERENT digest under the same (experimentId,
 * version) identity is an IDENTITY_CONFLICT — changing an experiment
 * requires a new version (mirroring the A012 evaluator registry, the
 * A013 verifier registry and the A019 policy registry semantics: the
 * quality model's "changing an evaluator requires a new version").
 */

import {
  LEARNING_ERROR_CODES,
  LearningError,
  isExperimentDescriptor,
  recomputeExperimentDescriptorDigest,
} from '@arena/learning';
import type { ExperimentDescriptor } from '@arena/learning';

interface Registration {
  readonly descriptor: ExperimentDescriptor;
}

/** The in-process, content-addressed experiment registry. */
export class ExperimentRegistry {
  private readonly byDigest = new Map<string, Registration>();
  private readonly byIdentity = new Map<string, string>();
  private readonly byId = new Map<string, Set<string>>();
  private readonly ledger: ExperimentDescriptor[] = [];

  /** Register a descriptor (idempotent by digest; identity conflicts rejected). */
  async registerExperiment(descriptor: ExperimentDescriptor): Promise<ExperimentDescriptor> {
    if (!isExperimentDescriptor(descriptor)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
        message: 'experiment registration requires a structurally valid experiment descriptor',
      });
    }
    await recomputeExperimentDescriptorDigest(descriptor);

    const existingDigest = this.byDigest.get(descriptor.digest);
    if (existingDigest !== undefined) {
      return existingDigest.descriptor; // idempotent re-registration
    }

    const identity = `${descriptor.experimentId}@${descriptor.version}`;
    const bound = this.byIdentity.get(identity);
    if (bound !== undefined) {
      throw new LearningError(LEARNING_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `experiment identity ${JSON.stringify(identity)} is already bound to digest ${bound}; attempted to register digest ${descriptor.digest} (changing an experiment requires a new version)`,
        details: { identity, bound, attempted: descriptor.digest },
      });
    }

    this.byDigest.set(descriptor.digest, { descriptor });
    this.byIdentity.set(identity, descriptor.digest);
    const ids = this.byId.get(descriptor.experimentId as string) ?? new Set<string>();
    ids.add(descriptor.digest);
    this.byId.set(descriptor.experimentId as string, ids);
    this.ledger.push(descriptor);
    return descriptor;
  }

  /** Look up a descriptor by its content digest. */
  getExperiment(digest: string): ExperimentDescriptor | undefined {
    return this.byDigest.get(digest)?.descriptor;
  }

  /** All registered versions of an experiment id (registration order). */
  listExperimentsById(experimentId: string): readonly ExperimentDescriptor[] {
    const digests = this.byId.get(experimentId);
    if (digests === undefined) return [];
    return [...digests].map((digest) => this.byDigest.get(digest)?.descriptor).filter(
      (descriptor): descriptor is ExperimentDescriptor => descriptor !== undefined,
    );
  }

  /** The full registry (registration order) — observability dump. */
  listExperiments(): readonly ExperimentDescriptor[] {
    return [...this.ledger];
  }
}
