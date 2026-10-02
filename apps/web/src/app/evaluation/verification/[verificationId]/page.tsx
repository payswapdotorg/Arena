import type { Metadata } from 'next';

import {
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  VerificationRecordView,
  resolveVerificationExperience,
} from '../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Verification record',
};

export interface VerificationPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /evaluation/verification/:verificationId — the verification record
 * detail mount (Work Order B012). Fail closed without a session; honest
 * not-found in the local session posture — never a fabricated verdict.
 */
export default async function VerificationPage({ params }: VerificationPageProps) {
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
  const experience = await resolveVerificationExperience({ id: verificationId });
  switch (experience.kind) {
    case 'auth-required':
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Verification record not found"
          recordId={verificationId}
          hint="No append-once A013 verification record exists for this id in this workspace posture — never a fabricated verdict."
        />
      );
    case 'verification':
      return <VerificationRecordView view={experience.view} demo={false} />;
  }
}
