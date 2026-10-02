import type { Metadata } from 'next';

import {
  JobDetailView,
  OperationsAuthRequiredView,
  OperationsNotFoundView,
  resolveDemoOperationsJobExperience,
} from '../../../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations — job (demo)',
};

export interface DemoOperationsJobPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/** /demo/operations/jobs/:jobId — the deterministic demo job detail (honest not-found otherwise). */
export default async function DemoOperationsJobPage({
  params,
}: DemoOperationsJobPageProps) {
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
  const experience = await resolveDemoOperationsJobExperience(jobId);
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for the
      // typed union — fail closed, never a fabricated job.
      return <OperationsAuthRequiredView />;
    case 'not-found':
      return (
        <OperationsNotFoundView
          title="Job not found"
          recordId={jobId}
          hint="The deterministic demo corpus carries exactly five job records — unknown ids are never fabricated."
        />
      );
    case 'job':
      return <JobDetailView view={experience.view} />;
  }
}
