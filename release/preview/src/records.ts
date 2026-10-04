/**
 * B019 Preview Release Evidence Records
 *
 * Typed record types for the Gate-F evidence set, extending the
 * release/src record pattern. zod schemas validate the bundle shape;
 * the record TYPES are the committed contract the TL fills at the
 * launch gate (see README.md).
 */

import { z } from 'zod'

/**
 * Sentinel exit status for a check that has NOT been run yet.
 * The generator emits Gate-F record skeletons with this status; the
 * TL (or CI) replaces it with the real exit status of the real command
 * at the launch gate. A bundle containing pending records is INCOMPLETE
 * — it can never read as PASSED.
 */
export const EXIT_STATUS_NOT_RUN = -1

// Base evidence record schema
export const EvidenceRecordSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string(),
  command: z.string(),
  exitStatus: z.number(),
  artifactRef: z.string(),
  reproducibility: z.string(),
  timestamp: z.string(),
  version: z.string(),
  metadata: z.record(z.string(), z.unknown())
})

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>

// Gate-F evidence types (typed views over the metadata payloads)
export const CIEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('ci'),
  pipelineId: z.string(),
  commitSha: z.string(),
  duration: z.number(),
  stages: z.array(z.object({
    name: z.string(),
    status: z.string(),
    duration: z.number()
  }))
})

export type CIEvidence = z.infer<typeof CIEvidenceSchema>

export const ProductE2EEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('product-e2e'),
  testSuite: z.string(),
  totalTests: z.number(),
  passedTests: z.number(),
  failedTests: z.number(),
  skippedTests: z.number(),
  duration: z.number(),
  coverage: z.string(),
  testFiles: z.array(z.string())
})

export type ProductE2EEvidence = z.infer<typeof ProductE2EEvidenceSchema>

export const AccessibilityEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('accessibility'),
  auditTool: z.string(),
  violations: z.array(z.object({
    id: z.string(),
    severity: z.string(),
    description: z.string(),
    impact: z.string(),
    elements: z.array(z.string())
  })),
  totalViolations: z.number(),
  criticalViolations: z.number(),
  passed: z.boolean()
})

export type AccessibilityEvidence = z.infer<typeof AccessibilityEvidenceSchema>

export const PerformanceEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('performance'),
  budget: z.string(),
  metrics: z.object({
    lcp: z.number(),
    fid: z.number(),
    cls: z.number(),
    tbt: z.number(),
    speedIndex: z.number()
  }),
  passed: z.boolean(),
  deviations: z.array(z.object({
    metric: z.string(),
    expected: z.number(),
    actual: z.number(),
    deviation: z.number()
  }))
})

export type PerformanceEvidence = z.infer<typeof PerformanceEvidenceSchema>

export const SecurityEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('security'),
  scanTool: z.string(),
  vulnerabilities: z.array(z.object({
    severity: z.string(),
    cve: z.string(),
    description: z.string(),
    affectedFiles: z.array(z.string())
  })),
  criticalVulnerabilities: z.number(),
  passed: z.boolean()
})

export type SecurityEvidence = z.infer<typeof SecurityEvidenceSchema>

export const QuotaEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('quota'),
  providers: z.array(z.object({
    name: z.string(),
    type: z.string(),
    usage: z.number(),
    limit: z.number(),
    percentage: z.number(),
    state: z.string()
  })),
  exhaustTests: z.array(z.object({
    provider: z.string(),
    testResult: z.string(),
    failClosed: z.boolean()
  })),
  passed: z.boolean()
})

export type QuotaEvidence = z.infer<typeof QuotaEvidenceSchema>

export const DeploymentEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('deployment'),
  deploymentUrl: z.string(),
  healthStatus: z.string(),
  responseTime: z.number(),
  uptime: z.number(),
  passed: z.boolean()
})

export type DeploymentEvidence = z.infer<typeof DeploymentEvidenceSchema>

export const InstallationEvidenceSchema = EvidenceRecordSchema.extend({
  type: z.literal('installation'),
  environment: z.string(),
  steps: z.array(z.object({
    step: z.string(),
    status: z.string(),
    duration: z.number(),
    output: z.string()
  })),
  totalDuration: z.number(),
  passed: z.boolean()
})

export type InstallationEvidence = z.infer<typeof InstallationEvidenceSchema>

// Evidence bundle type
export const EvidenceBundleSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  version: z.string(),
  previewUrl: z.string().optional(),
  records: z.array(EvidenceRecordSchema),
  summary: z.object({
    totalRecords: z.number(),
    passedRecords: z.number(),
    failedRecords: z.number(),
    pendingRecords: z.number(),
    gateStatus: z.enum(['PASSED', 'FAILED', 'INCOMPLETE'])
  })
})

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>

/**
 * Builder for one evidence record (one instance per record — the builder
 * is stateful, so never share it across records).
 */
export class EvidenceRecordBuilder {
  private record: Partial<EvidenceRecord> = {}

  id(id: string): this {
    this.record.id = id
    return this
  }

  type(type: string): this {
    this.record.type = type
    return this
  }

  name(name: string): this {
    this.record.name = name
    return this
  }

  description(description: string): this {
    this.record.description = description
    return this
  }

  command(command: string): this {
    this.record.command = command
    return this
  }

  exitStatus(exitStatus: number): this {
    this.record.exitStatus = exitStatus
    return this
  }

  artifactRef(artifactRef: string): this {
    this.record.artifactRef = artifactRef
    return this
  }

  reproducibility(reproducibility: string): this {
    this.record.reproducibility = reproducibility
    return this
  }

  timestamp(timestamp: string): this {
    this.record.timestamp = timestamp
    return this
  }

  version(version: string): this {
    this.record.version = version
    return this
  }

  metadata(metadata: Record<string, unknown>): this {
    this.record.metadata = metadata
    return this
  }

  build(): EvidenceRecord {
    if (
      !this.record.id ||
      !this.record.type ||
      !this.record.name ||
      !this.record.description ||
      !this.record.command ||
      this.record.exitStatus === undefined ||
      !this.record.artifactRef ||
      !this.record.reproducibility ||
      !this.record.timestamp ||
      !this.record.version ||
      !this.record.metadata
    ) {
      throw new Error('Missing required fields for evidence record')
    }
    return this.record as EvidenceRecord
  }
}
