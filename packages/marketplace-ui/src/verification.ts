/**
 * Verification status view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * Verification status renders under its OWN truth class: a status is decided
 * ONLY by recorded verification outcomes (A013 verification records surfaced
 * as marketplace admission evidence) — never by marketplace admission,
 * ownership, or purchase. A decided outcome (`pass`/`fail`) renders as a
 * verified fact; an undecided one renders as unknown; a pending check
 * renders as pending. The classes never collapse.
 */

import {
  asRecord,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  readString,
  VERIFICATION_CLASS_NOTE,
} from './shared.js';

/** The closed verification-status vocabulary. */
export type VerificationStatusKind =
  | 'verified'
  | 'failed'
  | 'unknown-outcome'
  | 'none'
  | 'malformed';

/** One verification evidence entry (address + outcome, honestly read). */
export interface VerificationEvidenceEntryView {
  readonly kind: string | undefined;
  /** The evidence address (the verification record digest). */
  readonly address: string | undefined;
  /** The recorded outcome: `pass` | `fail` | `unknown` (undefined when none). */
  readonly outcome: string | undefined;
}

/** The verification status every listing view model carries. */
export interface VerificationStatus {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  /** Decided outcomes are verified facts; undecided render as unknown. */
  readonly truthClass: 'verified-fact' | 'unknown';
  readonly status: VerificationStatusKind;
  readonly statusLabel: string;
  readonly entries: readonly VerificationEvidenceEntryView[];
  readonly scopeNote: string;
  readonly unknownFields: readonly string[];
}

const VERIFICATION_STATUS_LABELS: Readonly<Record<VerificationStatusKind, string>> =
  Object.freeze({
    verified: 'Verification passed',
    failed: 'Verification failed',
    'unknown-outcome': 'Verification undecided',
    none: 'No verification evidence',
    malformed: 'Verification evidence unreadable',
  } as const);

/**
 * Build the verification status from an evidence-entries array (the
 * marketplace admission evidence shape: `{ kind, digest, outcome }`, where
 * `kind` may be `provenance` with a null outcome — a chain entry, not a
 * verification outcome).
 *
 * Honest: malformed entries are skipped and recorded; a missing array yields
 * `none` (rendered explicitly, never guessed as verified).
 */
export function buildVerificationStatus(evidence: unknown): VerificationStatus {
  const unknownFields: string[] = [];
  const entries: VerificationEvidenceEntryView[] = [];

  if (evidence === undefined || evidence === null) {
    // No evidence supplied: the listing carries no verification section —
    // an honest `none`, not a malformed marker.
  } else if (!Array.isArray(evidence)) {
    unknownFields.push('evidence');
  } else {
    evidence.forEach((entry, index) => {
      const data = asRecord(entry);
      const kind = readString(data, 'kind');
      const digest = readString(data, 'digest');
      const evidenceAddress = readString(asRecord(data['evidence']), 'digest');
      const address = digest ?? evidenceAddress;
      const outcomeValue = data['outcome'];
      const outcome =
        typeof outcomeValue === 'string' && outcomeValue.length > 0
          ? outcomeValue
          : undefined;
      if (kind === undefined && address === undefined) {
        unknownFields.push(`evidence[${String(index)}] (malformed)`);
        return;
      }
      entries.push(Object.freeze({ kind, address, outcome }));
    });
  }

  let pass = false;
  let fail = false;
  let undecided = false;
  for (const entry of entries) {
    if (entry.outcome === 'pass') pass = true;
    else if (entry.outcome === 'fail') fail = true;
    else if (entry.outcome !== undefined) undecided = true;
  }

  let status: VerificationStatusKind;
  let truthClass: 'verified-fact' | 'unknown';
  if (entries.length === 0 && unknownFields.length > 0) {
    status = 'malformed';
    truthClass = 'unknown';
  } else if (fail) {
    status = 'failed';
    truthClass = 'verified-fact';
  } else if (pass) {
    status = 'verified';
    truthClass = 'verified-fact';
  } else if (entries.length === 0) {
    status = 'none';
    truthClass = 'unknown';
  } else {
    status = undecided ? 'unknown-outcome' : 'none';
    truthClass = 'unknown';
  }

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    truthClass,
    status,
    statusLabel: VERIFICATION_STATUS_LABELS[status],
    entries: Object.freeze(entries),
    scopeNote: VERIFICATION_CLASS_NOTE,
    unknownFields: Object.freeze(unknownFields),
  } satisfies VerificationStatus);
}

/** The closed status label (rendering helper). */
export function verificationStatusLabel(status: VerificationStatusKind): string {
  return VERIFICATION_STATUS_LABELS[status];
}
