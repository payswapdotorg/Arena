import type { Metadata } from 'next';

import {
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  EvaluationReportDetailView,
  resolveDemoEvaluationReportExperience,
} from '../../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Evaluation report (demo)',
};

export interface DemoEvaluationReportPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/** /demo/evaluation/reports/:reportId — the deterministic demo report detail (honest not-found otherwise). */
export default async function DemoEvaluationReportPage({
  params,
}: DemoEvaluationReportPageProps) {
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
  const experience = await resolveDemoEvaluationReportExperience(reportId);
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for the
      // typed union — fail closed, never a fabricated report.
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Evaluation report not found"
          recordId={reportId}
          hint="The deterministic demo corpus carries exactly one evaluation report — unknown ids are never fabricated."
        />
      );
    case 'report':
      return <EvaluationReportDetailView view={experience.view} demo />;
  }
}
