import type { Metadata } from 'next';

import {
  CertificationRunView,
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  resolveCertificationExperience,
} from '../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Certification claim',
};

export interface CertificationPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /evaluation/certification/:certificationId — the certification detail
 * mount (Work Order B012). The composition tuple (Body Version ×
 * Substrate × Environment × Runtime × Suite) renders prominent — a
 * bare-model claim is structurally unrenderable. Fail closed without a
 * session; honest not-found in the local session posture.
 */
export default async function CertificationPage({ params }: CertificationPageProps) {
  const resolved = params === undefined ? undefined : await params;
  const raw = resolved?.['certificationId'];
  const certificationId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (certificationId === undefined || certificationId.length === 0) {
    return (
      <EvaluationNotFoundView
        title="Certification record not found"
        recordId="(missing id)"
        hint="No certification id was supplied. Nothing is fabricated to fill the space."
      />
    );
  }
  const experience = await resolveCertificationExperience({ id: certificationId });
  switch (experience.kind) {
    case 'auth-required':
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Certification record not found"
          recordId={certificationId}
          hint="No append-once A023 certification record exists for this id in this workspace posture — certification claims are never fabricated."
        />
      );
    case 'certification':
      return <CertificationRunView view={experience.view} demo={false} />;
  }
}
