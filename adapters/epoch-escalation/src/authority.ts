/**
 * The Epoch authority boundary (Work Order C019; spec/epoch-integration.md
 * EPI1.0 "Authority"; docs/architecture-lock.md rules 13-15 and 36).
 *
 * Arena — and therefore this adapter — does NOT:
 *   - mutate the Epoch World Model;
 *   - execute Epoch actions;
 *   - alter Epoch constraints;
 *   - change approved Epoch baselines;
 *   - alter Epoch delivery state;
 *   - become Epoch's semantic authority.
 *
 * ENFORCEMENT IS STRUCTURAL, not merely documented:
 *
 *   1. The public surface of this package exports NO function, type or
 *      port that accepts an Epoch World Model, Action Gateway, Constraint
 *      Engine, baseline or delivery-state handle. There is nothing to
 *      call WITH such a handle — a write-back is UNREPRESENTABLE through
 *      the adapter's typed surface.
 *   2. Every value this adapter produces toward Epoch is a deep-frozen,
 *      read-only projection (EpochEscalationDelivery); mutation attempts
 *      fail silently at runtime (frozen) and fail closed at the type
 *      level (readonly everywhere, no setters).
 *   3. The single explicit "write attempt" entry point that exists —
 *      attemptEpochAuthoritativeWrite — exists ONLY as the fail-closed
 *      denial surface for adversarial proof: it NEVER writes, it always
 *      throws the typed WRITEBACK_FORBIDDEN error (architecture-lock
 *      rule 15: no direct Arena writes to Epoch authoritative stores).
 */

import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError } from './errors.js';

/** The six EPI1.0 authority clauses this adapter structurally honours. */
export const EPOCH_ESCALATION_AUTHORITY_BOUNDARY = Object.freeze({
  protocol: 'EPI1.0+ES1.0',
  lockRules: Object.freeze(['13', '14', '15', '36'] as const),
  clauses: Object.freeze([
    'no-epoch-world-model-mutation',
    'no-epoch-action-execution',
    'no-epoch-constraint-alteration',
    'no-epoch-baseline-change',
    'no-epoch-delivery-state-alteration',
    'no-epoch-semantic-authority',
  ] as const),
  /** The ONLY direction of effect: Epoch applies results through its OWN authority. */
  effectDirection: 'arena-to-epoch-read-only-projection' as const,
} as const);

export type EpochEscalationAuthorityClause =
  (typeof EPOCH_ESCALATION_AUTHORITY_BOUNDARY)['clauses'][number];

/**
 * The closed set of Epoch-authoritative stores (EPI1.0 "Authority").
 * Present ONLY as a nominal, non-instantiable marker for the adversarial
 * fail-closed surface — the adapter accepts no value of this type
 * anywhere in its public surface.
 */
export const EPOCH_AUTHORITATIVE_STORES = Object.freeze([
  'world-model',
  'action-gateway',
  'constraint-engine',
  'approved-baselines',
  'delivery-state',
] as const);
export type EpochAuthoritativeStore = (typeof EPOCH_AUTHORITATIVE_STORES)[number];

/**
 * A write attempt against an Epoch authoritative store. This type exists
 * so the denial is PROVABLE: constructing one is possible (it is plain
 * data — an attacker may type anything), but SUBMITTING it anywhere in
 * this package fails closed with the typed authority violation.
 */
export interface EpochAuthoritativeWriteAttempt {
  readonly attemptKind: 'epoch-authoritative-write-attempt';
  readonly store: EpochAuthoritativeStore;
  readonly requestId?: string;
}

export function isEpochAuthoritativeWriteAttempt(
  value: unknown,
): value is EpochAuthoritativeWriteAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['attemptKind'] === 'epoch-authoritative-write-attempt' &&
    (EPOCH_AUTHORITATIVE_STORES as readonly string[]).includes(String(candidate['store']))
  );
}

/**
 * THE fail-closed denial surface. Every call — without exception —
 * throws the typed EPOCH_ESCALATION_WRITEBACK_FORBIDDEN error. This
 * function never inspects, never delegates and never writes: it is the
 * structural proof that lock rule 15 ("no direct Arena writes to Epoch
 * authoritative stores") cannot be bypassed through this adapter.
 */
export function attemptEpochAuthoritativeWrite(attempt: unknown): never {
  const described = isEpochAuthoritativeWriteAttempt(attempt)
    ? `write attempt against Epoch ${attempt.store}`
    : `write attempt ${JSON.stringify(attempt)}`;
  throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.WRITEBACK_FORBIDDEN, {
    message: `${described} is forbidden: Arena never writes to Epoch authoritative stores (EPI1.0 Authority; architecture-lock rules 13-15, 36). Epoch consumes the typed delivery and applies it through its OWN authority.`,
    details: {
      boundary: EPOCH_ESCALATION_AUTHORITY_BOUNDARY.protocol,
      stores: EPOCH_AUTHORITATIVE_STORES,
    },
  });
}

/**
 * Machine-readable authority verdict for a PROPOSED delivery action
 * (never a bare boolean). Only `observe-delivery` is permitted: the
 * Epoch side reads the projection; application happens in Epoch.
 */
export type EpochDeliveryActionVerdict =
  | { readonly outcome: 'permitted'; readonly action: 'observe-delivery' }
  | {
      readonly outcome: 'forbidden';
      readonly action: string;
      readonly clause: EpochEscalationAuthorityClause;
    };

export function checkEpochDeliveryAction(action: string): EpochDeliveryActionVerdict {
  if (action === 'observe-delivery') {
    return { outcome: 'permitted', action: 'observe-delivery' };
  }
  return {
    outcome: 'forbidden',
    action,
    clause: 'no-epoch-world-model-mutation',
  };
}
