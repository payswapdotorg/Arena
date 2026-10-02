/**
 * The seed command's logic (Work Order B016).
 *
 * Seeds the deterministic B006 demo corpus into the LOCAL fake
 * persistence store through the SAME ports the application uses:
 * createDemoStore({ repository }) over the file-backed B002
 * ControlPlaneRepository. Deterministic by construction — the injected
 * clock is a ManualClock frozen at the demo narrative epoch, so the
 * store's records (and therefore its file bytes) are identical on every
 * machine, every run.
 *
 * The printed report states EXACTLY what was seeded (every record id and
 * kind), the demo tenant identity, the corpus hash summary, and the
 * always-visible labelling truth: demo state is NOT customer state.
 *
 * Plain .mjs — zero external dependencies.
 */

import { openFileBackedControlPlaneRepository } from './local-store.mjs';
import { statePaths } from './local-state.mjs';

/**
 * Run the seed workflow against a state directory.
 *
 * @param {{
 *   demo: Record<string, any>,
 *   persistence: Record<string, any>,
 *   stateDir: string,
 *   out: { write(chunk: string): boolean },
 * }} options
 * @returns {Promise<{ exitCode: number, report: Record<string, any> }>}
 */
export async function runSeed(options) {
  const { demo, persistence, stateDir, out } = options;
  const write = (text) => {
    out.write(`${text}\n`);
  };

  const paths = statePaths(stateDir);
  const clock = new persistence.ManualClock(demo.DEMO_NARRATIVE_EPOCH_MS);
  const { repository } = await openFileBackedControlPlaneRepository({
    persistence,
    storePath: paths.storeFile,
    clock,
  });

  const store = demo.createDemoStore({ repository });
  const report = await store.seed();

  const kinds = new Map(
    demo.buildDemoCorpus().map((item) => [item.recordId, item.kind]),
  );
  const alreadyPresent = report.seeded.length - report.created.length;

  write(`[arena-seed] demo tenant: ${demo.DEMO_TENANT_ID} (reserved demo tenant — demo state is NOT customer state)`);
  write(`[arena-seed] labelling: ${demo.DEMO_LABELLING.bannerTitle} — ${demo.DEMO_LABELLING.bannerText}`);
  write(
    `[arena-seed] corpus: version ${String(report.recordVersion)} · hash summary ${demo.demoCorpusHashSummary(report.corpusHash)} (deterministic — identical on every machine)`,
  );
  write(`[arena-seed] seeded records (${String(report.seeded.length)}):`);
  for (const recordId of report.seeded) {
    const kind = kinds.get(recordId) ?? '<unknown-kind>';
    write(`[arena-seed]   ${recordId}  (kind ${kind})`);
  }
  write(
    `[arena-seed] created this run: ${String(report.created.length)} record(s) · already present: ${String(alreadyPresent)} record(s) — seed is idempotent, re-running creates nothing new`,
  );
  write(
    `[arena-seed] local store: ${paths.storeFile} · ${String(await repository.count({}))} record(s) · format v1 (local fake — zero providers, zero credentials)`,
  );
  write('[arena-seed] next: node scripts/product/doctor.mjs (environment diagnosis)');
  write('[arena-seed] next: pnpm --filter @arena/web dev → http://localhost:3000/demo (deterministic demo mode)');

  return { exitCode: 0, report };
}
