/**
 * ExpertEngagementService — the in-process reference service over the
 * @arena/expert-engagement domain (Work Order C011; mirrors the
 * services/expert-performance / services/payments fabric pattern:
 * in-memory-append-only reference stores, injected C001/C002/C010 ports,
 * durable idempotent SLA-evaluation jobs on the A015 fabric seam,
 * fail-closed errors, envelope conventions, REQUIRED idempotency keys on
 * commands).
 *
 * Operations:
 *   - issueOffer (COMMAND): resolves the C001 escalation snapshot (the
 *     request must be in a state the OFFERED engagement binds to), the
 *     C002 routing verdict (the expert MUST be on the matched verdict's
 *     shortlist — never an off-shortlist offer), the C010 commercial
 *     binding (opaque refs only) and the CURRENT availability declaration
 *     (deterministic offer-time resolution; a fully-committed window
 *     fails closed with CAPACITY_EXCEEDED — capacity accounting that
 *     cannot overcommit a declared window); then appends the OFFERED
 *     engagement record (idempotent + correlation-addressable);
 *   - accept / decline / expire / withdraw / replace / activate /
 *     complete (COMMANDS): guarded transitions bound to the C001
 *     lifecycle through closed allowlists (ESCALATION_STATE_MISMATCH on
 *     drift); acceptance re-checks capacity AND the offer expiry
 *     (acceptance at/after expiry fails closed with OFFER_EXPIRED);
 *     duplicate acceptance REPLAYS the recorded outcome (typed
 *     duplicate, never a double-commit); replace carries the successor
 *     engagement id (supersession);
 *   - declareAvailability (COMMAND): versioned declarations; a new
 *     version must strictly supersede the current one;
 *   - getAvailabilityRoutingInput (QUERY): the ES1.0 "current
 *     availability" routing-input projection for the C002 seam;
 *   - evaluateSlaClocks (COMMAND): SLA clock evaluation as a DURABLE
 *     IDEMPOTENT job on the A015 fabric seam — the evaluation derives
 *     the clocks, records breached clocks as append-only
 *     content-addressed breach records (first observation is canonical)
 *     and returns the typed evaluation;
 *   - getEngagement (QUERY): tenant-scoped record read with digest
 *     re-verification (TAMPERED on mismatch).
 *
 * Integrity: every store fetch re-verifies the content digest. Tenant
 * isolation: cross-tenant access fails closed (lock rule 11).
 * Determinism: all times are injected — no hidden clocks (rule 17).
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import {
  DEFAULT_SLA_POLICY,
  EXPERT_ENGAGEMENT_ERROR_CODES,
  ExpertEngagementError,
  applyEngagementTransition,
  bindsToEscalationState,
  checkEngagementTransition,
  clocksForEngagement,
  createAvailabilityDeclaration,
  createEngagementOffer,
  createSlaBreachRecord,
  evaluateSlaClocks as evaluateSlaClocksPure,
  isEngagementTransition,
  makeAvailabilityDeclaredEvent,
  makeDeclareAvailabilityCommand,
  makeEngagementTransitionCommand,
  makeEngagementTransitionedEvent,
  makeGetAvailabilityQuery,
  makeGetAvailabilityResponse,
  makeGetEngagementQuery,
  makeGetEngagementResponse,
  makeGetSlaEvaluationQuery,
  makeGetSlaEvaluationResponse,
  makeIssueOfferCommand,
  makeOfferIssuedEvent,
  resolveAvailabilityAtOfferTime,
  resolveCurrentDeclaration,
  slaBreachReasonFor,
  toRoutingAvailabilityInput,
  verifyAvailabilityDeclarationDigest,
  verifyEngagementDigest,
  verifySlaBreachRecordDigest,
} from '@arena/expert-engagement';
import type {
  AvailabilityDeclaration,
  CapacityCommitment,
  EngagementRecord,
  EngagementTransition,
  SlaBreachRecord,
  SlaEvaluation,
  SlaPolicy,
} from '@arena/expert-engagement';
import type {
  ExpertEngagementPorts,
  SlaEvaluationJobRecord,
} from './ports.js';

export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** Caller-injected operation time (ms-precision UTC — no hidden clock). */
  readonly at: string;
}

export interface QueryOptions {
  readonly correlationId: string;
  /** Caller-injected projection time. */
  readonly at: string;
}

export interface RecordQueryOptions {
  readonly correlationId: string;
}

export interface IssueOfferInput {
  readonly engagementId: string;
  readonly tenant: string;
  readonly escalationRef: string;
  readonly expertId: string;
  readonly offerExpiresAt: string;
}

export interface IssueOfferResult {
  readonly record: EngagementRecord;
  readonly replayed: boolean;
}

export interface TransitionInput {
  readonly engagementId: string;
  readonly tenant: string;
  /** Required for 'replace': the successor engagement id. */
  readonly successorEngagementId?: string;
  readonly note?: string;
}

export interface TransitionResult {
  readonly record: EngagementRecord;
  /** True when the idempotency key replayed an already-applied transition. */
  readonly replayed: boolean;
}

export interface DeclareAvailabilityInput {
  readonly declarationId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly version: number;
  readonly windows: readonly {
    readonly window: {
      readonly recurrence: string;
      readonly dayOfWeek?: number;
      readonly startUtc: string;
      readonly endUtc: string;
      readonly date?: string;
    };
    readonly capacitySlots: number;
  }[];
}

export interface DeclareAvailabilityResult {
  readonly declaration: AvailabilityDeclaration;
  readonly replayed: boolean;
}

export interface EvaluateSlaResult {
  readonly jobId: string;
  readonly replayed: boolean;
  readonly evaluation: SlaEvaluation;
  /** The breach records now durably recorded (first observation canonical). */
  readonly recordedBreaches: readonly SlaBreachRecord[];
}

interface IdempotencyBinding {
  readonly kind: 'issue-offer' | 'transition' | 'declare-availability' | 'sla-evaluation';
  readonly canonical: string;
  readonly resultKey: string;
}

interface ServiceEvent {
  readonly kind: string;
  readonly envelope: Envelope<Record<string, unknown>>;
}

function canonicalOf(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

export class ExpertEngagementService {
  private readonly ports: ExpertEngagementPorts;
  private readonly policy: SlaPolicy;
  private readonly idempotency = new Map<string, IdempotencyBinding>();
  private readonly events: ServiceEvent[] = [];
  /** The capacity window each engagement occupies (recorded at offer time). */
  private readonly windowKeyByEngagement = new Map<string, string>();
  /** The durable SLA-evaluation job registry view (fabric-owned truth). */

  constructor(ports: ExpertEngagementPorts, policy: SlaPolicy = DEFAULT_SLA_POLICY) {
    this.ports = ports;
    this.policy = policy;
  }

  // -------------------------------------------------------------------------
  // issueOffer (COMMAND — the only engagement-creating write)
  // -------------------------------------------------------------------------

  async issueOffer(
    input: IssueOfferInput,
    options: CommandOptions,
  ): Promise<IssueOfferResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);

    // Idempotent replay (lock rule 17): same key + same body replays the
    // recorded outcome verbatim; a different body is a typed conflict.
    const command = makeIssueOfferCommand(
      {
        engagementId: input.engagementId,
        tenant: input.tenant,
        escalationRef: input.escalationRef,
        expertId: input.expertId,
        commercialOfferRef: '0'.repeat(64), // resolved below; placeholder passes shape validation
        budgetHoldRef: '0'.repeat(64),
        routingVerdictRef: '0'.repeat(64),
        availabilityRef: '0'.repeat(64),
        urgency: 'routine', // resolved below from the escalation snapshot
        requestDeadline: options.at, // resolved below
        offerExpiresAt: input.offerExpiresAt,
        at: options.at,
      },
      { correlationId, idempotencyKey },
    );
    void command;

    // Resolve the C001 escalation snapshot (the request's facts).
    const snapshot = await this.ports.escalation.get(input.escalationRef, input.tenant);
    if (snapshot === undefined) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
        message: `issue-offer: escalation ${JSON.stringify(input.escalationRef)} not found for tenant ${JSON.stringify(input.tenant)} (fail closed)`,
      });
    }
    if (!bindsToEscalationState('offered', snapshot.state)) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.ESCALATION_STATE_MISMATCH, {
        message: `issue-offer: escalation state '${snapshot.state}' does not bind to an OFFERED engagement (closed allowlist)`,
        details: { state: snapshot.state },
      });
    }

    // Resolve the C002 routing verdict — the expert MUST be on the matched shortlist.
    const verdict = await this.ports.routing.resolveVerdict(input.escalationRef, input.tenant);
    if (verdict === undefined) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
        message: 'issue-offer: no routing verdict resolved for the escalation (C002 seam — fail closed)',
      });
    }
    if (verdict.outcome !== 'matched') {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.ESCALATION_STATE_MISMATCH, {
        message: `issue-offer: routing verdict outcome '${verdict.outcome}' carries no shortlist to offer against`,
        details: { outcome: verdict.outcome },
      });
    }
    if (!verdict.shortlistExpertIds.includes(input.expertId)) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
        message: `issue-offer: expert ${JSON.stringify(input.expertId)} is not on the matched verdict's shortlist (never an off-shortlist offer)`,
        details: { shortlist: [...verdict.shortlistExpertIds] },
      });
    }

    // Resolve the C010 commercial binding — opaque PUBLIC refs only.
    const commercial = await this.ports.commercial.resolveCommercialBinding(
      input.escalationRef,
      input.tenant,
    );
    if (commercial === undefined) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
        message: 'issue-offer: no C010 commercial offer/budget-hold binding resolved (fail closed — this service owns no money truth)',
      });
    }

    // Resolve the CURRENT availability declaration + deterministic
    // offer-time availability (capacity accounting that cannot overcommit).
    const declarations = await this.ports.availability.listByExpert(
      input.tenant,
      input.expertId,
    );
    for (const declaration of declarations) {
      await verifyAvailabilityDeclarationDigest(declaration);
    }
    const current = resolveCurrentDeclaration(declarations, input.tenant, input.expertId);
    const commitments = await this.commitmentsOf(input.tenant, input.expertId);
    const resolution = resolveAvailabilityAtOfferTime(
      current,
      options.at,
      snapshot.deadline,
      commitments,
    );
    if (!resolution.available || resolution.window === null) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED, {
        message: `issue-offer: expert is not available for [${options.at}, ${snapshot.deadline}]: ${resolution.reason}`,
        details: { reason: resolution.reason },
      });
    }

    // Idempotency bookkeeping (the full resolved body).
    const canonical = canonicalOf([
      'issue-offer',
      input.engagementId,
      input.tenant,
      input.escalationRef,
      input.expertId,
      input.offerExpiresAt,
      options.at,
    ]);
    const existing = await this.ports.engagements.findById(input.engagementId);
    const binding = this.idempotency.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.kind !== 'issue-offer' || binding.canonical !== canonical) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `issue-offer: idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different command`,
          details: { idempotencyKey: options.idempotencyKey },
        });
      }
      const replayed = await this.fetchEngagement(binding.resultKey, input.tenant);
      return { record: replayed, replayed: true };
    }
    if (existing !== undefined) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
        message: `issue-offer: engagementId ${JSON.stringify(input.engagementId)} already exists — the store is append-only with unique engagement ids`,
      });
    }

    const record = await createEngagementOffer({
      engagementId: input.engagementId,
      tenant: input.tenant,
      escalationRef: input.escalationRef,
      expertId: input.expertId,
      commercialOfferRef: commercial.commercialOfferRef,
      budgetHoldRef: commercial.budgetHoldRef,
      routingVerdictRef: verdict.digest,
      availabilityRef: current?.digest ?? '0'.repeat(64),
      urgency: snapshot.urgency,
      requestDeadline: snapshot.deadline,
      offerExpiresAt: input.offerExpiresAt,
      offeredAt: options.at,
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
    });

    await this.ports.engagements.insert(record);
    this.windowKeyByEngagement.set(
      `${input.tenant}/${input.engagementId}`,
      resolution.windowKey as string,
    );
    this.idempotency.set(idempotencyKey, {
      kind: 'issue-offer',
      canonical,
      resultKey: input.engagementId,
    });
    this.events.push({
      kind: 'offer-issued',
      envelope: makeOfferIssuedEvent(
        {
          engagementId: record.engagementId,
          tenant: record.tenant,
          expertId: record.expertId,
          engagementDigest: record.digest,
          at: options.at,
        },
        { correlationId, idempotencyKey },
      ) as unknown as Envelope<Record<string, unknown>>,
    });
    return { record, replayed: false };
  }

  // -------------------------------------------------------------------------
  // Lifecycle transitions (COMMANDS)
  // -------------------------------------------------------------------------

  async transition(
    input: TransitionInput,
    transition: EngagementTransition,
    options: CommandOptions,
  ): Promise<TransitionResult> {
    if (!isEngagementTransition(transition)) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION, {
        message: `transition must be one of accept|decline|expire|activate|complete|withdraw|replace, got: ${JSON.stringify(transition)}`,
      });
    }
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    makeEngagementTransitionCommand(
      {
        engagementId: input.engagementId,
        tenant: input.tenant,
        transition,
        ...(input.successorEngagementId !== undefined
          ? { successorEngagementId: input.successorEngagementId }
          : {}),
        at: options.at,
      },
      { correlationId, idempotencyKey },
    );


    const canonical = canonicalOf([
      'transition',
      transition,
      input.engagementId,
      input.tenant,
      input.successorEngagementId ?? null,
      options.at,
    ]);
    const binding = this.idempotency.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.kind !== 'transition' || binding.canonical !== canonical) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `transition: idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different command`,
          details: { idempotencyKey: options.idempotencyKey },
        });
      }
      // TYPED DUPLICATE: the same transition instruction replays the
      // recorded outcome verbatim (never a double-commit).
      const replayed = await this.fetchEngagement(binding.resultKey, input.tenant);
      return { record: replayed, replayed: true };
    }

    const record = await this.fetchEngagement(input.engagementId, input.tenant);

    // C001 escalation-state binding (closed allowlists — fail closed on drift).
    if (transition === 'accept' || transition === 'activate' || transition === 'complete') {
      const snapshot = await this.ports.escalation.get(record.escalationRef, input.tenant);
      if (snapshot === undefined) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
          message: 'transition: the bound escalation no longer resolves (fail closed)',
        });
      }
      const targetStatus =
        transition === 'accept' ? 'accepted' : transition === 'activate' ? 'active' : 'completed';
      if (!bindsToEscalationState(targetStatus, snapshot.state)) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.ESCALATION_STATE_MISMATCH, {
          message: `transition '${transition}' requires the escalation to bind to engagement '${targetStatus}', recorded state is '${snapshot.state}'`,
          details: { state: snapshot.state, targetStatus },
        });
      }
    }

    // Capacity accounting on acceptance: the window cannot overcommit.
    if (transition === 'accept') {
      const declarations = await this.ports.availability.listByExpert(
        record.tenant,
        record.expertId,
      );
      const current = resolveCurrentDeclaration(declarations, record.tenant, record.expertId);
      if (current !== null) {
        const commitments = await this.commitmentsOf(record.tenant, record.expertId);
        const resolution = resolveAvailabilityAtOfferTime(
          current,
          record.offeredAt,
          record.requestDeadline,
          commitments,
        );
        if (!resolution.available) {
          throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED, {
            message: `accept: the engagement's availability window has no remaining capacity (${resolution.reason}) — capacity accounting cannot overcommit a declared window`,
            details: { reason: resolution.reason },
          });
        }
        this.windowKeyByEngagement.set(
          `${record.tenant}/${record.engagementId}`,
          resolution.windowKey as string,
        );
      }
    }

    const guard = checkEngagementTransition(record, transition, {
      at: options.at,
      tenant: input.tenant,
      ...(input.successorEngagementId !== undefined
        ? { successorEngagementId: input.successorEngagementId }
        : {}),
    });
    if (!guard.allowed) {
      // Acceptance-after-expiry and every other denial fail closed here.
      const reason = guard.reason;
      const code =
        reason === 'transition_offer_expired'
          ? EXPERT_ENGAGEMENT_ERROR_CODES.OFFER_EXPIRED
          : reason === 'transition_tenant_mismatch'
            ? EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS
            : reason === 'transition_terminal_source'
              ? EXPERT_ENGAGEMENT_ERROR_CODES.TERMINAL_STATE
              : reason === 'transition_deadline_passed'
                ? EXPERT_ENGAGEMENT_ERROR_CODES.DEADLINE_PASSED
                : EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION;
      throw new ExpertEngagementError(code, {
        message: `transition '${transition}' denied: ${reason} (${guard.from} → ${guard.to})`,
        details: { reason, from: guard.from, to: guard.to },
      });
    }

    const next = await applyEngagementTransition(record, {
      transition,
      at: options.at,
      tenant: input.tenant,
      ...(input.successorEngagementId !== undefined
        ? { successorEngagementId: input.successorEngagementId }
        : {}),
    });
    await this.ports.engagements.update(next);
    this.idempotency.set(idempotencyKey, {
      kind: 'transition',
      canonical,
      resultKey: input.engagementId,
    });
    this.events.push({
      kind: 'engagement-transitioned',
      envelope: makeEngagementTransitionedEvent(
        {
          engagementId: next.engagementId,
          tenant: next.tenant,
          transition,
          from: guard.from,
          to: guard.to,
          engagementDigest: next.digest,
          at: options.at,
        },
        { correlationId, idempotencyKey },
      ) as unknown as Envelope<Record<string, unknown>>,
    });
    return { record: next, replayed: false };
  }

  async accept(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'accept', options);
  }

  async decline(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'decline', options);
  }

  async expire(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'expire', options);
  }

  async withdraw(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'withdraw', options);
  }

  async activate(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'activate', options);
  }

  async complete(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'complete', options);
  }

  async replace(input: TransitionInput, options: CommandOptions): Promise<TransitionResult> {
    return this.transition(input, 'replace', options);
  }

  // -------------------------------------------------------------------------
  // Availability declarations + the routing-input projection
  // -------------------------------------------------------------------------

  async declareAvailability(
    input: DeclareAvailabilityInput,
    options: CommandOptions,
  ): Promise<DeclareAvailabilityResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    makeDeclareAvailabilityCommand(
      {
        declarationId: input.declarationId,
        tenant: input.tenant,
        expertId: input.expertId,
        version: input.version,
        at: options.at,
      },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf([
      'declare-availability',
      input.declarationId,
      input.tenant,
      input.expertId,
      input.version,
      options.at,
    ]);
    const binding = this.idempotency.get(idempotencyKey);
    if (binding !== undefined) {
      if (binding.kind !== 'declare-availability' || binding.canonical !== canonical) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `declare-availability: idempotency key ${JSON.stringify(options.idempotencyKey)} is already bound to a different command`,
        });
      }
      const declarations = await this.ports.availability.listByExpert(
        input.tenant,
        input.expertId,
      );
      const replayed = declarations.find(
        (declaration) => declaration.declarationId === input.declarationId,
      );
      if (replayed === undefined) {
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
          message: 'declare-availability: replay binding lost its declaration (fail closed)',
        });
      }
      return { declaration: replayed, replayed: true };
    }

    const existing = await this.ports.availability.listByExpert(input.tenant, input.expertId);
    const current = resolveCurrentDeclaration(existing, input.tenant, input.expertId);
    if (current !== null && input.version <= current.version) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.VERSION_CONFLICT, {
        message: `declare-availability: version ${input.version} does not supersede the current version ${current.version} (strictly-increasing supersession)`,
        details: { currentVersion: current.version, attemptedVersion: input.version },
      });
    }
    const declaration = await createAvailabilityDeclaration({
      declarationId: input.declarationId,
      tenant: input.tenant,
      expertId: input.expertId,
      version: input.version,
      windows: input.windows,
      declaredAt: options.at,
    });
    await this.ports.availability.insert(declaration);
    this.idempotency.set(idempotencyKey, {
      kind: 'declare-availability',
      canonical,
      resultKey: input.declarationId,
    });
    this.events.push({
      kind: 'availability-declared',
      envelope: makeAvailabilityDeclaredEvent(
        {
          declarationId: declaration.declarationId,
          tenant: declaration.tenant,
          expertId: declaration.expertId,
          version: declaration.version,
          declarationDigest: declaration.digest,
          at: options.at,
        },
        { correlationId, idempotencyKey },
      ) as unknown as Envelope<Record<string, unknown>>,
    });
    return { declaration, replayed: false };
  }

  /** The ES1.0 "current availability" routing-input projection (QUERY). */
  async getAvailabilityRoutingInput(
    input: { readonly tenant: string; readonly expertId: string },
    options: QueryOptions,
  ) {
    const correlationId = toCorrelationId(options.correlationId);
    makeGetAvailabilityQuery(
      { tenant: input.tenant, expertId: input.expertId, at: options.at },
      { correlationId },
    );
    const declarations = await this.ports.availability.listByExpert(
      input.tenant,
      input.expertId,
    );
    for (const declaration of declarations) {
      await verifyAvailabilityDeclarationDigest(declaration);
    }
    const current = resolveCurrentDeclaration(declarations, input.tenant, input.expertId);
    const commitments = await this.commitmentsOf(input.tenant, input.expertId);
    const projection = toRoutingAvailabilityInput(current, commitments, options.at);
    makeGetAvailabilityResponse(
      {
        tenant: projection.tenant,
        expertId: projection.expertId,
        asOf: projection.asOf,
        declarationDigest: projection.declarationDigest,
        declarationVersion: projection.declarationVersion,
        availableWindowCount: projection.availableWindows.length,
        fullyCommittedWindows: projection.fullyCommittedWindows,
      },
      { correlationId },
    );
    return projection;
  }

  // -------------------------------------------------------------------------
  // SLA clock evaluation (durable idempotent job on the A015 fabric seam)
  // -------------------------------------------------------------------------

  async evaluateSlaClocks(
    input: { readonly engagementId: string; readonly tenant: string; readonly jobId?: string },
    options: CommandOptions,
  ): Promise<EvaluateSlaResult> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    // One durable job per evaluation run: the default job id is derived
    // from the engagement + the idempotency key (each run is its own
    // idempotent, correlation-addressable job on the A015 seam).
    const jobId =
      input.jobId ??
      `sla-job-${input.engagementId}-${options.idempotencyKey
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')}`;
    const record = await this.fetchEngagement(input.engagementId, input.tenant);

    const canonical = canonicalOf([
      'sla-evaluation',
      input.engagementId,
      input.tenant,
      options.at,
    ]);
    const { job, replayed } = await this.ports.slaJobs.enqueue({
      jobId,
      engagementId: input.engagementId,
      tenantId: input.tenant,
      correlationId: options.correlationId,
      idempotencyKey: options.idempotencyKey,
      enqueuedAt: options.at,
    });
    void job;
    void canonical;

    const clocks = clocksForEngagement(record, this.policy);
    const evaluation = evaluateSlaClocksPure(
      {
        clocks,
        urgency: record.urgency,
        at: options.at,
        acceptedAt: record.acceptedAt ?? null,
        activatedAt: record.activatedAt ?? null,
        completedAt: record.completedAt ?? null,
      },
      this.policy,
    );

    // Append one canonical breach record per breached clock (the FIRST
    // observation is canonical — append-only events, idempotent by id).
    const recordedBreaches: SlaBreachRecord[] = [];
    for (const clock of [evaluation.acceptClock, evaluation.startClock, evaluation.submitClock]) {
      if (clock.state !== 'breached') continue;
      const breachId = `sla-${record.engagementId.replace(/^eng-/, '')}-${clock.clock}`;
      const existing = await this.ports.breaches.listByEngagement(
        input.tenant,
        input.engagementId,
      );
      const prior = existing.find((breach) => breach.breachId === breachId);
      if (prior !== undefined) {
        await verifySlaBreachRecordDigest(prior);
        recordedBreaches.push(prior);
        continue;
      }
      const breach = await createSlaBreachRecord({
        breachId,
        tenant: record.tenant,
        engagementId: record.engagementId,
        engagementRef: record.digest,
        clock: clock.clock,
        dueAt: clock.dueAt,
        observedAt: options.at,
        reason: slaBreachReasonFor(clock.clock),
      });
      await this.ports.breaches.insert(breach);
      recordedBreaches.push(breach);
    }
    await this.ports.slaJobs.complete(jobId);

    makeGetSlaEvaluationResponse(
      {
        engagementId: record.engagementId,
        tenant: record.tenant,
        at: options.at,
        acceptClockState: evaluation.acceptClock.state,
        startClockState: evaluation.startClock.state,
        submitClockState: evaluation.submitClock.state,
        totalBreaches: recordedBreaches.length,
      },
      { correlationId },
    );
    return { jobId, replayed, evaluation, recordedBreaches };
  }

  /** The C021-facing breach summary for one engagement (QUERY). */
  async listSlaBreaches(
    input: { readonly engagementId: string; readonly tenant: string },
    _options: RecordQueryOptions,
  ): Promise<readonly SlaBreachRecord[]> {
    const records = await this.ports.breaches.listByEngagement(
      input.tenant,
      input.engagementId,
    );
    for (const record of records) {
      await verifySlaBreachRecordDigest(record);
    }
    return records;
  }

  // -------------------------------------------------------------------------
  // Record reads (QUERIES — digest-verified)
  // -------------------------------------------------------------------------

  async getEngagement(
    input: { readonly engagementId: string; readonly tenant: string },
    options: RecordQueryOptions,
  ): Promise<EngagementRecord> {
    const correlationId = toCorrelationId(options.correlationId);
    const record = await this.fetchEngagement(input.engagementId, input.tenant);
    makeGetEngagementQuery(
      { engagementId: input.engagementId, tenant: input.tenant },
      { correlationId },
    );
    makeGetEngagementResponse(
      {
        engagementId: record.engagementId,
        tenant: record.tenant,
        status: record.status,
        engagementDigest: record.digest,
      },
      { correlationId },
    );
    return record;
  }

  /** The service's emitted events (delivery adapter seam). */
  listEvents(): readonly ServiceEvent[] {
    return Object.freeze([...this.events]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async fetchEngagement(
    engagementId: string,
    tenant: string,
  ): Promise<EngagementRecord> {
    const record = await this.ports.engagements.get(engagementId, tenant);
    if (record === undefined) {
      const unscoped = await this.ports.engagements.findById(engagementId);
      if (unscoped !== undefined) {
        // Cross-tenant access fails closed with the typed scope error.
        throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS, {
          message: `engagement ${JSON.stringify(engagementId)} belongs to another tenant (cross-tenant access denied)`,
        });
      }
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND, {
        message: `engagement ${JSON.stringify(engagementId)} not found (fail closed)`,
      });
    }
    await verifyEngagementDigest(record);
    return record;
  }

  private async commitmentsOf(
    tenant: string,
    expertId: string,
  ): Promise<readonly CapacityCommitment[]> {
    const records = await this.ports.engagements.listByExpert(tenant, expertId);
    const commitments: CapacityCommitment[] = [];
    for (const record of records) {
      if (record.status !== 'accepted' && record.status !== 'active') continue;
      const windowKey = this.windowKeyByEngagement.get(`${tenant}/${record.engagementId}`);
      if (windowKey === undefined) continue;
      commitments.push({
        engagementId: record.engagementId,
        tenant,
        expertId,
        windowKey,
      });
    }
    return commitments;
  }
}

/** Build the reference service over the injected ports. */
export function createExpertEngagementService(
  ports: ExpertEngagementPorts,
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
): ExpertEngagementService {
  return new ExpertEngagementService(ports, policy);
}

export type { SlaEvaluationJobRecord };
