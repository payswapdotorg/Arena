import type { Metadata } from 'next';

import { resolveEscalationOpsBoardExperience } from '../../escalation-ops/index.js';

export const metadata: Metadata = {
  title: 'Escalation operations',
};

/**
 * /escalation-ops — the C021 operator board mount (Work Order C021).
 * A mount point, not logic: the composition lives in
 * apps/web/src/escalation-ops (resolveEscalationOpsBoardExperience).
 * Fail closed — an unauthenticated visitor gets the auth-required
 * notice, never an anonymous surface. Timelines, SLA measurements,
 * SLO rollups, network health and alert-rule projections render their
 * honest states: dwell times, met/at-risk/breached vocabulary,
 * disclosed formulas and small-sample status — nothing fabricated.
 */
export default async function EscalationOpsPage() {
  const experience = await resolveEscalationOpsBoardExperience();
  return experience.view;
}
