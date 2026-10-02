import type { Metadata } from 'next';

import {
  EvaluationAuthRequiredView,
  EvaluationHomeView,
  resolveEvaluationExperience,
} from '../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Evaluation',
};

/**
 * /evaluation — the session-aware evaluation/verification/certification
 * surface mount (Work Order B012; issue #87). A mount point, not logic:
 * the composition lives in apps/web/src/evaluation
 * (resolveEvaluationExperience). Fail closed — an unauthenticated
 * visitor gets the auth-required notice, never an anonymous surface.
 */
export default async function EvaluationPage() {
  const experience = await resolveEvaluationExperience();
  if (experience.kind === 'auth-required') {
    return <EvaluationAuthRequiredView />;
  }
  return <EvaluationHomeView view={experience.view} />;
}
