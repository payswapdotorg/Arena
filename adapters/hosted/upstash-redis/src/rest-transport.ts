/**
 * REST command transport seam for the Upstash Redis adapter (Work Order
 * B002).
 *
 * The adapter's ONLY infrastructure touchpoint is `RestCommandTransport`:
 * a closed, reviewable vocabulary of the six Redis commands the
 * coordination port needs (GET, SET with PX/NX, DEL, INCR, PEXPIRE with
 * NX, PTTL) plus PING for the capacity probe. The default transport maps
 * commands onto the Upstash REST API with plain `fetch` — ZERO new
 * dependencies (Work Order requirement). Tests (and alternative runtimes)
 * inject a transport implementing the same semantics — this is how the
 * FULL persistence contract suite runs against this adapter without live
 * credentials (FT2.0 "Local parity" / "Tests never require live provider
 * credentials").
 *
 * Semantics every transport MUST honor (mirrored by the test fake):
 *   - GET returns the live string value or null (expired/absent);
 *   - SET with nx returns 'OK' when it acquired, null when a live key
 *     existed; SET without nx always returns 'OK';
 *   - DEL returns 1 when a live key was deleted, else 0;
 *   - INCR creates/starts at 1 on absent/expired keys, else increments
 *     (integer values only);
 *   - PEXPIRE with nx only sets a TTL when none exists (returns 0/1);
 *   - PTTL returns remaining ms, -1 for no TTL, -2 for absent keys;
 *   - PING returns 'PONG'.
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '@arena/persistence';
import type { UpstashAdapterConfig } from './env.js';

/** The command vocabulary this adapter issues (closed set). */
export const REST_COMMAND_NAMES = Object.freeze([
  'GET',
  'SET',
  'DEL',
  'INCR',
  'PEXPIRE',
  'PTTL',
  'PING',
] as const);

export type RestCommandName = (typeof REST_COMMAND_NAMES)[number];

export interface RestGetCommand {
  readonly command: 'GET';
  readonly key: string;
}

export interface RestSetCommand {
  readonly command: 'SET';
  readonly key: string;
  readonly value: string;
  /** TTL in milliseconds (PX); absent = no expiry. */
  readonly ttlMs?: number;
  /** Set only when no live key exists (NX). */
  readonly nx?: boolean;
}

export interface RestDelCommand {
  readonly command: 'DEL';
  readonly key: string;
}

export interface RestIncrCommand {
  readonly command: 'INCR';
  readonly key: string;
}

export interface RestPexpireCommand {
  readonly command: 'PEXPIRE';
  readonly key: string;
  readonly ttlMs: number;
  /** Only set the TTL when the key has none (NX). */
  readonly nx?: boolean;
}

export interface RestPttlCommand {
  readonly command: 'PTTL';
  readonly key: string;
}

export interface RestPingCommand {
  readonly command: 'PING';
}

export type RestCommand =
  | RestGetCommand
  | RestSetCommand
  | RestDelCommand
  | RestIncrCommand
  | RestPexpireCommand
  | RestPttlCommand
  | RestPingCommand;

/**
 * Command results: GET -> string | null; SET -> 'OK' | null; DEL/INCR ->
 * number; PEXPIRE -> 0 | 1; PTTL -> number; PING -> 'PONG'.
 */
export type RestResult = string | number | null;

/** The infrastructure seam this adapter requires. */
export interface RestCommandTransport {
  execute(command: RestCommand): Promise<RestResult>;
}

/**
 * Wrap transport failures in the typed TRANSPORT_FAILED error. REST error
 * bodies can carry endpoint/auth detail — attached as `cause` (never
 * surfaced in the message) and the typed message stays detail-free.
 */
export async function executeRestCommand(
  transport: RestCommandTransport,
  command: RestCommand,
): Promise<RestResult> {
  try {
    return await transport.execute(command);
  } catch (cause) {
    if (cause instanceof PersistenceError) throw cause;
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
      message: `command ${command.command} failed on the hosted coordination transport`,
      details: { command: command.command },
      cause,
    });
  }
}

/** Encode a command as the flat REST argument array Upstash accepts. */
export function encodeRestCommand(command: RestCommand): string[] {
  switch (command.command) {
    case 'GET':
      return ['GET', command.key];
    case 'SET': {
      const args = ['SET', command.key, command.value];
      if (command.ttlMs !== undefined) args.push('PX', String(command.ttlMs));
      if (command.nx === true) args.push('NX');
      return args;
    }
    case 'DEL':
      return ['DEL', command.key];
    case 'INCR':
      return ['INCR', command.key];
    case 'PEXPIRE': {
      const args = ['PEXPIRE', command.key, String(command.ttlMs)];
      if (command.nx === true) args.push('NX');
      return args;
    }
    case 'PTTL':
      return ['PTTL', command.key];
    case 'PING':
      return ['PING'];
  }
}

/**
 * The default transport over the Upstash REST API — plain `fetch`, ZERO
 * new dependencies. The bearer token is used ONLY in the Authorization
 * header and is never logged.
 */
export function createUpstashRestTransport(config: UpstashAdapterConfig): RestCommandTransport {
  return {
    async execute(command: RestCommand): Promise<RestResult> {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(encodeRestCommand(command)),
      });
      if (!response.ok) {
        throw new Error(`REST endpoint answered ${String(response.status)}`);
      }
      const payload = (await response.json()) as { result?: unknown; error?: unknown };
      if (payload.error !== undefined) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'REST command error');
      }
      const result: unknown = payload.result;
      if (
        result === null ||
        typeof result === 'string' ||
        (typeof result === 'number' && Number.isFinite(result))
      ) {
        return result;
      }
      throw new Error('REST command returned an unsupported result shape');
    },
  };
}
