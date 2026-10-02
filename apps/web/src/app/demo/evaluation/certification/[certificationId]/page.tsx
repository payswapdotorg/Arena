import type { Metadata } from 'next';

import {
  CertificationRunView,
  EvaluationAuthRequiredView,
  EvaluationNotFoundView,
  resolveDemoCertificationExperience,
} from '../../../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Certification claim (demo)',
};

export interface DemoCertificationPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/** /demo/evaluation/certification/:certificationId — the deterministic demo certification detail (honest not-found otherwise). */
export default async function DemoCertificationPage({ params }: DemoCertificationPageProps) {
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
  const experience = await resolveDemoCertificationExperience(certificationId);
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for the
      // typed union — fail closed, never a fabricated claim.
      return <EvaluationAuthRequiredView />;
    case 'not-found':
      return (
        <EvaluationNotFoundView
          title="Certification record not found"
          recordId={certificationId}
          hint="The deterministic demo corpus carries exactly two certification runs (one revoked, one active) — unknown ids are never fabricated."
        />
      );
    case 'certification':
      return <CertificationRunView view={experience.view} demo />;
  }
}
