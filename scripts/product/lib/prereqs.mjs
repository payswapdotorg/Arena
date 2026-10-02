/**
 * Prerequisite checks for the local install workflow (Work Order B016).
 *
 * PURE logic (plus optional fs probes wired by the commands): Node engine
 * range against the ROOT manifest's engines.node (parsed, not hardcoded —
 * the script stays truthful if the pin moves), the exact pnpm pin from
 * packageManager, and a disk-space floor. Every failure carries an
 * actionable "next" action — never just a bare version dump.
 *
 * Plain .mjs — zero external dependencies.
 */

/** Recommended free disk space for a full local install (2 GiB). */
export const MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * @typedef {{ major: number, minor: number, patch: number }} SemVer
 */

/**
 * Parse a Node version string like 'v22.21.1' / '22.9.0' / 'v22'.
 *
 * @param {string} version
 * @returns {SemVer | null} null when the string is not a recognizable version.
 */
export function parseNodeVersion(version) {
  if (typeof version !== 'string') return null;
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

/**
 * Parse the repository's bounded engines range (e.g. '>=22 <23').
 *
 * The frozen-dependency governance keeps this in the bounded
 * `>=MAJOR[.MINOR] <MAJOR[.MINOR]` shape; anything else is treated as
 * unrecognized so the check fails LOUDLY (an honest script never guesses).
 *
 * @param {string} enginesText
 * @returns {{ minMajor: number, minMinor: number, maxMajorExclusive: number, maxMinorExclusive: number } | null}
 */
export function parseEnginesRange(enginesText) {
  if (typeof enginesText !== 'string') return null;
  const match = /^>=\s*(\d+)(?:\.(\d+))?\s*<\s*(\d+)(?:\.(\d+))?$/.exec(enginesText.trim());
  if (match === null) return null;
  return {
    minMajor: Number(match[1]),
    minMinor: Number(match[2] ?? 0),
    maxMajorExclusive: Number(match[3]),
    maxMinorExclusive: Number(match[4] ?? 0),
  };
}

function atLeast(parsed, major, minor) {
  return parsed.major > major || (parsed.major === major && parsed.minor >= minor);
}

function belowExclusive(parsed, major, minor) {
  return parsed.major < major || (parsed.major === major && parsed.minor < minor);
}

/**
 * @typedef {{ status: 'pass' | 'fail', summary: string, detail?: string, next?: string }} CheckResult
 */

/**
 * Check a running Node version against the manifest engines range.
 *
 * @param {string} nodeVersion — e.g. process.version ('v22.21.1').
 * @param {string} enginesText — root package.json engines.node.
 * @returns {CheckResult}
 */
export function checkNodeVersion(nodeVersion, enginesText) {
  const range = parseEnginesRange(enginesText);
  if (range === null) {
    return {
      status: 'fail',
      summary: `unrecognized engines.node range ${JSON.stringify(enginesText)}`,
      detail: 'the product scripts only understand the bounded ">=MAJOR <MAJOR" pin shape',
      next: 'report this to the maintainers — scripts/product must be updated to match the new engines pin',
    };
  }
  const parsed = parseNodeVersion(nodeVersion);
  if (parsed === null) {
    return {
      status: 'fail',
      summary: `could not parse the running Node version ${JSON.stringify(nodeVersion)}`,
      next: 'install Node 22 (https://nodejs.org, or `nvm install 22`) and re-run',
    };
  }
  const rangeText = enginesText.trim();
  if (atLeast(parsed, range.minMajor, range.minMinor) && belowExclusive(parsed, range.maxMajorExclusive, range.maxMinorExclusive)) {
    return { status: 'pass', summary: `node ${nodeVersion} satisfies engines ${rangeText}` };
  }
  return {
    status: 'fail',
    summary: `node ${nodeVersion} is OUTSIDE the supported range ${rangeText}`,
    detail: 'this repository pins Node 22; other majors are untested and pnpm install will refuse to run (engine-strict)',
    next: 'install Node 22 (`nvm install 22 && nvm use 22`, or fetch it from https://nodejs.org) and re-run',
  };
}

/**
 * Check the resolved pnpm version against the exact packageManager pin.
 *
 * @param {string | null} pnpmVersion — `pnpm --version` output, or null when pnpm is not on PATH.
 * @param {string} packageManagerPin — root package.json packageManager (e.g. 'pnpm@10.34.5').
 * @returns {CheckResult}
 */
export function checkPnpmVersion(pnpmVersion, packageManagerPin) {
  const at = packageManagerPin.indexOf('@');
  const expected = at === -1 ? packageManagerPin : packageManagerPin.slice(at + 1);
  if (pnpmVersion === null || pnpmVersion === undefined) {
    return {
      status: 'fail',
      summary: 'pnpm is not on PATH',
      detail: 'the repository pins pnpm exactly via the packageManager field (corepack selects it automatically)',
      next: 'run `corepack enable` (Node 22 bundles corepack) and re-run',
    };
  }
  const actual = String(pnpmVersion).trim();
  if (actual === expected) {
    return { status: 'pass', summary: `pnpm ${actual} (packageManager pin)` };
  }
  return {
    status: 'fail',
    summary: `pnpm ${actual} does not match the pinned pnpm ${expected}`,
    detail: 'the frozen dependency policy pins pnpm exactly',
    next: `run \`corepack enable && corepack prepare pnpm@${expected} --activate\` (from the repository root) and re-run`,
  };
}

/**
 * Check free disk space against the install floor.
 *
 * @param {number | null} freeBytes — bytes free, or null when the probe failed.
 * @param {number} [minBytes]
 * @returns {CheckResult}
 */
export function checkDiskFree(freeBytes, minBytes = MIN_DISK_BYTES) {
  if (freeBytes === null || freeBytes === undefined || !Number.isFinite(freeBytes)) {
    return {
      status: 'fail',
      summary: 'could not read free disk space',
      next: 'check the volume manually (df -h) and re-run; a full local install needs roughly 2 GiB free',
    };
  }
  if (freeBytes >= minBytes) {
    return { status: 'pass', summary: `${formatBytes(freeBytes)} free (>= ${formatBytes(minBytes)} recommended)` };
  }
  return {
    status: 'fail',
    summary: `only ${formatBytes(freeBytes)} free (< ${formatBytes(minBytes)} recommended)`,
    next: 'free up disk space and re-run',
  };
}

/**
 * Format a byte count in GiB/MiB (deterministic, one decimal).
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${Math.max(0, Math.round(bytes / 1024))} KiB`;
}
