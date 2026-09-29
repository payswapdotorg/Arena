/**
 * @arena/compatibility — compatibility evaluation engine (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Pure TypeScript evaluation over BodyVersion requirements × Substrate capabilities.
 * Deterministic, pure where possible, typed closed verdict vocabulary.
 */

import {
  SubstrateCompatibilityProfile,
  CognitiveSubstrate,
  toSubstrateCompatibilityProfile,
  isSubstrateCompatibilityProfile,
} from '@arena/agent-body';
import {
  SubstrateRegistry,
  SubstrateAdapter,
  isCognitiveSubstrate,
  listSubstrateAdapters,
} from '@arena/model-substrate';
import { createCompatibilityResult, isCompatibilityVerdictKind, COMPATIBILITY_VERDICTS } from './shared.js';
import { CompatibilityError, COMPATIBILITY_ERROR_CODES } from './errors.js';
import type { CompatibilityResult, CompatibilityVerdictKind } from './shared.js';

// Evaluation context
export interface CompatibilityEvaluationContext {
  readonly registry: SubstrateRegistry;
  readonly adapters: readonly SubstrateAdapter[];
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
 * - Cost constraints are satisfied (if declared)
 * - Required test suites are available
 * - Prohibited conditions are absent
 * - Substrate-specific adaptations are applicable
 */
export async function evaluateBodySubstrateCompatibility(
  bodyProfile: SubstrateCompatibilityProfile,
  substrate: CognitiveSubstrate,
  options: CompatibilityEvaluationOptions = {},
): Promise<CompatibilityResult> {
  const { context, includeDetails = true, failClosed = true } = options;
  
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
  const missingModalities = bodyProfile.requiredModalities.filter(
    (required: string) => !substrate.capabilities.modalities.includes(required)
  );
  
  if (missingModalities.length > 0) {
    reasons.push(`missing required modalities: ${missingModalities.join(', ')}`);
    details.missingModalities = missingModalities;
  }

  // 2. Check required tool-calling level
  const toolLevels = ['none', 'basic', 'advanced', 'expert'];
  const requiredLevelIndex = toolLevels.indexOf(bodyProfile.requiredToolCalling);
  const substrateLevelIndex = toolLevels.indexOf(substrate.capabilities.toolCallingLevel);
  
  if (substrateLevelIndex < requiredLevelIndex) {
    reasons.push(`insufficient tool-calling level: required ${bodyProfile.requiredToolCalling}, substrate provides ${substrate.capabilities.toolCallingLevel}`);
    details.toolCallingMismatch = {
      required: bodyProfile.requiredToolCalling,
      actual: substrate.capabilities.toolCallingLevel,
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

  // 4. Check cost constraints (if declared)
  if (bodyProfile.costConstraints) {
    if (substrate.costPerMillionRequests > bodyProfile.costConstraints.maxCostPerMillionRequests!) {
      reasons.push(`cost exceeds constraint: ${substrate.costPerMillionRequests} > ${bodyProfile.costConstraints.maxCostPerMillionRequests}`);
      details.costMismatch = {
        actual: substrate.costPerMillionRequests,
        maxAllowed: bodyProfile.costConstraints.maxCostPerMillionRequests,
      };
    }
  }

  // 5. Check prohibited conditions
  const prohibitedConditions = bodyProfile.prohibitedConditions.filter(
    (prohibited: string) => substrate.conditions.includes(prohibited)
  );
  
  if (prohibitedConditions.length > 0) {
    reasons.push(`prohibited conditions present: ${prohibitedConditions.join(', ')}`);
    details.prohibitedConditions = prohibitedConditions;
  }

  // 6. Check required test suites (if registry provided)
  if (context?.registry) {
    const missingTestSuites: string[] = [];
    for (const suiteRef of bodyProfile.requiredEvaluationSuites) {
      const exists = context.registry.hasTestSuite(suiteRef);
      if (!exists) {
        missingTestSuites.push(`${suiteRef.namespace}/${suiteRef.name}@${suiteRef.version}`);
      }
    }
    
    if (missingTestSuites.length > 0) {
      reasons.push(`missing required test suites: ${missingTestSuites.join(', ')}`);
      details.missingTestSuites = missingTestSuites;
    }
  }

  // 7. Check substrate-specific adaptations
  const applicableAdaptations = bodyProfile.substrateAdaptations.filter(
    (adaptation) => adaptation.substrateDigest === substrate.digest
  );
  
  if (applicableAdaptations.length > 0 && context?.registry) {
    const missingAdaptations: string[] = [];
    for (const adaptation of applicableAdaptations) {
      const exists = context.registry.hasTestSuite(adaptation.adaptation);
      if (!exists) {
        missingAdaptations.push(`${adaptation.adaptation.namespace}/${adaptation.adaptation.name}@${adaptation.adaptation.version}`);
      }
    }
    
    if (missingAdaptations.length > 0) {
      reasons.push(`missing required adaptations: ${missingAdaptations.join(', ')}`);
      details.missingAdaptations = missingAdaptations;
    }
  }

  // Determine verdict based on failures
  let verdict: CompatibilityVerdictKind;
  
  if (reasons.length === 0) {
    verdict = 'compatible';
  } else if (context?.registry && (details.missingTestSuites || details.missingAdaptations)) {
    verdict = 'unknown-with-structured-causes';
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