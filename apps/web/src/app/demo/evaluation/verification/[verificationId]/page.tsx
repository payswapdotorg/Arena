import type { Metadata } from 'next';

import {
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  VerificationRecordView,
  resolveDemoVerificationExperience,
} from '../../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Verification record (demo)',
};

export interface DemoVerificationPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/** /demo/evaluation/verification/:verificationId — the deterministic demo verification detail (honest not-found otherwise). */
export default async function DemoVerificationPage({ params }: DemoVerificationPageProps) {
  const resolved = params === undefined ? undefined : await params;
  const raw = resolved?.['verificationId'];
  const verificationId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (verificationId === undefined || verificationId.length === 0) {
    return (
      <EvaluationNotFoundView
        title="Verification record not found"
        recordId="(missing id)"
        hint="No verification id was supplied. Nothing is fabricated to fill the space."
      />
    );
  }
  const experience = await resolveDemoVerificationExperience(verificationId);
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for the
      // typed union — fail closed, never a fabricated verdict.
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Verification record not found"
          recordId={verificationId}
          hint="The deterministic demo corpus carries exactly one verification record — unknown ids are never fabricated."
        />
      );
    case 'verification':
      return <VerificationRecordView view={experience.view} demo />;
  }
}
