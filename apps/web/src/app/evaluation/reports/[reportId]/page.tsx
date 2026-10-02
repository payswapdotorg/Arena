import type { Metadata } from 'next';

import {
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  EvaluationReportDetailView,
  resolveEvaluationReportExperience,
} from '../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Evaluation report',
};

export interface EvaluationReportPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /evaluation/reports/:reportId — the evaluation report detail mount
 * (Work Order B012). Fail closed without a session; honest not-found in
 * the local session posture — never a fabricated report.
 */
export default async function EvaluationReportPage({ params }: EvaluationReportPageProps) {
  const resolved = params === undefined ? undefined : await params;
  const raw = resolved?.['reportId'];
  const reportId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (reportId === undefined || reportId.length === 0) {
    return (
      <EvaluationNotFoundView
        title="Evaluation report not found"
        recordId="(missing id)"
        hint="No report id was supplied. Nothing is fabricated to fill the space."
      />
    );
  }
  const experience = await resolveEvaluationReportExperience({ id: reportId });
  switch (experience.kind) {
    case 'auth-required':
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Evaluation report not found"
          recordId={reportId}
          hint="No append-once A012 evaluation record exists for this id in this workspace posture — the canonical sources are never guessed."
        />
      );
    case 'report':
      return <EvaluationReportDetailView view={experience.view} demo={false} />;
  }
}
