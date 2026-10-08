/**
 * Dimensional economics aggregates (Work Order C016) — the read models
 * over compiled unit-economics records.
 *
 * AGGREGATION DISCIPLINE (mirrors the C005 no-single-global-score law):
 *   - aggregates are SINGLE-DIMENSION and SINGLE-METRIC — there is no
 *     collapsed "ROI score" type, and exact-field validation rejects
 *     smuggled score-shaped keys (typed COLLAPSED_SCORE);
 *   - every aggregate DISCLOSES its formula (closed expression
 *     vocabulary), sample size, population size, excluded count,
 *     small-sample status (explicit below the policy threshold) and its
 *     known limitations (closed vocabulary) — never a bare number;
 *   - deterministic given identical inputs: all figures are canonical
 *     fixed-point strings computed with BigInt arithmetic — floating
 *     point never touches a figure;
 *   - multi-currency inputs fail closed (MIXED_CURRENCY): currency is
 *     representation-only, never converted;
 *   - demo and customer records never mix in one aggregate
 *     (MIXED_TRUTH): demo money is not customer money;
 *   - records missing the dimension's source field are EXCLUDED and
 *     counted — never silently dropped.
 */

import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';
import type { EconomicsMetric, EconomicsPolicy } from './policy.js';
import { isEconomicsMetric, isEconomicsPolicy } from './policy.js';
import type { UnitEconomicsRecord } from './record.js';
import { isUnitEconomicsRecord } from './record.js';
import type { EconomicsTimestamp } from './shared.js';
import { rejectCollapsedScoreFields, rejectUnknownFields, toEconomicsTimestamp } from './shared.js';

/** Wire version of the aggregate shape. */
export const ECONOMICS_AGGREGATE_VERSION = 1 as const;

/** The closed dimension vocabulary. */
export const ECONOMICS_DIMENSIONS = Object.freeze([
  'capability',
  'domain',
  'tenant',
  'resource-class',
  'validation-outcome',
] as const);
export type EconomicsDimension = (typeof ECONOMICS_DIMENSIONS)[number];

export function isEconomicsDimension(value: unknown): value is EconomicsDimension {
  return typeof value === 'string' && (ECONOMICS_DIMENSIONS as readonly string[]).includes(value);
}

/** The closed limitation vocabulary every aggregate discloses from. */
export const ECONOMICS_AGGREGATE_LIMITATIONS = Object.freeze([
  'small-sample',
  'multi-currency-unconverted',
  'refunds-may-exceed-capture',
  'unsettled-ledgers-included',
  'no-validated-results-in-sample',
  'no-captured-gross-in-sample',
  'value-side-partial-coverage',
  'effort-signals-partial-coverage',
  'routing-class-unknown-for-some-records',
  'dimension-field-missing-for-some-records',
] as const);
export type EconomicsAggregateLimitation = (typeof ECONOMICS_AGGREGATE_LIMITATIONS)[number];

/**
 * The closed formula-expression vocabulary — the disclosed formula of
 * each metric (one expression per metric id; never a hidden formula).
 */
export const ECONOMICS_METRIC_FORMULAS: Readonly<Record<EconomicsMetric, string>> =
  Object.freeze({
    'mean-net-cost-per-intervention':
      'mean over records of clamp0(grossCaptured - refunded), minor units, fixed 4 decimals',
    'cost-per-validated-result':
      'sum clamp0(grossCaptured - refunded) over verdict=accepted records / count(verdict=accepted), minor units, fixed 4 decimals',
    'expert-payout-share-of-gross':
      'sum(expertPayout) / sum(grossCaptured) over records, fixed 4 decimals (0..1)',
    'mean-effort-minutes-per-intervention':
      'mean over records with effort of sessionDurationMinutes, minutes, fixed 4 decimals',
    'verified-lift-per-effort-hour':
      'sum(verifiedLiftPoints) * 60 / sum(sessionDurationMinutes) over records with verified lift AND effort, lift-points per hour, fixed 4 decimals',
  } as const);

/** Canonical fixed-point string: 4 fractional digits, no sign. */
export const FIXED_POINT_4_PATTERN_SOURCE = '^\\d+\\.\\d{4}$';

export interface EconomicsAggregate {
  readonly aggregateVersion: typeof ECONOMICS_AGGREGATE_VERSION;
  readonly dimension: EconomicsDimension;
  readonly dimensionValue: string;
  readonly metric: EconomicsMetric;
  /** The disclosed formula (closed vocabulary — see ECONOMICS_METRIC_FORMULAS). */
  readonly formula: string;
  /** The value, canonical fixed-point string (4 decimals; BigInt-derived). */
  readonly value: string;
  readonly currency: string;
  readonly truth: 'demo' | 'customer';
  /** The records the metric actually averaged over. */
  readonly sampleSize: number;
  /** The records seen for the dimension value (before metric exclusions). */
  readonly populationSize: number;
  /** Records excluded because the dimension field or metric input was missing. */
  readonly excludedCount: number;
  /** Explicit small-sample status (sampleSize < policy.smallSampleMinimum). */
  readonly smallSample: boolean;
  readonly limitations: readonly EconomicsAggregateLimitation[];
  readonly policyId: string;
  readonly policyVersion: number;
  readonly disclosureNote: string;
  readonly generatedAt: EconomicsTimestamp;
}

export const ECONOMICS_AGGREGATE_FIELDS = Object.freeze([
  'aggregateVersion',
  'dimension',
  'dimensionValue',
  'metric',
  'formula',
  'value',
  'currency',
  'truth',
  'sampleSize',
  'populationSize',
  'excludedCount',
  'smallSample',
  'limitations',
  'policyId',
  'policyVersion',
  'disclosureNote',
  'generatedAt',
] as const);

export function isEconomicsAggregate(value: unknown): value is EconomicsAggregate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['aggregateVersion'] !== ECONOMICS_AGGREGATE_VERSION) return false;
  if (!isEconomicsDimension(candidate['dimension'])) return false;
  if (typeof candidate['dimensionValue'] !== 'string' || candidate['dimensionValue'].length < 1) {
    return false;
  }
  if (!isEconomicsMetric(candidate['metric'])) return false;
  if (typeof candidate['formula'] !== 'string' || candidate['formula'].length < 1) return false;
  if (
    typeof candidate['value'] !== 'string' ||
    !new RegExp(FIXED_POINT_4_PATTERN_SOURCE).test(candidate['value'])
  ) {
    return false;
  }
  if (typeof candidate['currency'] !== 'string' || !/^[A-Z]{3}$/.test(candidate['currency'])) {
    return false;
  }
  if (candidate['truth'] !== 'demo' && candidate['truth'] !== 'customer') return false;
  for (const countField of ['sampleSize', 'populationSize', 'excludedCount'] as const) {
    const raw = candidate[countField];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return false;
  }
  if (typeof candidate['smallSample'] !== 'boolean') return false;
  if (!Array.isArray(candidate['limitations'])) return false;
  rejectUnknownFields(candidate, ECONOMICS_AGGREGATE_FIELDS, 'EconomicsAggregate');
  rejectCollapsedScoreFields(candidate, 'EconomicsAggregate');
  return true;
}

// ---------------------------------------------------------------------------
// Fixed-point arithmetic (BigInt only — no floats, ever)
// ---------------------------------------------------------------------------

const SCALE = 10_000n; // 4 fractional digits

/** Render a BigInt scaled by 10^4 as a canonical fixed-4-decimals string. */
function toFixed4(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  const text = `${whole.toString(10)}.${frac.toString(10).padStart(4, '0')}`;
  // Money-law discipline: figures are never negative — clamp at zero and
  // let the caller disclose the limitation.
  return negative ? '0.0000' : text;
}

/** Divide with 4-decimal fixed-point scaling (BigInt-only). */
function ratioFixed4(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return '0.0000';
  return toFixed4((numerator * SCALE) / denominator);
}

function minorToBigInt(record: UnitEconomicsRecord, field: 'grossCapturedMinorUnits'): bigint;
function minorToBigInt(record: UnitEconomicsRecord, field: 'refundedMinorUnits'): bigint;
function minorToBigInt(record: UnitEconomicsRecord, field: 'platformFeeMinorUnits'): bigint;
function minorToBigInt(record: UnitEconomicsRecord, field: 'expertPayoutMinorUnits'): bigint;
function minorToBigInt(
  record: UnitEconomicsRecord,
  field:
    | 'grossCapturedMinorUnits'
    | 'refundedMinorUnits'
    | 'platformFeeMinorUnits'
    | 'expertPayoutMinorUnits',
): bigint {
  const raw =
    field === 'grossCapturedMinorUnits'
      ? record.commercial.grossCapturedMinorUnits
      : field === 'refundedMinorUnits'
        ? record.commercial.refundedMinorUnits
        : field === 'platformFeeMinorUnits'
          ? record.commercial.platformFeeMinorUnits
          : record.commercial.expertPayoutMinorUnits;
  return BigInt(raw);
}

/** Net customer spend of one record: clamp0(captured - refunded). */
export function netSpendMinorUnitsOf(record: UnitEconomicsRecord): bigint {
  const net = minorToBigInt(record, 'grossCapturedMinorUnits') - minorToBigInt(
    record,
    'refundedMinorUnits',
  );
  return net < 0n ? 0n : net;
}

// ---------------------------------------------------------------------------
// Dimension extraction
// ---------------------------------------------------------------------------

function dimensionValueOf(
  record: UnitEconomicsRecord,
  dimension: EconomicsDimension,
): string | null {
  switch (dimension) {
    case 'capability':
      return record.context.capabilityId;
    case 'domain':
      return record.context.domain;
    case 'tenant':
      return record.tenantId;
    case 'resource-class':
      return record.routing !== null ? record.routing.primaryResourceClass : null;
    case 'validation-outcome':
      return record.validation !== null ? record.validation.verdict : 'none';
  }
}

// ---------------------------------------------------------------------------
// The aggregation fold
// ---------------------------------------------------------------------------

export interface AggregateUnitEconomicsInput {
  readonly dimension: EconomicsDimension;
  readonly metric: EconomicsMetric;
  readonly policy: EconomicsPolicy;
  readonly generatedAt: string | number | Date;
}

/**
 * Fold the records of ONE dimension value into ONE disclosed aggregate.
 * Deterministic given identical inputs; fails closed on mixed currency
 * or mixed truth; records missing the dimension field are excluded and
 * counted (disclosed).
 */
export async function aggregateUnitEconomics(
  records: readonly UnitEconomicsRecord[],
  input: AggregateUnitEconomicsInput,
  dimensionValue: string,
): Promise<EconomicsAggregate> {
  if (!Array.isArray(records)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: 'aggregate input must be an array of unit-economics records',
    });
  }
  if (!isEconomicsDimension(input.dimension)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: `unknown dimension: ${JSON.stringify(input.dimension)}`,
    });
  }
  if (!isEconomicsMetric(input.metric)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: `unknown metric: ${JSON.stringify(input.metric)}`,
    });
  }
  if (!isEconomicsPolicy(input.policy)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: 'aggregate input requires a structurally valid EconomicsPolicy',
    });
  }
  if (!input.policy.metricAllowList.includes(input.metric)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: `metric ${input.metric} is not on the allow-list of policy ${input.policy.policyId} v${input.policy.version}`,
    });
  }

  const inScope: UnitEconomicsRecord[] = [];
  let excludedCount = 0;
  for (const record of records) {
    if (!isUnitEconomicsRecord(record)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_RECORD, {
        message: 'aggregate input contains a structurally invalid unit-economics record',
      });
    }
    const value = dimensionValueOf(record, input.dimension);
    if (value === null || value !== dimensionValue) {
      if (value === null) excludedCount += 1;
      continue;
    }
    inScope.push(record);
  }
  const populationSize = inScope.length;
  if (populationSize === 0) {
    return finalize(input, dimensionValue, '0.0000', 0, 0, excludedCount, []);
  }

  // Truth + currency homogeneity (fail-closed — never mixed, never converted).
  const truth = inScope[0]?.truth;
  const currency = inScope[0]?.currency;
  for (const record of inScope) {
    if (record.truth !== truth) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.MIXED_TRUTH, {
        message: `aggregate refused: demo and customer records cannot mix — demo money is not customer money (dimension ${input.dimension}=${dimensionValue})`,
        details: { dimension: input.dimension, dimensionValue },
      });
    }
    if (record.currency !== currency) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.MIXED_CURRENCY, {
        message: `aggregate refused: ${record.currency} record in a ${currency} aggregate — multi-currency is representation-only, conversion is out of scope (dimension ${input.dimension}=${dimensionValue})`,
        details: { expected: currency, actual: record.currency },
      });
    }
  }

  const limitations = new Set<EconomicsAggregateLimitation>();
  let unsettled = false;
  let refundExceedsCapture = false;
  for (const record of inScope) {
    if (record.commercial.settlementState === 'in-flight') unsettled = true;
    if (
      minorToBigInt(record, 'refundedMinorUnits') >
      minorToBigInt(record, 'grossCapturedMinorUnits')
    ) {
      refundExceedsCapture = true;
    }
  }
  if (unsettled) limitations.add('unsettled-ledgers-included');
  if (refundExceedsCapture) limitations.add('refunds-may-exceed-capture');

  let value: string;
  let sampleSize: number;
  switch (input.metric) {
    case 'mean-net-cost-per-intervention': {
      let sum = 0n;
      for (const record of inScope) sum += netSpendMinorUnitsOf(record);
      value = ratioFixed4(sum, BigInt(populationSize));
      sampleSize = populationSize;
      break;
    }
    case 'cost-per-validated-result': {
      let sum = 0n;
      let validated = 0;
      for (const record of inScope) {
        if (record.validation !== null && record.validation.verdict === 'accepted') {
          sum += netSpendMinorUnitsOf(record);
          validated += 1;
        }
      }
      if (validated === 0) {
        value = '0.0000';
        sampleSize = 0;
        limitations.add('no-validated-results-in-sample');
      } else {
        value = ratioFixed4(sum, BigInt(validated));
        sampleSize = validated;
      }
      break;
    }
    case 'expert-payout-share-of-gross': {
      let payout = 0n;
      let gross = 0n;
      for (const record of inScope) {
        payout += minorToBigInt(record, 'expertPayoutMinorUnits');
        gross += minorToBigInt(record, 'grossCapturedMinorUnits');
      }
      if (gross === 0n) {
        value = '0.0000';
        sampleSize = populationSize;
        limitations.add('no-captured-gross-in-sample');
      } else {
        value = ratioFixed4(payout, gross);
        sampleSize = populationSize;
      }
      break;
    }
    case 'mean-effort-minutes-per-intervention': {
      let sumMinutes = 0n;
      let withEffort = 0;
      for (const record of inScope) {
        if (record.effort !== null && record.effort.sessionDurationMinutes !== null) {
          sumMinutes += BigInt(Math.round(record.effort.sessionDurationMinutes * 1000));
          withEffort += 1;
        }
      }
      if (withEffort === 0) {
        value = '0.0000';
        sampleSize = 0;
        limitations.add('effort-signals-partial-coverage');
      } else {
        // minutes were accumulated at milli-minute precision — rescale.
        value = toFixed4((sumMinutes * SCALE) / (BigInt(withEffort) * 1000n));
        sampleSize = withEffort;
        if (withEffort < populationSize) {
          limitations.add('effort-signals-partial-coverage');
        }
      }
      break;
    }
    case 'verified-lift-per-effort-hour': {
      let lift = 0n;
      let minutes = 0n;
      let contributing = 0;
      for (const record of inScope) {
        const liftPoints = record.value !== null ? record.value.liftPoints : null;
        const minutesRaw =
          record.effort !== null ? record.effort.sessionDurationMinutes : null;
        if (liftPoints !== null && minutesRaw !== null) {
          lift += BigInt(Math.round(liftPoints * 1000));
          minutes += BigInt(Math.round(minutesRaw * 1000));
          contributing += 1;
        }
      }
      if (contributing === 0) {
        value = '0.0000';
        sampleSize = 0;
        limitations.add('value-side-partial-coverage');
      } else {
        // (lift * 60 / minutes), milli-precision inputs rescaled to 4 decimals.
        value = toFixed4((lift * 60n * SCALE) / minutes);
        sampleSize = contributing;
        if (contributing < populationSize) {
          limitations.add('value-side-partial-coverage');
        }
      }
      break;
    }
  }

  return finalize(input, dimensionValue, value, sampleSize, populationSize, excludedCount, [
    ...limitations,
  ]);

  function finalize(
    input: AggregateUnitEconomicsInput,
    dimensionValue: string,
    value: string,
    sampleSize: number,
    populationSize: number,
    excludedCount: number,
    limitationList: readonly EconomicsAggregateLimitation[],
  ): EconomicsAggregate {
    const smallSample = sampleSize < input.policy.smallSampleMinimum;
    const limitations = new Set<EconomicsAggregateLimitation>(limitationList);
    if (smallSample) limitations.add('small-sample');
    if (excludedCount > 0) {
      limitations.add(
        input.dimension === 'resource-class'
          ? 'routing-class-unknown-for-some-records'
          : 'dimension-field-missing-for-some-records',
      );
    }
    const aggregate: EconomicsAggregate = Object.freeze({
      aggregateVersion: ECONOMICS_AGGREGATE_VERSION,
      dimension: input.dimension,
      dimensionValue,
      metric: input.metric,
      formula: ECONOMICS_METRIC_FORMULAS[input.metric],
      value,
      currency: currency ?? 'XXX',
      truth: truth ?? 'demo',
      sampleSize,
      populationSize,
      excludedCount,
      smallSample,
      limitations: Object.freeze([...limitations]),
      policyId: input.policy.policyId,
      policyVersion: input.policy.version,
      disclosureNote: input.policy.disclosureNote,
      generatedAt: toEconomicsTimestamp(input.generatedAt),
    });
    if (!isEconomicsAggregate(aggregate)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
        message: 'folded aggregate failed its own structural guard',
      });
    }
    return aggregate;
  }
}

/**
 * Enumerate the dimension values present in a record set (canonical
 * order: first-seen). Records missing the dimension field are counted
 * as excluded (returned alongside).
 */
export function dimensionValuesOf(
  records: readonly UnitEconomicsRecord[],
  dimension: EconomicsDimension,
): { readonly values: readonly string[]; readonly excludedCount: number } {
  if (!Array.isArray(records)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_AGGREGATE, {
      message: 'dimension enumeration requires an array of unit-economics records',
    });
  }
  const seen = new Set<string>();
  const values: string[] = [];
  let excludedCount = 0;
  for (const record of records) {
    if (!isUnitEconomicsRecord(record)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_RECORD, {
        message: 'dimension enumeration input contains a structurally invalid record',
      });
    }
    const value = dimensionValueOf(record, dimension);
    if (value === null) {
      excludedCount += 1;
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return { values: Object.freeze(values), excludedCount };
}
