/**
 * @arena/compatibility — compatibility evaluation engine (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Pure TypeScript evaluation over BodyVersion requirements × Substrate capabilities.
 * Deterministic, pure where possible, typed closed verdict vocabulary.
 */

import {
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  isSubstrateCompatibilityProfile,
  isCognitiveSubstrate,
  TOOL_CALLING_LEVELS,
} from '@arena/agent-body';
import { createCompatibilityResult } from './shared.js';
import { CompatibilityError, COMPATIBILITY_ERROR_CODES } from './errors.js';
import type { CompatibilityResult, CompatibilityVerdictKind } from './shared.js';

// Evaluation context
export interface CompatibilityEvaluationContext {
  readonly tenantId?: string;
  readonly workspaceId?: string;
}

// Compatibility evaluation options
export interface CompatibilityEvaluationOptions {
  readonly context?: CompatibilityEvaluationContext;
  readonly includeDetails?: boolean;
  readonly failClosed?: boolean;
}

/**
 * Evaluate compatibility between a body version's requirements and a substrate's capabilities.
 *
 * This is a pure capability predicate, never an identity claim. It evaluates:
 * - Required modalities match
 * - Required tool-calling level is supported
 * - Context requirements are met
 * - Prohibited conditions are absent
 *
 * Cost constraints, required evaluation suites and substrate adaptations are
 * declarative certification inputs (spec AB1.0) — they are carried on the
 * profile for the certification services and are NOT evaluated here.
 */
export async function evaluateBodySubstrateCompatibility(
  bodyProfile: SubstrateCompatibilityProfile,
  substrate: CognitiveSubstrate,
  options: CompatibilityEvaluationOptions = {},
): Promise<CompatibilityResult> {
  const { includeDetails = true, failClosed = true } = options;

  // Validate inputs
  if (!isSubstrateCompatibilityProfile(bodyProfile)) {
    throw new CompatibilityError(COMPATIBILITY_ERROR_CODES.INVALID_INPUT, {
      message: 'invalid body compatibility profile',
      details: { profile: bodyProfile },
    });
  }

  if (!isCognitiveSubstrate(substrate)) {
    throw new CompatibilityError(COMPATIBILITY_ERROR_CODES.INVALID_INPUT, {
      message: 'invalid cognitive substrate',
      details: { substrate },
    });
  }

  const reasons: string[] = [];
  const details: Record<string, unknown> = {};

  // 1. Check required modalities
  const substrateModalities = new Set<string>(substrate.modalityProfile);
  const missingModalities = bodyProfile.requiredModalities.filter(
    (required) => !substrateModalities.has(required),
  );

  if (missingModalities.length > 0) {
    reasons.push(`missing required modalities: ${missingModalities.join(', ')}`);
    details.missingModalities = missingModalities;
  }

  // 2. Check required tool-calling level (closed, ordered vocabulary)
  const requiredLevelIndex = TOOL_CALLING_LEVELS.indexOf(bodyProfile.requiredToolCalling);
  const substrateLevelIndex = TOOL_CALLING_LEVELS.indexOf(substrate.toolCallingProfile);

  if (substrateLevelIndex < requiredLevelIndex) {
    reasons.push(`insufficient tool-calling level: required ${bodyProfile.requiredToolCalling}, substrate provides ${substrate.toolCallingProfile}`);
    details.toolCallingMismatch = {
      required: bodyProfile.requiredToolCalling,
      actual: substrate.toolCallingProfile,
    };
  }

  // 3. Check context requirements
  if (substrate.contextLimits.maxContextUnits < bodyProfile.contextRequirements.minContextUnits) {
    reasons.push(`insufficient context capacity: required ${bodyProfile.contextRequirements.minContextUnits}, substrate provides ${substrate.contextLimits.maxContextUnits}`);
    details.contextMismatch = {
      required: bodyProfile.contextRequirements.minContextUnits,
      actual: substrate.contextLimits.maxContextUnits,
    };
  }

  // 4. Check prohibited conditions
  const substrateConditions = new Set<string>(substrate.conditions);
  const prohibitedConditions = bodyProfile.prohibitedConditions.filter(
    (prohibited) => substrateConditions.has(prohibited),
  );

  if (prohibitedConditions.length > 0) {
    reasons.push(`prohibited conditions present: ${prohibitedConditions.join(', ')}`);
    details.prohibitedConditions = prohibitedConditions;
  }

  // Determine verdict based on failures
  let verdict: CompatibilityVerdictKind;

  if (reasons.length === 0) {
    verdict = 'compatible';
  } else {
    verdict = failClosed ? 'incompatible-with-reasons' : 'unknown-with-structured-causes';
  }

  // Return result
  return createCompatibilityResult(verdict, reasons, includeDetails ? details : undefined);
}

/**
 * Batch compatibility evaluation for multiple substrates against a single body profile.
 */
export async function evaluateMultipleSubstrates(
  bodyProfile: SubstrateCompatibilityProfile,
  substrates: readonly CognitiveSubstrate[],
  options: CompatibilityEvaluationOptions = {},
): Promise<readonly CompatibilityResult[]> {
  const results: CompatibilityResult[] = [];

  for (const substrate of substrates) {
    try {
      const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate, options);
      results.push(result);
    } catch (error) {
      if (error instanceof CompatibilityError) {
        results.push(createCompatibilityResult(
          'incompatible-with-reasons',
          [error.message],
          { error: error.code, details: error.details }
        ));
      } else {
        results.push(createCompatibilityResult(
          'incompatible-with-reasons',
          ['evaluation error'],
          { error: 'EVALUATION_ERROR' }
        ));
      }
    }
  }

  return results;
}

/**
 * Check if a substrate is compatible with a body profile (boolean shortcut).
 *
 * WARNING: This is a convenience function only. For detailed analysis,
 * use evaluateBodySubstrateCompatibility() which provides reasons and details.
 */
export async function isCompatible(
  bodyProfile: SubstrateCompatibilityProfile,
  substrate: CognitiveSubstrate,
  options: CompatibilityEvaluationOptions = {},
): Promise<boolean> {
  const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate, options);
  return result.verdict === 'compatible';
}
