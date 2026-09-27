/**
 * Action/tool surface and observation surface (spec ENV1.0 declare fields
 * 5 and 6; Work Order A009 gate 2).
 *
 *   - ActionSurface: the CLOSED set of typed actions a workload may perform
 *     inside the environment, plus the tools it may invoke. Every action
 *     and tool is declared by a neutral identifier and (optionally) the
 *     SchemaRef of its parameter/result contract — never by an
 *     implementation binding.
 *   - ObservationSurface: the closed set of observation channels the
 *     environment emits (what a run can be observed BY).
 *
 * Both surfaces are typed, validated objects: at least one action and one
 * observation must be declared (an environment the agent cannot act in or
 * observe is not a task world); duplicate ids are rejected (closed sets).
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { NeutralId, NeutralText } from './shared.js';
import {
  expectEnumMember,
  expectFields,
  isNeutralId,
  isNeutralText,
  toNeutralId,
  toNeutralText,
} from './shared.js';

// ---------------------------------------------------------------------------
// ActionSurface (declare field 5 — "action/tool surface")
// ---------------------------------------------------------------------------

/** A typed action the workload may perform. */
export interface ActionDescriptor {
  readonly actionId: NeutralId;
  readonly description: NeutralText | null;
}

/** A tool the workload may invoke. */
export interface ToolDescriptor {
  readonly toolId: NeutralId;
  readonly description: NeutralText | null;
}

export interface ActionSurface {
  readonly actions: readonly ActionDescriptor[];
  readonly tools: readonly ToolDescriptor[];
}

export function isActionDescriptor(value: unknown): value is ActionDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['actionId']) &&
    (candidate['description'] === null ||
      candidate['description'] === undefined ||
      isNeutralText(candidate['description']))
  );
}

export function isToolDescriptor(value: unknown): value is ToolDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['toolId']) &&
    (candidate['description'] === null ||
      candidate['description'] === undefined ||
      isNeutralText(candidate['description']))
  );
}

export function isActionSurface(value: unknown): value is ActionSurface {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['actions']) &&
    candidate['actions'].length > 0 &&
    candidate['actions'].every((entry) => isActionDescriptor(entry)) &&
    Array.isArray(candidate['tools']) &&
    candidate['tools'].every((entry) => isToolDescriptor(entry))
  );
}

function toActionDescriptor(value: unknown): ActionDescriptor {
  const record = expectFields(
    value,
    ['actionId'],
    ['description'],
    ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE,
    'action descriptor',
  );
  const actionId = toNeutralId(
    typeof record['actionId'] === 'string' ? record['actionId'] : '',
  );
  const rawDescription = record['description'];
  if (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
      message: 'action descriptor: description must be neutral text or null',
    });
  }
  const description =
    rawDescription === null || rawDescription === undefined
      ? null
      : toNeutralText(rawDescription, 'actionDescriptor.description', ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE);
  return Object.freeze({ actionId, description });
}

function toToolDescriptor(value: unknown): ToolDescriptor {
  const record = expectFields(
    value,
    ['toolId'],
    ['description'],
    ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE,
    'tool descriptor',
  );
  const toolId = toNeutralId(typeof record['toolId'] === 'string' ? record['toolId'] : '');
  const rawDescription = record['description'];
  if (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
      message: 'tool descriptor: description must be neutral text or null',
    });
  }
  const description =
    rawDescription === null || rawDescription === undefined
      ? null
      : toNeutralText(rawDescription, 'toolDescriptor.description', ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE);
  return Object.freeze({ toolId, description });
}

/** Validate and freeze the action/tool surface (non-empty, duplicate-free). */
export function toActionSurface(value: {
  actions: readonly {
    actionId: string;
    description?: string | null;
  }[];
  tools?: readonly {
    toolId: string;
    description?: string | null;
  }[];
}): ActionSurface {
  const record = expectFields(
    value,
    ['actions'],
    ['tools'],
    ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE,
    'action surface',
  );
  const rawActions = record['actions'];
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
      message: 'action surface: at least one action must be declared (typed action surface)',
    });
  }
  const actions = Object.freeze(rawActions.map((entry) => toActionDescriptor(entry)));
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.actionId)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
        message: `action surface: duplicate action id '${action.actionId}' (closed set, no duplicates)`,
        details: { actionId: action.actionId },
      });
    }
    seen.add(action.actionId);
  }
  const rawTools = record['tools'];
  if (rawTools !== undefined && !Array.isArray(rawTools)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
      message: 'action surface: tools must be an array of tool descriptors',
    });
  }
  const tools = Object.freeze((rawTools ?? []).map((entry) => toToolDescriptor(entry)));
  for (const tool of tools) {
    if (seen.has(tool.toolId)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_ACTION_SURFACE, {
        message: `action surface: duplicate tool id '${tool.toolId}' (closed set, no duplicates)`,
        details: { toolId: tool.toolId },
      });
    }
    seen.add(tool.toolId);
  }
  return Object.freeze({ actions, tools });
}

// ---------------------------------------------------------------------------
// ObservationSurface (declare field 6)
// ---------------------------------------------------------------------------

/** Closed set of observation channels an environment may emit. */
export const OBSERVATION_CHANNELS = Object.freeze([
  'stdout',
  'stderr',
  'files',
  'events',
  'metrics',
  'state-dump',
] as const);
export type ObservationChannel = (typeof OBSERVATION_CHANNELS)[number];

export interface ObservationDescriptor {
  readonly observationId: NeutralId;
  readonly channel: ObservationChannel;
  readonly description: NeutralText | null;
}

export interface ObservationSurface {
  readonly observations: readonly ObservationDescriptor[];
}

export function isObservationDescriptor(value: unknown): value is ObservationDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['observationId']) &&
    typeof candidate['channel'] === 'string' &&
    (OBSERVATION_CHANNELS as readonly string[]).includes(candidate['channel']) &&
    (candidate['description'] === null ||
      candidate['description'] === undefined ||
      isNeutralText(candidate['description']))
  );
}

export function isObservationSurface(value: unknown): value is ObservationSurface {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['observations']) &&
    candidate['observations'].length > 0 &&
    candidate['observations'].every((entry) => isObservationDescriptor(entry))
  );
}

function toObservationDescriptor(value: unknown): ObservationDescriptor {
  const record = expectFields(
    value,
    ['observationId', 'channel'],
    ['description'],
    ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE,
    'observation descriptor',
  );
  const observationId = toNeutralId(
    typeof record['observationId'] === 'string' ? record['observationId'] : '',
  );
  const channel = expectEnumMember(
    record['channel'],
    OBSERVATION_CHANNELS,
    'channel',
    ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE,
    'observation descriptor',
  );
  const rawDescription = record['description'];
  if (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE, {
      message: 'observation descriptor: description must be neutral text or null',
    });
  }
  const description =
    rawDescription === null || rawDescription === undefined
      ? null
      : toNeutralText(rawDescription, 'observationDescriptor.description', ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE);
  return Object.freeze({ observationId, channel, description });
}

/** Validate and freeze the observation surface (non-empty, duplicate-free). */
export function toObservationSurface(value: {
  observations: readonly {
    observationId: string;
    channel: string;
    description?: string | null;
  }[];
}): ObservationSurface {
  const record = expectFields(
    value,
    ['observations'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE,
    'observation surface',
  );
  const rawObservations = record['observations'];
  if (!Array.isArray(rawObservations) || rawObservations.length === 0) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE, {
      message: 'observation surface: at least one observation must be declared',
    });
  }
  const observations = Object.freeze(
    rawObservations.map((entry) => toObservationDescriptor(entry)),
  );
  const seen = new Set<string>();
  for (const observation of observations) {
    if (seen.has(observation.observationId)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_OBSERVATION_SURFACE, {
        message: `observation surface: duplicate observation id '${observation.observationId}' (closed set, no duplicates)`,
        details: { observationId: observation.observationId },
      });
    }
    seen.add(observation.observationId);
  }
  return Object.freeze({ observations });
}
