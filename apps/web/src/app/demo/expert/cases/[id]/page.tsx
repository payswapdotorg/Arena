import { CaseWorkView } from '../../../../../expert/index.js';
import { buildCaseWorkView, getDemoExpertContext } from '../../../../../expert/index.js';

/**
 * /demo/expert/cases/:id — the demo case work lens (UXM1.0 `/cases/:id`
 * expert row under the demo posture). A mount point, not logic: the
 * composition lives in apps/web/src/expert. Rendering under /demo inherits
 * B006's always-on labelling banner; reads go through the canonical read
 * path over the deterministic demo corpus; evidence appends land in the
 * demo store's OWN B002 repository (visibly labelled, never customer
 * state).
 */

export interface DemoExpertCasePageProps {
  readonly params?: Promise<{ readonly id: string }>;
}

export default async function DemoExpertCasePage({ params }: DemoExpertCasePageProps) {
  const resolved = params === undefined ? { id: '' } : await params;
  const caseRecordId = decodeURIComponent(resolved.id);
  const context = await getDemoExpertContext();
  const view = await buildCaseWorkView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    caseRecordId,
    corpusHash: context.corpusHash,
  });
  return <CaseWorkView view={view} />;
}
