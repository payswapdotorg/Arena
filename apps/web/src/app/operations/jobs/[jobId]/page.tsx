import type { Metadata } from 'next';

import {
  JobDetailView,
  OperationsAuthRequiredView,
  OperationsNotFoundView,
  resolveOperationsJobExperience,
} from '../../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — job',
};

export interface OperationsJobPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /operations/jobs/:jobId — the job detail mount (Work Order B014). Fail
 * closed without a session; honest not-found in the local session
 * posture — never a fabricated job.
 */
export default async function OperationsJobPage({ params }: OperationsJobPageProps) {
  const resolved = params === undefined ? undefined : await params;
  const raw = resolved?.['jobId'];
  const jobId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (jobId === undefined || jobId.length === 0) {
    return (
      <OperationsNotFoundView
        title="Job not found"
        recordId="(missing id)"
        hint="No job id was supplied. Nothing is fabricated to fill the space."
      />
    );
  }
  const experience = await resolveOperationsJobExperience({ id: jobId });
  switch (experience.kind) {
    case 'auth-required':
      return <OperationsAuthRequiredView />;
    case 'not-found':
      return (
        <OperationsNotFoundView
          title="Job not found"
          recordId={jobId}
          hint="No A015 job record exists for this id in this workspace posture — the canonical records are never guessed."
        />
      );
    case 'job':
      return <JobDetailView view={experience.view} />;
  }
}
