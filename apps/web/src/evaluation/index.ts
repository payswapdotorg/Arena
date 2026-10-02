/**
 * The evaluation surface barrel (Work Order B012; issue #87;
 * apps/web/src/evaluation). Presentational re-exports so the route
 * mounts import ONE module (the B010 bodies pattern).
 */

export { EvaluationHomeView, EvaluationTruthMark, Maybe } from './evaluation-home-view.js';
export {
  CertificationRunView,
  EvaluationReportDetailView,
  VerificationRecordView,
} from './evaluation-detail-views.js';
export { EvaluationAuthRequiredView, EvaluationNotFoundView } from './evaluation-mount-views.js';
export {
  resolveDemoEvaluationHome,
  resolveDemoEvaluationReportExperience,
  resolveDemoCertificationExperience,
  resolveDemoVerificationExperience,
  resolveEvaluationExperience,
  resolveEvaluationReportExperience,
  resolveCertificationExperience,
  resolveVerificationExperience,
} from './evaluation-route.js';
export type {
  EvaluationExperience,
  EvaluationHomeViewModel,
  EvaluationReportExperience,
  CertificationExperience,
  VerificationExperience,
} from './evaluation-route.js';
export { getDemoEvaluationContext, resetDemoEvaluationContext } from './runtime.js';
