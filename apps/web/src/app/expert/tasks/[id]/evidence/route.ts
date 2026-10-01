import { NextResponse } from 'next/server';

import { resolveExpertSession, submitExpertEvidence } from '../../../../../expert/index.js';
import { ExpertEvidenceError } from '../../../../../expert/index.js';
import type { ExpertEvidenceVerdict } from '../../../../../expert/index.js';

/**
 * POST `/expert/tasks/:id/evidence` — the evidence submission control of
 * the session-posture expert workbench (Work Order B009; issue #81).
 *
 * A plain HTML form target (no client JavaScript): the browser POSTs the
 * judgment; this handler validates the session THROUGH the B004 boundary
 * (fail closed — an unauthenticated POST redirects back to the task
 * surface, which renders the denied state, never an anonymous write),
 * appends the expert judgment through the B002 ControlPlaneRepository
 * port (append-only, provenance-shaped, typed), and redirects back to
 * the task surface with the honest outcome:
 *   - `?evidence=<sequence>` — the judgment was appended at that ledger
 *     address (task/run/evaluation/verification state unchanged);
 *   - `?evidence-error=<typed code>` — the submission failed closed and
 *     NOTHING was appended.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const resolved = await context.params;
  const taskId = decodeURIComponent(resolved.id);
  const form = await request.formData();
  const caseRecordId = text(form, 'case');
  const back = new URL(
    `/expert/tasks/${encodeURIComponent(taskId)}?case=${encodeURIComponent(caseRecordId)}`,
    request.url,
  );
  const outcome = await resolveExpertSession();
  if (outcome.status === 'unauthenticated') {
    // Fail closed: the redirect lands on the task surface, which renders
    // the denied state (never an anonymous workbench write).
    return NextResponse.redirect(back, 303);
  }
  try {
    const result = await submitExpertEvidence(
      {
        repository: outcome.repository,
        port: outcome.port,
        facts: outcome.facts,
      },
      {
        caseRecordId,
        taskId,
        // Untrusted form input: the closed verdict vocabulary is validated
        // INSIDE submitExpertEvidence (fail closed with a typed error).
        verdict: text(form, 'verdict') as ExpertEvidenceVerdict,
        summary: text(form, 'summary'),
        basis: text(form, 'basis'),
      },
    );
    back.searchParams.set('evidence', String(result.sequence));
  } catch (error) {
    if (error instanceof ExpertEvidenceError) {
      back.searchParams.set('evidence-error', error.code);
    } else {
      throw error;
    }
  }
  return NextResponse.redirect(back, 303);
}
