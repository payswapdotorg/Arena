import type { EvidenceBundle, EvidenceRecord } from './records.js'
import { EXIT_STATUS_NOT_RUN } from './records.js'
import { logger } from './shared/logger.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * B019 Preview Evidence Generator — the deterministic Gate-F bundle
 * assembler.
 *
 * HONESTY CONTRACT: this generator NEVER fabricates a result. It emits
 * the Gate-F record SKELETON — every check's real command, real artifact
 * reference and reproducibility note — with `exitStatus` set to the
 * `EXIT_STATUS_NOT_RUN` sentinel (-1) and `artifactRef` pointing at the
 * owning test surface (or an explicit "pending launch-day evidence"
 * marker where the artifact only exists at the gate). A bundle with
 * pending records is INCOMPLETE and can never read as PASSED.
 *
 * The TL (or CI) fills the real exit statuses at the launch gate through
 * the `inputs` map (keyed by record id); the generator then recomputes
 * the summary deterministically. Identical inputs produce byte-identical
 * bundles (fixed timestamp input, no wall-clock reads).
 */

export interface RecordInput {
  exitStatus?: number
  artifactRef?: string
  metadata?: Record<string, unknown>
}

export interface GeneratorConfig {
  outputDir: string
  previewUrl?: string
  timestamp?: string
  /** Real run results keyed by record id, filled at the launch gate. */
  inputs?: Record<string, RecordInput>
}

interface RecordSkeleton {
  id: string
  type: string
  name: string
  description: string
  command: string
  artifactRef: string
  reproducibility: string
  metadata: Record<string, unknown>
}

/** The Gate-F record skeleton (real commands, real artifact references). */
function gateFRecordSkeletons(): RecordSkeleton[] {
  return [
    {
      id: 'ci-001',
      type: 'ci',
      name: 'Continuous Integration Pipeline',
      description: 'GitHub Actions CI pipeline status for the launch commit',
      command: 'gh run list --workflow ci.yml --limit 1 --json status,conclusion,duration',
      artifactRef: '.github/workflows/ci.yml',
      reproducibility: 'Reproducible via commit SHA on the main branch',
      metadata: {
        workflow: 'ci.yml',
        commitSha: 'TL-owned at the launch gate',
        conclusion: 'pending launch-day evidence'
      }
    },
    {
      id: 'e2e-001',
      type: 'product-e2e',
      name: 'Product End-to-End Tests',
      description: 'B017 product E2E battery: deterministic lifecycle walk, role-switch regression, served-app walk',
      command: 'pnpm run test:e2e',
      artifactRef: 'tests/product-e2e/run.mjs',
      reproducibility: 'Self-contained runner (fixed seed; boot → serve → vitest → reset cleanup)',
      metadata: {
        suites: [
          'tests/product-e2e/determinism.test.ts',
          'tests/product-e2e/lifecycle-walk.test.ts',
          'tests/product-e2e/role-switch.test.ts',
          'tests/product-e2e/served-walk.test.ts'
        ],
        testCounts: 'pending launch-day evidence'
      }
    },
    {
      id: 'a11y-001',
      type: 'accessibility',
      name: 'Accessibility Conformance Battery',
      description: 'B018 WCAG 2.1 AA conformance battery (focus management, screen-reader semantics, contrast)',
      command: 'pnpm --filter @arena/web exec vitest run src/a11y/testing/a11y.test.ts',
      artifactRef: 'apps/web/src/a11y/testing/a11y.test.ts',
      reproducibility: 'Composition-layer assertions (renderToStaticMarkup) — deterministic',
      metadata: {
        auditTool: 'B018 a11y testing harness (composition layer)',
        violations: 'pending launch-day evidence'
      }
    },
    {
      id: 'perf-001',
      type: 'performance',
      name: 'Performance Budget Battery',
      description: 'B018 performance battery: product budget conformance and load-shape harness',
      command: 'pnpm --filter @arena/performance test',
      artifactRef: 'tests/performance/src/product-budget.test.ts',
      reproducibility: 'Deterministic RNG + fixed load shapes (no wall-clock dependence in the green path)',
      metadata: {
        budgetReport: 'pending launch-day evidence'
      }
    },
    {
      id: 'sec-001',
      type: 'security',
      name: 'Adversarial Security Battery',
      description: 'A034 adversarial battery: cross-tenant denial matrix, audit-replay attacks, data-rights violations',
      command: 'cd services/security && pnpm run battery:test',
      artifactRef: 'tests/security/battery.test.ts',
      reproducibility: 'Deterministic adversarial fixtures (services/security-owned vitest root)',
      metadata: {
        scanTool: '@arena/security battery (tests/security)',
        vulnerabilities: 'pending launch-day evidence'
      }
    },
    {
      id: 'quota-001',
      type: 'quota',
      name: 'Free-Tier Quota Ceiling Tests',
      description: 'B015 quota catalog pinned to docs/deployment/free-tier-architecture.md + fail-closed wiring tests',
      command: 'pnpm --filter @arena/deploy exec vitest run src/hosted/quotas.test.ts src/hosted/fail-closed.test.ts',
      artifactRef: 'deploy/src/hosted/quotas.test.ts',
      reproducibility: 'Catalog constants pinned by test; dry-run wiring is hermetic',
      metadata: {
        quotaCatalog: 'deploy/src/hosted/quotas.ts (normative source: docs/deployment/free-tier-architecture.md)',
        exhaustTests: 'pending launch-day evidence'
      }
    },
    {
      id: 'deploy-001',
      type: 'deployment',
      name: 'Deployment Health (Gate B acceptance)',
      description:
        'Hosted preview deployment health: deployment-root smoke check (GET / → 2xx/3xx, deploy-workflow parity) plus the B019 acceptance battery',
      command:
        'curl -sS -o /dev/null -w \'%{http_code}\' "__ARENA_PREVIEW_URL__" && ARENA_PREVIEW_URL="__ARENA_PREVIEW_URL__" pnpm --filter @arena/deploy-preview run run',
      artifactRef: 'deploy/preview/src/acceptance/health-checker.test.ts',
      reproducibility:
        'The product exposes no dedicated /api/health endpoint; the probe is the deployment root + real route walks (workflow smoke-check parity)',
      metadata: {
        deploymentUrl: '__ARENA_PREVIEW_URL__',
        probeSurface: 'GET / (2xx/3xx), GET /demo, GET /operations, GET /demo/operations, POST /demo/reset (303 → /demo)',
        healthStatus: 'pending launch-day evidence'
      }
    },
    {
      id: 'install-001',
      type: 'installation',
      name: 'Fresh-Machine Installation',
      description: 'B016 fresh-machine install: prereq check → pnpm install → build → verify (no provider accounts)',
      command: 'node scripts/product/install.mjs',
      artifactRef: 'scripts/product/README.md',
      reproducibility: 'Plain-Node installer (zero external deps; Node ≥ 22; honest prereq failures)',
      metadata: {
        environment: 'Node 22 (repo engines pin) + pnpm@10.34.5 via corepack',
        installLog: 'pending launch-day evidence'
      }
    }
  ]
}

export class EvidenceGenerator {
  async generate(config: GeneratorConfig): Promise<{
    bundle: EvidenceBundle
    outputPath: string
    summary: Record<string, unknown>
  }> {
    logger.info('Generating preview evidence bundle...')

    // Ensure output directory exists
    if (!existsSync(config.outputDir)) {
      mkdirSync(config.outputDir, { recursive: true })
    }

    const timestamp = config.timestamp ?? new Date().toISOString()

    // Assemble the Gate-F records: skeleton + launch-day inputs.
    const records: EvidenceRecord[] = gateFRecordSkeletons().map((skeleton) => {
      const input = config.inputs?.[skeleton.id]
      const record: EvidenceRecord = {
        id: skeleton.id,
        type: skeleton.type,
        name: skeleton.name,
        description: skeleton.description,
        command: skeleton.command,
        exitStatus: input?.exitStatus ?? EXIT_STATUS_NOT_RUN,
        artifactRef: input?.artifactRef ?? skeleton.artifactRef,
        reproducibility: skeleton.reproducibility,
        timestamp,
        version: '1.0.0',
        metadata: { ...skeleton.metadata, ...input?.metadata }
      }
      return record
    })

    const passedRecords = records.filter((r) => r.exitStatus === 0).length
    const failedRecords = records.filter(
      (r) => r.exitStatus !== 0 && r.exitStatus !== EXIT_STATUS_NOT_RUN
    ).length
    const pendingRecords = records.filter(
      (r) => r.exitStatus === EXIT_STATUS_NOT_RUN
    ).length

    const gateStatus: EvidenceBundle['summary']['gateStatus'] =
      failedRecords > 0 ? 'FAILED' : pendingRecords > 0 ? 'INCOMPLETE' : 'PASSED'

    // Deterministic bundle id (fixed timestamp input → byte-identical bundle).
    const bundleId = `evidence-gate-f-${timestamp.replace(/[:.]/g, '-')}`

    // Create evidence bundle
    const bundle: EvidenceBundle = {
      id: bundleId,
      timestamp,
      version: '1.0.0',
      ...(config.previewUrl !== undefined ? { previewUrl: config.previewUrl } : {}),
      records,
      summary: {
        totalRecords: records.length,
        passedRecords,
        failedRecords,
        pendingRecords,
        gateStatus
      }
    }

    // Write bundle to file
    const outputPath = join(config.outputDir, 'evidence-bundle.json')
    writeFileSync(outputPath, JSON.stringify(bundle, null, 2))

    // Generate summary report
    const summary = this.generateSummary(bundle)

    logger.info(`Evidence bundle generated: ${outputPath}`)

    return {
      bundle,
      outputPath,
      summary
    }
  }

  private generateSummary(bundle: EvidenceBundle): Record<string, unknown> {
    return {
      totalRecords: bundle.summary.totalRecords,
      passedRecords: bundle.summary.passedRecords,
      failedRecords: bundle.summary.failedRecords,
      pendingRecords: bundle.summary.pendingRecords,
      successRate:
        bundle.summary.totalRecords > 0
          ? (
              (bundle.summary.passedRecords / bundle.summary.totalRecords) *
              100
            ).toFixed(1) + '%'
          : 'N/A',
      gateStatus: bundle.summary.gateStatus,
      timestamp: bundle.timestamp,
      previewUrl: bundle.previewUrl,
      recommendations:
        bundle.summary.gateStatus === 'PASSED'
          ? ['All Gate-F checks ran green — ready for launch-gate sign-off']
          : bundle.summary.gateStatus === 'FAILED'
            ? ['Address failed Gate-F checks before launch']
            : [
                'Pending launch-day evidence: fill the real exit statuses through the generator inputs (see README.md) — a pending bundle is INCOMPLETE by construction'
              ]
    }
  }
}

export const evidenceGenerator = new EvidenceGenerator()
