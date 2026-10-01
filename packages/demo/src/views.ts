/**
 * Demo record display summaries (Work Order B006; issue #73).
 *
 * Pure, deterministic projections of demo-corpus canonical reads into
 * small view shapes the demo UI renders. The corpus shape knowledge
 * lives HERE (domain), not in the web layer. Every summary carries the
 * product-truth label the datum must display, so no demo-rendered datum
 * can appear unlabelled.
 */

import type { CanonicalRead } from '@arena/read-model';

import { DEMO_ERROR_CODES, DemoError } from './errors.js';
import { isProductTruthLabel, type ProductTruthLabel } from './shared.js';

/** Version of the demo view projections. */
export const DEMO_VIEW_VERSION = 1 as const;

/** A display-safe summary of one demo corpus record. */
export interface DemoRecordSummary {
  readonly viewVersion: typeof DEMO_VIEW_VERSION;
  readonly recordId: string;
  readonly kind: string;
  /** Human title for the record. */
  readonly title: string;
  /** One-sentence summary (calm, factual). */
  readonly summary: string;
  /** The product-truth label this datum must display. */
  readonly truth: ProductTruthLabel;
  /** Compact key facts (label + text), rendered as definition rows. */
  readonly facts: readonly { readonly label: string; readonly text: string }[];
}

function asRecord(data: unknown): Readonly<Record<string, unknown>> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
      message: 'demo record data must be a JSON object',
      details: { receivedType: typeof data },
    });
  }
  return data as Readonly<Record<string, unknown>>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function factRow(label: string, text: string): { readonly label: string; readonly text: string } {
  return Object.freeze({ label, text }) as { label: string; text: string };
}

/**
 * Project ONE demo corpus canonical read into its display summary.
 * Fails closed (DEMO_UNKNOWN_RECORD) on records outside the demo corpus
 * vocabulary, and on missing/invalid product-truth labels.
 */
export function describeDemoRecord(read: CanonicalRead): DemoRecordSummary {
  const data = asRecord(read.data);
  const base = {
    viewVersion: DEMO_VIEW_VERSION,
    recordId: read.recordId,
    kind: read.kind,
  };
  switch (read.recordId) {
    case 'demo.agent-body.software-engineer':
    case 'demo.agent-body.structural-engineer': {
      const manifest = asRecord(data['manifestSummary'] ?? {});
      const lineage = asRecord(data['lineage'] ?? {});
      return Object.freeze({
        ...base,
        title: str(data['displayName']),
        summary: `${str(data['derivedFrom'])}; lineage ${str(lineage['initialVersion'])} → ${str(lineage['currentVersion'])}.`,
        truth: 'verified-fact',
        facts: Object.freeze([
          factRow('Body id', str(data['bodyId'])),
          factRow('Current version', str(lineage['currentVersion'])),
          factRow('Tools', str(manifest['tools'])),
          factRow('Skills', str(manifest['skills'])),
          factRow('Substrate possessions', 'composition-scoped'),
        ]),
      });
    }
    case 'demo.capability-case.payments-reliability': {
      const tasks = Array.isArray(data['tasks']) ? data['tasks'].length : 0;
      return Object.freeze({
        ...base,
        title: str(data['title']),
        summary: `${tasks} tasks; trajectory replay, evaluation, verification and an Epoch suggestion in one case.`,
        truth: 'simulation-replay',
        facts: Object.freeze([
          factRow('Lifecycle', str(data['lifecycle'])),
          factRow('Assigned body', `${str(asRecord(data['assignedBody'] ?? {})['bodyId'])}@${str(asRecord(data['assignedBody'] ?? {})['bodyVersion'])}`),
          factRow('Tasks', String(tasks)),
          factRow('Trajectory events', String(Array.isArray(data['trajectory']) ? data['trajectory'].length : 0)),
        ]),
      });
    }
    case 'demo.certification.software-engineer-v1-1-0': {
      const subject = asRecord(data['subject'] ?? {});
      return Object.freeze({
        ...base,
        title: `Certification — ${str(subject['bodyId'])}@${str(subject['bodyVersion'])}`,
        summary: `${str(data['basis'])}.`,
        truth: 'certification',
        facts: Object.freeze([
          factRow('Verdict', str(data['verdict'])),
          factRow('Kind', str(data['certificationKind'])),
          factRow('Certified at', str(data['certifiedAt'])),
        ]),
      });
    }
    case 'demo.expert-qualification.structural-review': {
      const judgment = asRecord(data['judgment'] ?? {});
      return Object.freeze({
        ...base,
        title: `Expert qualification — ${str(data['domain'])}`,
        summary: `${str(judgment['summary'])}`,
        truth: 'expert-judgment',
        facts: Object.freeze([
          factRow('Expert', str(data['expertId'])),
          factRow('Scope', Array.isArray(data['scope']) ? data['scope'].map(str).join(', ') : str(data['scope'])),
          factRow('Basis', str(judgment['basis'])),
        ]),
      });
    }
    default:
      throw new DemoError(DEMO_ERROR_CODES.UNKNOWN_RECORD, {
        message: `record ${JSON.stringify(read.recordId)} is not part of the demo corpus vocabulary`,
        details: { recordId: read.recordId },
      });
  }
}

/**
 * Project a narrative step's canonical reads into summaries, asserting
 * the step's product-truth label is valid (fail closed on drift).
 */
export function describeDemoStepReads(
  stepTruth: ProductTruthLabel,
  reads: readonly CanonicalRead[],
): readonly DemoRecordSummary[] {
  if (!isProductTruthLabel(stepTruth)) {
    throw new DemoError(DEMO_ERROR_CODES.INVALID_INPUT, {
      message: `invalid product-truth label ${JSON.stringify(String(stepTruth))}`,
      details: { truth: String(stepTruth) },
    });
  }
  return Object.freeze(reads.map((read) => describeDemoRecord(read)));
}
