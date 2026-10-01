import { NextResponse } from 'next/server';

import { getDemoExpertContext, submitExpertEvidence } from '../../../../../../expert/index.js';
import { ExpertEvidenceError } from '../../../../../../expert/index.js';
import type { ExpertEvidenceVerdict } from '../../../../../../expert/index.js';

/**
 * POST `/demo/expert/tasks/:id/evidence` — the evidence submission control
 * of the DEMO expert workbench (Work Order B009; issue #81).
 *
 * A plain HTML form target (no client JavaScript): the browser POSTs the
 * judgment; this handler appends it through the demo store's OWN B002
 * ControlPlaneRepository (visibly labelled demo state — never customer
 * state; `/demo/reset` drops it with the demo itself) and redirects back
 * to the demo task surface with the honest outcome (`?evidence=<seq>` or
 * `?evidence-error=<typed code>`). Demo determinism: the store's frozen
 * narrative clock stamps the record's provenance, so identical submissions
 * address identical slots idempotently.
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
    `/demo/expert/tasks/${encodeURIComponent(taskId)}?case=${encodeURIComponent(caseRecordId)}`,
    request.url,
  );
  const demo = await getDemoExpertContext();
  try {
    const result = await submitExpertEvidence(
      { repository: demo.repository, port: demo.port, facts: demo.facts },
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
