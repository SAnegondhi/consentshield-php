import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult
} from '@playwright/test/reporter'
import {
  startRun,
  recordTest,
  addAttachment,
  copyDirAttachment,
  finalize,
  type RunHandle,
  type ManifestTestResult
} from './evidence.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = resolve(HERE, '..')

/**
 * ADR-1014 Sprint 1.4 — Playwright reporter that packages each run into a
 * sealed evidence archive at `tests/e2e/evidence/<commitShort>/<runId>/`.
 *
 * Always runs (enabled in playwright.config.ts reporters array). Writes:
 *   attachments/
 *     playwright-report/         # Playwright HTML report
 *     results.json               # Playwright JSON reporter
 *     trace-ids/<test>.txt       # Trace id per test (from fixture attachment)
 *     responses/<test>-<name>.json  # Response-body attachments
 *   manifest.json                # Run metadata, test outcomes, attachment hashes
 *   seal.txt                     # SHA-256 seal over the entire archive
 */
export default class EvidenceReporter implements Reporter {
  private handle: RunHandle | null = null
  private projects: Set<string> = new Set()

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.handle = startRun()
    process.stdout.write(
      `\n[evidence] starting run ${this.handle.runId} ` +
        `(commit ${this.handle.commitShort})\n`
    )
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.handle) return
    const projectName = test.parent.project()?.name ?? 'unknown'
    this.projects.add(projectName)

    const traceIds: string[] = []
    for (const attachment of result.attachments) {
      // trace-id.txt is attached by the traceId fixture for every test.
      if (attachment.name === 'trace-id.txt' && attachment.body) {
        const tid = Buffer.from(attachment.body).toString('utf8')
        traceIds.push(tid)
        addAttachment(
          this.handle,
          `trace-ids/${sanitize(test.titlePath().join('--'))}.txt`,
          tid
        )
      }
      // Response + row attachments are JSON — useful evidence of observed state.
      if (attachment.name.endsWith('.json') && attachment.body) {
        addAttachment(
          this.handle,
          `responses/${sanitize(test.titlePath().join('--'))}--${sanitize(attachment.name)}`,
          attachment.body
        )
      }
    }

    const entry: ManifestTestResult = {
      file: normalizeFile(test.location.file),
      title: test.titlePath().slice(3).join(' › '),
      project: projectName,
      status: result.status,
      duration_ms: result.duration,
      retries: result.retry,
      trace_ids: traceIds,
      error_message: result.error?.message?.split('\n')[0]
    }
    recordTest(this.handle, entry)
  }

  onEnd(_result: FullResult): void | Promise<void> {
    if (!this.handle) return

    // Copy Playwright report + JSON results into the archive if they exist.
    const reportDir = resolve(WORKSPACE_ROOT, 'playwright-report')
    if (existsSync(reportDir)) copyDirAttachment(this.handle, reportDir, 'playwright-report')

    const jsonResults = resolve(WORKSPACE_ROOT, 'test-results', 'results.json')
    if (existsSync(jsonResults)) {
      addAttachment(this.handle, 'results.json', readFileSync(jsonResults))
    }

    const { seal, sealPath, manifestPath } = finalize(this.handle, {
      playwrightProjects: Array.from(this.projects).sort()
    })
    const summary = this.handle.manifest.summary!
    process.stdout.write(
      `[evidence] archive sealed: ${this.handle.runDir}\n` +
        `[evidence]   manifest: ${manifestPath}\n` +
        `[evidence]   seal    : ${sealPath}\n` +
        `[evidence]   root    : ${seal.slice(0, 16)}…\n` +
        `[evidence]   tests   : ${summary.total} total, ${summary.passed} passed, ` +
        `${summary.failed} failed, ${summary.skipped} skipped, ${summary.flaky} flaky\n` +
        `[evidence] verify with: bunx tsx scripts/e2e-verify-evidence.ts ${this.handle.runDir}\n`
    )
  }
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160)
}

function normalizeFile(absPath: string): string {
  const workspacePrefix = WORKSPACE_ROOT + '/'
  return absPath.startsWith(workspacePrefix)
    ? absPath.slice(workspacePrefix.length)
    : absPath
}
