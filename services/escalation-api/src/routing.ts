/**
 * Deterministic reference routing stub (Work Order C001).
 *
 * ⚠️ STUB — THE SEAM, NOT THE SEMANTICS. Real routing (capability-demand
 * compilation, performance history, availability, conflict-of-interest,
 * privacy clearance, budget/deadline fitting) is Work Order C002's owned
 * surface (packages/escalation-routing/*, services/escalation-routing/*).
 * This stub exists so the escalation API's lifecycle can be exercised
 * end-to-end on the reference fabric: it round-robins over the A007
 * qualified-expert READ surface (injected via QualifiedExpertDirectory)
 * filtered by the request's required capabilities.
 *
 * Qualification IS DATA, NEVER ACCESS GRANT (lock rule 9): matching a
 * qualified expert here records a ROUTING CANDIDATE; it grants nothing.
 */

import type { EscalationRecord } from '@arena/escalation';
import type {
  QualifiedExpertDirectory,
  RoutingDecision,
  RoutingPort,
} from './ports.js';

export interface RoundRobinRoutingStubConfig {
  readonly directory: QualifiedExpertDirectory;
  /** Deterministic seed for the rotation start (default 0). */
  readonly startAt?: number;
}

export class RoundRobinRoutingStub implements RoutingPort {
  private readonly directory: QualifiedExpertDirectory;
  private cursor: number;

  constructor(config: RoundRobinRoutingStubConfig) {
    this.directory = config.directory;
    this.cursor = config.startAt ?? 0;
  }

  async route(request: EscalationRecord): Promise<RoutingDecision> {
    const tenantId = request.request.tenantId;
    const qualified = await this.directory.listQualifiedExperts(tenantId);
    const required = request.request.expertRequirements.requiredCapabilities;
    const candidates = qualified.filter((expert) =>
      required.every((capability) => expert.qualifiedCapabilities.includes(capability)),
    );
    if (candidates.length === 0) {
      return { outcome: 'no-match', reason: 'no-qualified-expert' };
    }
    // Locale narrowing: prefer experts whose locale matches a preferred
    // locale, falling back to the full candidate set (deterministic).
    const preferred = request.request.expertRequirements.preferredLocales ?? [];
    const localeMatches =
      preferred.length > 0
        ? candidates.filter((expert) => preferred.includes(expert.locale))
        : candidates;
    const pool = localeMatches.length > 0 ? localeMatches : candidates;
    const index = ((this.cursor % pool.length) + pool.length) % pool.length;
    this.cursor += 1;
    const chosen = pool[index];
    if (chosen === undefined) {
      return { outcome: 'no-match', reason: 'routing-unavailable' };
    }
    return { outcome: 'matched', expertRef: chosen.expertRef };
  }
}
