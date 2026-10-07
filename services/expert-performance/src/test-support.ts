/**
 * Fakes for the injected dep source ports (Work Order C005 test support —
 * the @arena/expert-calibration-service test-support convention).
 *
 * Each fake owns an in-memory dep-record store keyed by the dep record's
 * content digest and answers a lookup ONLY when the record exists AND
 * belongs to the requested (tenant, expert) — mirroring the provenance
 * discipline the real C004/A007/A019/A020 read surfaces enforce.
 */

import type {
  CalibrationVerdictSourceData,
  LearningAttributionSourceData,
  MatchHistorySourceData,
  QualificationRecordSourceData,
  SkillExtractionSourceData,
} from '@arena/expert-performance';
import type {
  CalibrationVerdictSourcePort,
  EvidenceSourceLookup,
  ExpertPerformanceSourcePorts,
  LearningAttributionSourcePort,
  QualificationHistorySourcePort,
  SkillExtractionSourcePort,
} from './ports.js';

interface Owned<TReturn> {
  readonly tenant: string;
  readonly expertId: string;
  readonly data: TReturn;
}

function answer<TReturn>(lookup: EvidenceSourceLookup, owned: Owned<TReturn> | undefined): TReturn | null {
  if (owned === undefined) return null;
  if (owned.tenant !== lookup.tenant || owned.expertId !== lookup.expertId) return null;
  return owned.data;
}

/** The C004 fake: calibration verdicts keyed by their record digest. */
export class InMemoryCalibrationVerdictSource implements CalibrationVerdictSourcePort {
  private readonly store = new Map<string, Owned<CalibrationVerdictSourceData>>();

  add(tenant: string, expertId: string, data: CalibrationVerdictSourceData): this {
    this.store.set(data.recordDigest, { tenant, expertId, data });
    return this;
  }

  async resolveCalibrationVerdict(
    lookup: EvidenceSourceLookup,
  ): Promise<CalibrationVerdictSourceData | null> {
    return answer(lookup, this.store.get(lookup.refDigest));
  }
}

/** The A007 fake: qualification records + match-history entries. */
export class InMemoryQualificationHistorySource implements QualificationHistorySourcePort {
  private readonly qualifications = new Map<string, Owned<QualificationRecordSourceData>>();
  private readonly matches = new Map<string, Owned<MatchHistorySourceData>>();

  addQualification(tenant: string, expertId: string, data: QualificationRecordSourceData): this {
    this.qualifications.set(data.recordDigest, { tenant, expertId, data });
    return this;
  }

  addMatch(tenant: string, expertId: string, data: MatchHistorySourceData): this {
    this.matches.set(data.recordDigest, { tenant, expertId, data });
    return this;
  }

  async resolveQualificationRecord(
    lookup: EvidenceSourceLookup,
  ): Promise<QualificationRecordSourceData | null> {
    return answer(lookup, this.qualifications.get(lookup.refDigest));
  }

  async resolveMatchHistoryEntry(lookup: EvidenceSourceLookup): Promise<MatchHistorySourceData | null> {
    return answer(lookup, this.matches.get(lookup.refDigest));
  }
}

/** The A019 fake: skill-extraction outcomes. */
export class InMemorySkillExtractionSource implements SkillExtractionSourcePort {
  private readonly store = new Map<string, Owned<SkillExtractionSourceData>>();

  add(tenant: string, expertId: string, data: SkillExtractionSourceData): this {
    this.store.set(data.recordDigest, { tenant, expertId, data });
    return this;
  }

  async resolveSkillExtractionOutcome(
    lookup: EvidenceSourceLookup,
  ): Promise<SkillExtractionSourceData | null> {
    return answer(lookup, this.store.get(lookup.refDigest));
  }
}

/** The A020 fake: learning-experiment attribution records. */
export class InMemoryLearningAttributionSource implements LearningAttributionSourcePort {
  private readonly store = new Map<string, Owned<LearningAttributionSourceData>>();

  add(tenant: string, expertId: string, data: LearningAttributionSourceData): this {
    this.store.set(data.recordDigest, { tenant, expertId, data });
    return this;
  }

  async resolveAttributionRecord(
    lookup: EvidenceSourceLookup,
  ): Promise<LearningAttributionSourceData | null> {
    return answer(lookup, this.store.get(lookup.refDigest));
  }
}

/** A port that resolves NOTHING (provenance-tampering fixture). */
export class UnresolvingSourcePort {
  async resolveCalibrationVerdict(): Promise<null> {
    return null;
  }

  async resolveQualificationRecord(): Promise<null> {
    return null;
  }

  async resolveMatchHistoryEntry(): Promise<null> {
    return null;
  }

  async resolveSkillExtractionOutcome(): Promise<null> {
    return null;
  }

  async resolveAttributionRecord(): Promise<null> {
    return null;
  }
}

/** A full fake port set (all four dep surfaces + the unresolving fixture). */
export interface FakeSourcePortSet {
  readonly ports: ExpertPerformanceSourcePorts;
  readonly calibration: InMemoryCalibrationVerdictSource;
  readonly qualification: InMemoryQualificationHistorySource;
  readonly skillExtraction: InMemorySkillExtractionSource;
  readonly learning: InMemoryLearningAttributionSource;
  readonly unresolving: UnresolvingSourcePort;
}

export function fakeSourcePorts(): FakeSourcePortSet {
  const calibration = new InMemoryCalibrationVerdictSource();
  const qualification = new InMemoryQualificationHistorySource();
  const skillExtraction = new InMemorySkillExtractionSource();
  const learning = new InMemoryLearningAttributionSource();
  const unresolving = new UnresolvingSourcePort();
  return {
    ports: { calibration, qualification, skillExtraction, learning },
    calibration,
    qualification,
    skillExtraction,
    learning,
    unresolving,
  };
}
