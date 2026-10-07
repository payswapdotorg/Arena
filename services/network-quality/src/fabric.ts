/**
 * In-memory reference fabric for the network-quality service (Work Order
 * C020) — the services-layer house pattern (expert-performance /
 * escalation-validation): injected ports with an in-process,
 * zero-external-dependency reference implementation. Hosts swap the
 * fabric for real persistence (adapters/*, never here).
 *
 *   - FixedClock                      — deterministic injected time;
 *   - InMemoryDisputeStore / CoiStore / FindingStore / ReputationStore /
 *     EnforcementStore — tenant-scoped append-only record stores;
 *   - InMemoryEventSink               — collects the network-quality
 *                                        envelope events in emission order;
 *   - CapturingProfileEvidenceProposals / CapturingRequalificationProposals
 *                                      — the PROPOSAL sinks: they record
 *                                        proposals durably (AQ-1: the real
 *                                        C005/C004 surfaces accept through
 *                                        their own ports);
 *   - FakeValidationOutcomeSource / FakeVotingSource / FakePayoutAuditSource
 *     / FakeIdentitySignalSource / FakeEngagementSignalSource — the
 *     C009/C013/C010/registry/engagement seams over scripted data.
 */

import type {
  CoiRecord,
  DisputeRecord,
  EnforcementCase,
  FindingRecord,
  IdentitySignal,
  EngagementSignal,
  PayoutAuditSignal,
  ProfileEvidenceProposal,
  RequalificationTriggerProposal,
  ReputationRecord,
  ValidationOutcomeSourceData,
} from '@arena/network-quality';
import type { Envelope } from '@arena/protocol-core';
import type {
  Clock,
  CoiStore,
  CompetitionVotingData,
  DisputeStore,
  EnforcementStore,
  FindingStore,
  IdentitySignalSourcePort,
  EngagementSignalSourcePort,
  ReputationStore,
  NetworkQualityEventSink,
  NetworkQualitySinks,
  NetworkQualitySourcePorts,
  NetworkQualityStores,
  PayoutAuditSourcePort,
  ProfileEvidenceProposalSink,
  RequalificationProposalSink,
  ValidationOutcomeSourcePort,
  ValidationOutcomeLookup,
  VotingSourcePort,
} from './ports.js';

// ---------------------------------------------------------------------------
// Clock + stores + sinks
// ---------------------------------------------------------------------------

/** Deterministic clock returning a fixed instant. */
export class FixedClock implements Clock {
  constructor(private readonly at: number) {}
  now(): number {
    return this.at;
  }
}

/** Tenant-scoped in-memory dispute store. */
export class InMemoryDisputeStore implements DisputeStore {
  private readonly byId = new Map<string, DisputeRecord>();

  async insert(record: DisputeRecord): Promise<void> {
    const key = `${record.tenant}:${record.disputeId}`;
    if (this.byId.has(key)) {
      throw new Error(`duplicate dispute record: ${record.disputeId}`);
    }
    this.byId.set(key, record);
  }

  async update(record: DisputeRecord): Promise<void> {
    const key = `${record.tenant}:${record.disputeId}`;
    if (!this.byId.has(key)) {
      throw new Error(`unknown dispute record: ${record.disputeId}`);
    }
    this.byId.set(key, record);
  }

  async get(disputeId: string, tenant: string): Promise<DisputeRecord | undefined> {
    const record = this.byId.get(`${tenant}:${disputeId}`);
    if (record === undefined) return undefined;
    return { ...record };
  }

  /** Test surface: direct (tenant-scoped) access. */
  async peek(disputeId: string, tenant: string): Promise<DisputeRecord | undefined> {
    return this.byId.get(`${tenant}:${disputeId}`);
  }
}

/** Tenant-scoped in-memory COI registry. */
export class InMemoryCoiStore implements CoiStore {
  private readonly records: CoiRecord[] = [];

  async insert(record: CoiRecord): Promise<void> {
    if (this.records.some((entry) => entry.tenant === record.tenant && entry.coiId === record.coiId)) {
      throw new Error(`duplicate coi record: ${record.coiId}`);
    }
    this.records.push(record);
  }

  async update(record: CoiRecord): Promise<void> {
    const index = this.records.findIndex(
      (entry) => entry.tenant === record.tenant && entry.coiId === record.coiId,
    );
    if (index < 0) {
      throw new Error(`unknown coi record: ${record.coiId}`);
    }
    this.records[index] = record;
  }

  async list(tenant: string): Promise<readonly CoiRecord[]> {
    return this.records.filter((entry) => entry.tenant === tenant).map((entry) => ({ ...entry }));
  }
}

/** Tenant-scoped in-memory finding store. */
export class InMemoryFindingStore implements FindingStore {
  private readonly byId = new Map<string, FindingRecord>();

  async insert(record: FindingRecord): Promise<void> {
    const key = `${record.tenant}:${record.findingId}`;
    if (this.byId.has(key)) {
      throw new Error(`duplicate finding record: ${record.findingId}`);
    }
    this.byId.set(key, record);
  }

  async get(findingId: string, tenant: string): Promise<FindingRecord | undefined> {
    const record = this.byId.get(`${tenant}:${findingId}`);
    if (record === undefined) return undefined;
    return { ...record };
  }

  async list(tenant: string): Promise<readonly FindingRecord[]> {
    const result: FindingRecord[] = [];
    for (const record of this.byId.values()) {
      if (record.tenant === tenant) result.push({ ...record });
    }
    return result;
  }
}

/** Tenant-scoped in-memory reputation store. */
export class InMemoryReputationStore implements ReputationStore {
  private readonly records: ReputationRecord[] = [];

  async insert(record: ReputationRecord): Promise<void> {
    if (this.records.some((entry) => entry.recordId === record.recordId)) {
      throw new Error(`duplicate reputation record: ${record.recordId}`);
    }
    this.records.push(record);
  }

  async list(tenant: string, expertId: string, family: string): Promise<readonly ReputationRecord[]> {
    return this.records
      .filter(
        (entry) => entry.tenant === tenant && entry.expertId === expertId && entry.family === family,
      )
      .map((entry) => ({ ...entry }));
  }
}

/** Tenant-scoped in-memory enforcement-case store. */
export class InMemoryEnforcementStore implements EnforcementStore {
  private readonly byId = new Map<string, EnforcementCase>();

  async insert(record: EnforcementCase): Promise<void> {
    const key = `${record.tenant}:${record.caseId}`;
    if (this.byId.has(key)) {
      throw new Error(`duplicate enforcement case: ${record.caseId}`);
    }
    this.byId.set(key, record);
  }

  async update(record: EnforcementCase): Promise<void> {
    const key = `${record.tenant}:${record.caseId}`;
    if (!this.byId.has(key)) {
      throw new Error(`unknown enforcement case: ${record.caseId}`);
    }
    this.byId.set(key, record);
  }

  async get(caseId: string, tenant: string): Promise<EnforcementCase | undefined> {
    const record = this.byId.get(`${tenant}:${caseId}`);
    if (record === undefined) return undefined;
    return { ...record };
  }
}

/** Event sink collecting the emitted envelope events in order. */
export class InMemoryEventSink implements NetworkQualityEventSink {
  readonly events: Envelope<unknown>[] = [];

  async emit(event: Envelope<unknown>): Promise<void> {
    this.events.push(event);
  }

  ofSchema(schema: string): readonly Envelope<unknown>[] {
    return this.events.filter((event) => event.schema.includes(schema));
  }
}

/** The C005 proposal seam (reference): proposals recorded durably. */
export class CapturingProfileEvidenceProposals implements ProfileEvidenceProposalSink {
  readonly proposals: ProfileEvidenceProposal[] = [];

  async proposeProfileEvidence(proposal: ProfileEvidenceProposal): Promise<void> {
    this.proposals.push(proposal);
  }
}

/** The C004 proposal seam (reference): proposals recorded durably. */
export class CapturingRequalificationProposals implements RequalificationProposalSink {
  readonly proposals: RequalificationTriggerProposal[] = [];

  async proposeRequalificationTrigger(proposal: RequalificationTriggerProposal): Promise<void> {
    this.proposals.push(proposal);
  }
}

// ---------------------------------------------------------------------------
// The dep-seam fakes (C009 / C013 / C010 / registry / engagement)
// ---------------------------------------------------------------------------

/** THE C009 SEAM (fake): scripted adjudication outcomes keyed by lookup. */
export class FakeValidationOutcomeSource implements ValidationOutcomeSourcePort {
  private readonly byKey = new Map<string, ValidationOutcomeSourceData>();

  add(lookup: ValidationOutcomeLookup, data: ValidationOutcomeSourceData): this {
    this.byKey.set(`${lookup.tenant}:${lookup.requestId}:${lookup.refDigest}`, data);
    return this;
  }

  async resolveValidationOutcome(
    lookup: ValidationOutcomeLookup,
  ): Promise<ValidationOutcomeSourceData | null> {
    return this.byKey.get(`${lookup.tenant}:${lookup.requestId}:${lookup.refDigest}`) ?? null;
  }
}

/** THE C013 SEAM (fake): scripted competition voting data. */
export class FakeVotingSource implements VotingSourcePort {
  private readonly byCompetition = new Map<string, CompetitionVotingData>();

  add(tenant: string, competitionId: string, data: CompetitionVotingData): this {
    this.byCompetition.set(`${tenant}:${competitionId}`, data);
    return this;
  }

  async listCompetitionVoting(
    tenant: string,
    competitionId: string,
  ): Promise<CompetitionVotingData | null> {
    return this.byCompetition.get(`${tenant}:${competitionId}`) ?? null;
  }
}

/** THE C010 SEAM (fake): scripted payout audit events. */
export class FakePayoutAuditSource implements PayoutAuditSourcePort {
  private readonly events: PayoutAuditSignal[] = [];

  add(events: readonly PayoutAuditSignal[]): this {
    this.events.push(...events);
    return this;
  }

  async listPayoutAuditEvents(tenant: string, sinceMs: number): Promise<readonly PayoutAuditSignal[]> {
    return this.events.filter(
      (event) => event.tenantId === tenant && Date.parse(event.occurredAt) >= sinceMs,
    );
  }
}

/** The registry identity-signal seam (fake). */
export class FakeIdentitySignalSource implements IdentitySignalSourcePort {
  private readonly signals: IdentitySignal[] = [];

  add(signals: readonly IdentitySignal[]): this {
    this.signals.push(...signals);
    return this;
  }

  async listIdentitySignals(tenant: string): Promise<readonly IdentitySignal[]> {
    return this.signals.filter((signal) => signal.tenant === tenant);
  }
}

/** The C011 engagement-signal seam (fake). */
export class FakeEngagementSignalSource implements EngagementSignalSourcePort {
  private readonly signals: EngagementSignal[] = [];

  add(signals: readonly EngagementSignal[]): this {
    this.signals.push(...signals);
    return this;
  }

  async listEngagementSignals(tenant: string): Promise<readonly EngagementSignal[]> {
    return this.signals.filter((signal) => signal.tenant === tenant);
  }
}

// ---------------------------------------------------------------------------
// The reference fabric assembly
// ---------------------------------------------------------------------------

/** Build the full in-memory reference fabric (stores + sinks + fakes). */
export function createNetworkQualityFabric(at: number): {
  readonly clock: FixedClock;
  readonly stores: NetworkQualityStores;
  readonly sinks: NetworkQualitySinks;
  readonly sources: NetworkQualitySourcePorts;
  readonly eventSink: InMemoryEventSink;
  readonly profileEvidenceProposals: CapturingProfileEvidenceProposals;
  readonly requalificationProposals: CapturingRequalificationProposals;
  readonly fakes: {
    readonly validationOutcomes: FakeValidationOutcomeSource;
    readonly voting: FakeVotingSource;
    readonly payoutAudit: FakePayoutAuditSource;
    readonly identitySignals: FakeIdentitySignalSource;
    readonly engagementSignals: FakeEngagementSignalSource;
  };
} {
  const clock = new FixedClock(at);
  const disputes = new InMemoryDisputeStore();
  const coi = new InMemoryCoiStore();
  const findings = new InMemoryFindingStore();
  const reputation = new InMemoryReputationStore();
  const enforcement = new InMemoryEnforcementStore();
  const eventSink = new InMemoryEventSink();
  const profileEvidenceProposals = new CapturingProfileEvidenceProposals();
  const requalificationProposals = new CapturingRequalificationProposals();
  const validationOutcomes = new FakeValidationOutcomeSource();
  const voting = new FakeVotingSource();
  const payoutAudit = new FakePayoutAuditSource();
  const identitySignals = new FakeIdentitySignalSource();
  const engagementSignals = new FakeEngagementSignalSource();
  return {
    clock,
    stores: { disputes, coi, findings, reputation, enforcement },
    sinks: {
      events: eventSink,
      profileEvidenceProposals,
      requalificationProposals,
    },
    sources: {
      validationOutcomes,
      voting,
      payoutAudit,
      identitySignals,
      engagementSignals,
    },
    eventSink,
    profileEvidenceProposals,
    requalificationProposals,
    fakes: {
      validationOutcomes,
      voting,
      payoutAudit,
      identitySignals,
      engagementSignals,
    },
  };
}
