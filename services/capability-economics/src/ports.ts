/**
 * Capability-economics service ports (Work Order C016) — the ONLY
 * things services/capability-economics depends on besides the domain
 * packages (@arena/capability-economics, @arena/payments,
 * @arena/job-protocol, @arena/protocol-core). Mirroring the sibling
 * services' ports.ts discipline (services/capability-routing,
 * services/escalation-api): injected dependencies, no wall-clock reads,
 * no service-to-service imports (boundary rule B2 — hosts wire the real
 * read surfaces; the reference fabric wires in-memory ones +
 * structural-mirror views).
 *
 *   - Clock                    — time is INJECTED (lock rule 17);
 *   - PaymentLedgerSource      — the C010 commercial-truth read surface
 *                                (REQUIRED for any cost figure: a cost
 *                                record fabricated without C010 ledger
 *                                backing must fail closed);
 *   - ValidationOutcomeSource  — the C009 adjudication read surface;
 *   - RoutingDecisionSource    — the C015 routing-decision read surface;
 *   - EffortSignalSource       — the C005/expert-session effort surface;
 *   - CapabilityLiftValueSource— the Q1.0 value-record read surface;
 *   - EconomicsRecordStore     — the append-only record history;
 *   - EconomicsPolicyStore     — the versioned economics policy.
 *
 * HOST CONTRACT (every source): ports must only return records of the
 * requested tenant. The SERVICE double-guards this — a cross-tenant
 * record is a typed CROSS_TENANT denial, never an economics read
 * (defense in depth against a misconfigured host).
 */

import type { PaymentLedger } from '@arena/payments';
import type {
  CapabilityLiftValueRecord,
  EconomicsPolicy,
  EconomicsResourceClass,
  EconomicsValidationVerdict,
  UnitEconomicsRecord,
} from '@arena/capability-economics';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** The C010 escrow/hold ledger read surface (host-wired; tenant-scoped). */
export interface PaymentLedgerSource {
  loadLedger(requestId: string, tenantId: string): Promise<PaymentLedger | null>;
}

/** The economics-side view of one C009 validation outcome. */
export interface ValidationOutcomeView {
  readonly verdict: EconomicsValidationVerdict;
  /** 1-based adjudication round (revision attempts consumed + 1). */
  readonly attemptNumber: number;
  /** Expert replacements observed on the escalation. */
  readonly replacementCount: number;
  /** Provenance refs (C009 verdict id / record digest), when available. */
  readonly verdictId?: string;
  readonly recordDigest?: string;
}

/** The C009 validation-outcome read surface (host-wired; tenant-scoped). */
export interface ValidationOutcomeSource {
  loadValidationOutcome(requestId: string, tenantId: string): Promise<ValidationOutcomeView | null>;
}

/** The economics-side view of one C015 routing decision. */
export interface RoutingDecisionView {
  readonly outcome: 'matched' | 'no-match';
  readonly resourceClasses: readonly EconomicsResourceClass[];
  /** Provenance: the C015 ResourceMatch digest, when available. */
  readonly matchDigest?: string;
}

/** The C015 routing-decision read surface (host-wired; tenant-scoped). */
export interface RoutingDecisionSource {
  loadRoutingDecision(demandId: string, tenantId: string): Promise<RoutingDecisionView | null>;
}

/** The economics-side view of the effort signals of one intervention. */
export interface EffortSignalView {
  readonly sessionDurationMinutes: number | null;
  readonly revisionRounds: number;
  readonly replacementCount: number;
  readonly sourceRefs: readonly string[];
}

/** The C005/expert-session effort-signal read surface (host-wired; tenant-scoped). */
export interface EffortSignalSource {
  loadEffortSignals(requestId: string, tenantId: string): Promise<EffortSignalView | null>;
}

/** The Q1.0 capability-lift value-record read surface (host-wired; tenant-scoped). */
export interface CapabilityLiftValueSource {
  loadValueRecord(requestId: string, tenantId: string): Promise<CapabilityLiftValueRecord | null>;
}

/** Persistence port for the append-only unit-economics record history. */
export interface EconomicsRecordStore {
  /** Append one record (the service guarantees supersession-by-append). */
  append(record: UnitEconomicsRecord): Promise<void>;
  /** The record history of one escalation, in append order. */
  listByRequest(requestId: string, tenantId: string): Promise<readonly UnitEconomicsRecord[]>;
  /** All economics records of one tenant, in append order (read models). */
  listByTenant(tenantId: string): Promise<readonly UnitEconomicsRecord[]>;
}

/** Persistence port for the versioned economics policy (supersessions only). */
export interface EconomicsPolicyStore {
  /** The current policy. */
  current(): Promise<EconomicsPolicy>;
  /** Supersede the current policy (version must advance by one). */
  supersede(next: EconomicsPolicy): Promise<EconomicsPolicy>;
}
