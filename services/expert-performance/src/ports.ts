/**
 * The injected PORTS of the expert-performance reference service (Work
 * Order C005; spec/service-boundaries.md).
 *
 * The service NEVER writes into another surface's state: every piece of
 * evidence arrives by RESOLVING a dep record through the PUBLIC read
 * ports declared here (the C004/A007/A019/A020 seams). The ports are
 * data-in seams — the real fabrics implement them; tests inject fakes.
 *
 *   - CalibrationVerdictSourcePort  — the C004 seam: calibration drift
 *     verdicts (the DemonstratedPerformance read surface);
 *   - QualificationHistorySourcePort — the A007 seam: qualification
 *     records (status + declared domain/jurisdiction fit + conflicts) and
 *     matching-history entries (engagement/review/agreement outcomes);
 *   - SkillExtractionSourcePort     — the A019 seam: skill-extraction
 *     outcomes from validated trajectories;
 *   - LearningAttributionSourcePort — the A020 seam: learning-experiment
 *     attribution records (the LE1.0 attribution vocabulary).
 *
 * PROVENANCE DISCIPLINE: a resolve call returns the dep record data ONLY
 * when it exists AND belongs to the requested (tenant, expert) — a
 * fabricated or cross-tenant source digest resolves to null and the
 * ingestion fails closed. PERFORMANCE EVIDENCE IS DATA, NEVER AN ACCESS
 * GRANT (lock rules 9/35): there is deliberately NO port method that
 * grants, implies or records a permission.
 */

import type {
  CalibrationVerdictSourceData,
  LearningAttributionSourceData,
  MatchHistorySourceData,
  QualificationRecordSourceData,
  SkillExtractionSourceData,
} from '@arena/expert-performance';

/** The provenance-addressed lookup every source port resolves by. */
export interface EvidenceSourceLookup {
  readonly tenant: string;
  readonly expertId: string;
  /** The content digest of the dep record the evidence derives from. */
  readonly refDigest: string;
}

/** The C004 public port calibration-verdict evidence accumulates from. */
export interface CalibrationVerdictSourcePort {
  resolveCalibrationVerdict(
    lookup: EvidenceSourceLookup,
  ): Promise<CalibrationVerdictSourceData | null>;
}

/** The A007 public port qualification + match-history evidence accumulates from. */
export interface QualificationHistorySourcePort {
  resolveQualificationRecord(
    lookup: EvidenceSourceLookup,
  ): Promise<QualificationRecordSourceData | null>;
  resolveMatchHistoryEntry(lookup: EvidenceSourceLookup): Promise<MatchHistorySourceData | null>;
}

/** The A019 public port skill-extraction evidence accumulates from. */
export interface SkillExtractionSourcePort {
  resolveSkillExtractionOutcome(lookup: EvidenceSourceLookup): Promise<SkillExtractionSourceData | null>;
}

/** The A020 public port learning-attribution evidence accumulates from. */
export interface LearningAttributionSourcePort {
  resolveAttributionRecord(lookup: EvidenceSourceLookup): Promise<LearningAttributionSourceData | null>;
}

/** The full injected source-port set (one per merged dep surface). */
export interface ExpertPerformanceSourcePorts {
  readonly calibration: CalibrationVerdictSourcePort;
  readonly qualification: QualificationHistorySourcePort;
  readonly skillExtraction: SkillExtractionSourcePort;
  readonly learning: LearningAttributionSourcePort;
}
