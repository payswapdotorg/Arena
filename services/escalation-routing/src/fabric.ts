/**
 * In-memory reference fabric for the escalation-routing service (Work
 * Order C002) — the services-layer house pattern (A013/A015/A025/C001):
 * injected ports with an in-process, zero-external-dependency reference
 * implementation. Hosts swap the fabric for real persistence
 * (Neon/R2/Upstash adapters live in adapters/*, never here).
 */

import type { CapabilityGraph } from '@arena/capability-graph';
import type { RoutingCandidate, RoutingDecisionRecord } from '@arena/escalation-routing';
import { verifyRoutingDecisionChain } from '@arena/escalation-routing';
import type { CapabilityGraphSource, RoutingCandidateDirectory, RoutingDecisionLog } from './ports.js';
import type { RoutingJobRecord, RoutingJobStore } from './jobs.js';

/** Fixed-clock reference implementation (deterministic tests / replays). */
export class FixedClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
  advanceBy(ms: number): void {
    this.current += ms;
  }
}

/** A static graph source (reference wiring). */
export class StaticGraphSource implements CapabilityGraphSource {
  constructor(private readonly graph: CapabilityGraph) {}
  async load(): Promise<CapabilityGraph> {
    return this.graph;
  }
}

/** A static candidate directory (reference wiring — host contract applies). */
export class StaticRoutingCandidateDirectory implements RoutingCandidateDirectory {
  constructor(private readonly candidates: readonly RoutingCandidate[]) {}
  async listRoutingCandidates(_tenantId: string): Promise<readonly RoutingCandidate[]> {
    return this.candidates;
  }
}

/** A callable candidate directory (misconfiguration/adversarial tests). */
export class DelegatingRoutingCandidateDirectory implements RoutingCandidateDirectory {
  constructor(
    private readonly delegate: (tenantId: string) => Promise<readonly RoutingCandidate[]>,
  ) {}
  async listRoutingCandidates(tenantId: string): Promise<readonly RoutingCandidate[]> {
    return this.delegate(tenantId);
  }
}

/**
 * In-memory append-only decision log — the per-escalation histories are
 * digest-CHAINED (verified on read; any tamper is surfaced to the caller
 * as the routing package's typed TAMPERED failure).
 */
export class InMemoryRoutingDecisionLog implements RoutingDecisionLog {
  private readonly byRequest = new Map<string, RoutingDecisionRecord[]>();
  private readonly seen = new Set<string>();

  async append(record: RoutingDecisionRecord): Promise<void> {
    if (this.seen.has(record.digest)) {
      // Idempotent re-assertion of bit-identical content (the house
      // pattern of @arena/capability-graph's appendNode): re-routing the
      // same request at the same evaluatedAt re-records nothing.
      return;
    }
    const key = `t:${record.tenantId}:r:${record.requestId}`;
    const existing = this.byRequest.get(key) ?? [];
    this.byRequest.set(key, [...existing, record]);
    this.seen.add(record.digest);
  }

  async list(requestId: string, tenantId: string): Promise<readonly RoutingDecisionRecord[]> {
    const history = this.byRequest.get(`t:${tenantId}:r:${requestId}`) ?? [];
    // TENANT SCOPING: verify the chain before handing anything out.
    await verifyRoutingDecisionChain(history);
    return [...history];
  }
}

/** In-memory durable routing job store (A015 submission-key dedup). */
export class InMemoryRoutingJobStore implements RoutingJobStore {
  private readonly bySubmissionKey = new Map<string, RoutingJobRecord>();

  async insert(job: RoutingJobRecord): Promise<void> {
    if (this.bySubmissionKey.has(job.submissionKey)) {
      throw new Error(`duplicate routing job submission key: ${job.submissionKey}`);
    }
    this.bySubmissionKey.set(job.submissionKey, job);
  }

  async findBySubmissionKey(submissionKey: string): Promise<RoutingJobRecord | undefined> {
    return this.bySubmissionKey.get(submissionKey);
  }

  async list(): Promise<readonly RoutingJobRecord[]> {
    return [...this.bySubmissionKey.values()];
  }

  async update(job: RoutingJobRecord): Promise<void> {
    if (!this.bySubmissionKey.has(job.submissionKey)) {
      throw new Error(`unknown routing job submission key: ${job.submissionKey}`);
    }
    this.bySubmissionKey.set(job.submissionKey, job);
  }
}
