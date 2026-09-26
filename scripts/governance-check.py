#!/usr/bin/env python3
"""Arena governance checker (Work Order A001).

Machine checks required by docs/GOVERNANCE.md ("Governance checks") and the
A001 acceptance criteria:

  G1  required source-of-truth files present and non-empty
  G2  architecture lock presence: docs/architecture-lock.md non-empty, version
      header A1.0, contiguous numbered rules (24 for A1.0), ACR section
  G3  authorized frontier consistency: every AUTHORIZED/ACTIVE item listed in
      spec/PROJECT-STATE.md "Current frontier" exists in spec/work-items.md
  G4  work-order ownership: every changed path (dispatch base -> HEAD) is
      inside the owned surfaces of SOME work order
      (scripts/work-order-surfaces.json)
  G5  concurrent overlap: concurrently AUTHORIZED/ACTIVE work orders have
      pairwise-disjoint owned surfaces; at most 3 concurrent
  G6  frozen dependency policy: exact pins only (no floating ranges),
      .npmrc save-exact, bounded engines, exact packageManager, exact
      pnpm catalog versions, lockfile present
  G7  protocol-core purity: zero runtime dependencies and no model/provider
      names in source (architecture-lock rule 10)
  G8  CI workflow present with pinned action refs and the full battery
  G9  generated-contract drift: regenerate contracts and compare with the
      committed copies (stub mechanism; generators plug into
      scripts/generate-contracts.mjs)

Usage:
  python3 scripts/governance-check.py                 # self-test + repo check
  python3 scripts/governance-check.py --check-only    # repo check only
  python3 scripts/governance-check.py --self-test-only
  python3 scripts/governance-check.py --base <sha>    # override diff base

Exit codes: 0 = clean, 1 = violations or self-test failure, 2 = usage error.

The self-test deliberately feeds violation fixtures (scripts/fixtures/) into
each check and REQUIRES that they fail; a fixture that does not fail is a
self-test failure. This is the negative-test evidence required by the A001
verification battery.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from fnmatch import fnmatchcase
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

EXPECTED_LOCK_VERSION = "A1.0"
EXPECTED_LOCK_RULE_COUNT = 24
MAX_CONCURRENT_WORKERS = 3
ACTIVE_STATUSES = {"ACTIVE", "AUTHORIZED"}
KNOWN_STATUSES = ACTIVE_STATUSES | {
    "WAITING_ON_DEPENDENCIES",
    "READY",
    "REVIEW",
    "ACCEPTED",
    "MERGED",
}

REQUIRED_FILES = [
    "AGENTS.md",
    "AI_CONTINUATION.md",
    "README.md",
    "docs/GOVERNANCE.md",
    "docs/IMPLEMENTATION-PLAN.md",
    "docs/LLM-ARCHITECT-HANDOFF.md",
    "docs/architecture-lock.md",
    "docs/architecture.md",
    "spec/PROJECT-STATE.md",
    "spec/dependency-graph.md",
    "spec/quality-model.md",
    "spec/requirements.md",
    "spec/service-boundaries.md",
    "spec/work-items.md",
    "spec/worker-runbook.md",
]

SURFACES_REGISTRY = REPO_ROOT / "scripts" / "work-order-surfaces.json"

# ---------------------------------------------------------------------------
# Pure check functions (also driven by self-test fixtures)
# ---------------------------------------------------------------------------


def check_required_files(root: Path) -> list[str]:
    violations: list[str] = []
    for rel in REQUIRED_FILES:
        path = root / rel
        if not path.is_file():
            violations.append(f"[G1-required-files] missing source-of-truth file: {rel}")
        elif path.stat().st_size == 0:
            violations.append(f"[G1-required-files] empty source-of-truth file: {rel}")
    return violations


def check_architecture_lock_text(lock_text: str) -> list[str]:
    violations: list[str] = []
    if not lock_text.strip():
        return ["[G2-architecture-lock] docs/architecture-lock.md is empty"]

    lines = lock_text.splitlines()
    header = next((ln for ln in lines if ln.startswith("# ")), "")
    match = re.match(r"^# Arena Architecture Lock (A\d+\.\d+)\s*$", header)
    if not match:
        violations.append(
            f"[G2-architecture-lock] bad or missing version header: {header!r} "
            f"(expected '# Arena Architecture Lock <version>')"
        )
    else:
        version = match.group(1)
        if version != EXPECTED_LOCK_VERSION:
            violations.append(
                f"[G2-architecture-lock] lock version {version} does not match the "
                f"expected {EXPECTED_LOCK_VERSION} (a lock bump requires a recorded ACR)"
            )

    rule_numbers = [
        int(m.group(1)) for m in (re.match(r"^(\d+)\. ", ln) for ln in lines) if m
    ]
    if not rule_numbers:
        violations.append("[G2-architecture-lock] no numbered rules found")
    elif rule_numbers != list(range(1, len(rule_numbers) + 1)):
        violations.append(
            f"[G2-architecture-lock] rule numbering not contiguous from 1: {rule_numbers}"
        )
    elif len(rule_numbers) != EXPECTED_LOCK_RULE_COUNT:
        violations.append(
            f"[G2-architecture-lock] expected {EXPECTED_LOCK_RULE_COUNT} locked rules, "
            f"found {len(rule_numbers)}"
        )

    if "## Architecture Change Request" not in lock_text:
        violations.append("[G2-architecture-lock] missing '## Architecture Change Request' section")
    return violations


def parse_frontier(project_state_text: str) -> dict[str, str]:
    """Parse the '## Current frontier' section of spec/PROJECT-STATE.md."""
    frontier: dict[str, str] = {}
    in_section = False
    for line in project_state_text.splitlines():
        if line.startswith("## "):
            in_section = line.strip() == "## Current frontier"
            continue
        if in_section:
            match = re.match(r"^-\s+(A\d{3})\s+(\S+)\s*$", line.strip())
            if match:
                frontier[match.group(1)] = match.group(2)
    return frontier


def parse_work_item_ids(work_items_text: str) -> set[str]:
    ids: set[str] = set()
    for match in re.finditer(r"^\|\s*(A\d{3})\s*\|", work_items_text, re.M):
        ids.add(match.group(1))
    return ids


def check_frontier_consistency(project_state_text: str, work_items_text: str) -> list[str]:
    violations: list[str] = []
    frontier = parse_frontier(project_state_text)
    known_ids = parse_work_item_ids(work_items_text)
    if not frontier:
        return ["[G3-frontier] no frontier entries found in spec/PROJECT-STATE.md"]
    for item, status in frontier.items():
        if status not in KNOWN_STATUSES:
            violations.append(
                f"[G3-frontier] unknown status {status!r} for {item}"
            )
        if item not in known_ids:
            violations.append(
                f"[G3-frontier] frontier item {item} is not defined in spec/work-items.md"
            )
    active = [item for item, status in frontier.items() if status in ACTIVE_STATUSES]
    if len(active) > MAX_CONCURRENT_WORKERS:
        violations.append(
            f"[G3-frontier] {len(active)} concurrent active work orders exceeds the "
            f"maximum of {MAX_CONCURRENT_WORKERS}: {sorted(active)}"
        )
    return violations


def load_surfaces(registry_path: Path) -> dict[str, list[str]]:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    surfaces = {
        wo_id: list(entry["surfaces"])
        for wo_id, entry in registry["work_orders"].items()
    }
    for carve in registry.get("carve_outs", []):
        surfaces.setdefault(carve["work_order"], []).extend(carve["paths"])
    return surfaces


def path_matches_surface(path: str, pattern: str) -> bool:
    return fnmatchcase(path, pattern)


def check_ownership(
    changed_paths: list[str], surfaces: dict[str, list[str]]
) -> list[str]:
    violations: list[str] = []
    for path in changed_paths:
        if not any(
            path_matches_surface(path, pattern)
            for patterns in surfaces.values()
            for pattern in patterns
        ):
            violations.append(
                f"[G4-ownership] changed path not owned by any work order: {path}"
            )
    return violations


def globs_potentially_overlap(pattern_a: str, pattern_b: str) -> bool:
    """Conservative overlap test for fnmatch-style surface globs.

    Two globs can match a common path only if their literal prefixes (the
    part before the first '*') are equal or one is a prefix of the other.
    Exact paths (no '*') are compared literally via prefix semantics too.
    """
    prefix_a = pattern_a.split("*")[0]
    prefix_b = pattern_b.split("*")[0]
    if not prefix_a or not prefix_b:
        return True  # a pattern with no literal prefix can match anything
    if "*" not in pattern_a and "*" not in pattern_b:
        return pattern_a == pattern_b
    if "*" not in pattern_a:
        return fnmatchcase(pattern_a, pattern_b)
    if "*" not in pattern_b:
        return fnmatchcase(pattern_b, pattern_a)
    return prefix_a.startswith(prefix_b) or prefix_b.startswith(prefix_a)


def check_concurrent_overlap(
    active_work_orders: list[str], surfaces: dict[str, list[str]]
) -> list[str]:
    violations: list[str] = []
    active = sorted(active_work_orders)
    for i, wo_a in enumerate(active):
        for wo_b in active[i + 1 :]:
            overlapping = [
                (pa, pb)
                for pa in surfaces.get(wo_a, [])
                for pb in surfaces.get(wo_b, [])
                if globs_potentially_overlap(pa, pb)
            ]
            if overlapping:
                violations.append(
                    f"[G5-overlap] work orders {wo_a} and {wo_b} have potentially "
                    f"overlapping owned surfaces: {overlapping[0][0]!r} vs {overlapping[0][1]!r}"
                )
    return violations


EXACT_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$")
ALLOWED_DEP_SPECS_RE = re.compile(
    r"^(?:"  # one of:
    r"\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?"  # exact version
    r"|catalog:"  # pnpm catalog reference (catalog itself is exactness-checked)
    r"|workspace:\*"  # local workspace link
    r"|workspace:\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?"  # exact local version
    r")$"
)
DEPENDENCY_FIELDS = (
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
)


def validate_dependency_specs(
    manifest: dict, manifest_path: str
) -> list[str]:
    violations: list[str] = []
    for field in DEPENDENCY_FIELDS:
        deps = manifest.get(field)
        if deps is None:
            continue
        if not isinstance(deps, dict):
            violations.append(
                f"[G6-frozen-deps] {manifest_path}: field '{field}' must be an object"
            )
            continue
        for name, spec in deps.items():
            if not isinstance(spec, str) or not ALLOWED_DEP_SPECS_RE.match(spec):
                violations.append(
                    f"[G6-frozen-deps] {manifest_path}: non-exact dependency spec "
                    f"{name}@{spec!r} in '{field}' (allowed: exact semver, 'catalog:', "
                    f"'workspace:*', 'workspace:<exact>')"
                )
    return violations


def validate_npmrc(npmrc_text: str | None) -> list[str]:
    violations: list[str] = []
    if npmrc_text is None:
        return ["[G6-frozen-deps] .npmrc is missing"]
    for required in ("save-exact=true", "engine-strict=true"):
        if not any(
            line.strip() == required for line in npmrc_text.splitlines()
        ):
            violations.append(
                f"[G6-frozen-deps] .npmrc must contain '{required}'"
            )
    return violations


def validate_root_engines(root_manifest: dict) -> list[str]:
    violations: list[str] = []
    node_range = root_manifest.get("engines", {}).get("node")
    if not isinstance(node_range, str) or not re.match(
        r"^>=\d+(\.\d+)?\s*<\d+(\.\d+)?$", node_range
    ):
        violations.append(
            f"[G6-frozen-deps] root engines.node must be a bounded pin like '>=22 <23', "
            f"got {node_range!r}"
        )
    package_manager = root_manifest.get("packageManager")
    if not isinstance(package_manager, str) or not re.match(
        r"^pnpm@\d+\.\d+\.\d+$", package_manager
    ):
        violations.append(
            f"[G6-frozen-deps] root packageManager must be exactly pinned like "
            f"'pnpm@10.34.5', got {package_manager!r}"
        )
    return violations


def validate_catalog_versions(workspace_yaml_text: str) -> list[str]:
    """Check that every pnpm catalog entry is an exact version."""
    violations: list[str] = []
    in_catalog = False
    for line in workspace_yaml_text.splitlines():
        stripped = line.strip()
        if stripped == "catalog:":
            in_catalog = True
            continue
        if in_catalog:
            if stripped and not line.startswith(" "):
                in_catalog = False
                continue
            match = re.match(r'^"?([^"#:]+)"?\s*:\s*"?([^"\s]+)"?\s*$', stripped)
            if match and not stripped.startswith("#"):
                name, version = match.group(1), match.group(2)
                if not EXACT_VERSION_RE.match(version):
                    violations.append(
                        f"[G6-frozen-deps] pnpm catalog entry {name} has non-exact "
                        f"version {version!r}"
                    )
    return violations


def parse_workspace_package_globs(workspace_yaml_text: str) -> list[str]:
    globs: list[str] = []
    in_packages = False
    for line in workspace_yaml_text.splitlines():
        stripped = line.strip()
        if stripped == "packages:":
            in_packages = True
            continue
        if in_packages:
            if not stripped:
                continue
            if not line.startswith((" ", "-")):
                in_packages = False
                continue
            match = re.match(r'^-\s+"?([^"#]+?)"?$', stripped)
            if match:
                globs.append(match.group(1))
    return globs


BANNED_PROVIDER_RE = re.compile(
    r"\b(openai|anthropic|claude|gemini|gpt-\d+|bedrock|mistral|groq|ollama|"
    r"deepseek|copilot)\b",
    re.IGNORECASE,
)


def check_protocol_core_purity(
    pkg_manifest: dict | None, source_files: dict[str, str]
) -> list[str]:
    violations: list[str] = []
    if pkg_manifest is None:
        return ["[G7-purity] packages/protocol-core/package.json is missing"]
    for field in ("dependencies", "optionalDependencies", "peerDependencies"):
        if pkg_manifest.get(field):
            violations.append(
                f"[G7-purity] packages/protocol-core must have zero runtime "
                f"dependencies; '{field}' is non-empty (architecture-lock rule 10: "
                f"protocol primitives stay provider-neutral and dependency-free)"
            )
    for rel_path, text in source_files.items():
        match = BANNED_PROVIDER_RE.search(text)
        if match:
            violations.append(
                f"[G7-purity] model/provider name {match.group(1)!r} found in "
                f"packages/protocol-core/{rel_path} (architecture-lock rule 10: "
                f"model/provider details remain behind adapters)"
            )
    return violations


def check_ci_workflow_text(ci_text: str | None) -> list[str]:
    violations: list[str] = []
    if ci_text is None:
        return ["[G8-ci] .github/workflows/ci.yml is missing"]
    if not ci_text.strip():
        return ["[G8-ci] .github/workflows/ci.yml is empty"]

    for trigger in ("pull_request", "push"):
        if not re.search(rf"^\s*{trigger}:", ci_text, re.M):
            violations.append(f"[G8-ci] ci.yml must trigger on '{trigger}'")

    for uses_line in re.finditer(r"uses:\s*(\S+)", ci_text):
        ref = uses_line.group(1)
        if not re.match(r"^[^@]+@(v\d+\.\d+\.\d+|[0-9a-f]{40})$", ref):
            violations.append(
                f"[G8-ci] action ref {ref!r} is not pinned to an exact tag or commit SHA"
            )

    required_steps = [
        "pnpm install --frozen-lockfile",
        "pnpm governance",
        "pnpm boundary",
        "pnpm typecheck",
        "pnpm lint",
        "pnpm test",
        "pnpm build",
    ]
    for step in required_steps:
        if step not in ci_text:
            violations.append(f"[G8-ci] ci.yml is missing battery step '{step}'")
    return violations


# ---------------------------------------------------------------------------
# Repo wiring
# ---------------------------------------------------------------------------


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed: {result.stderr.strip()}"
        )
    return result.stdout


def resolve_diff_base(repo: Path, override: str | None) -> str:
    if override:
        return override
    for candidate in ("main", "origin/main"):
        result = subprocess.run(
            ["git", "-C", str(repo), "merge-base", "HEAD", candidate],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    raise RuntimeError(
        "could not resolve diff base (no main/origin/main); pass --base <sha>"
    )


def changed_paths(repo: Path, base: str) -> list[str]:
    out = git(repo, "diff", "--name-only", base, "HEAD")
    return [line.strip() for line in out.splitlines() if line.strip()]


def check_frozen_dependencies_repo(root: Path) -> list[str]:
    violations: list[str] = []

    npmrc_text = (
        (root / ".npmrc").read_text(encoding="utf-8")
        if (root / ".npmrc").is_file()
        else None
    )
    violations += validate_npmrc(npmrc_text)

    root_manifest_path = root / "package.json"
    root_manifest = json.loads(root_manifest_path.read_text(encoding="utf-8"))
    violations += validate_root_engines(root_manifest)
    violations += validate_dependency_specs(root_manifest, "package.json")

    workspace_yaml_text = (root / "pnpm-workspace.yaml").read_text(encoding="utf-8")
    violations += validate_catalog_versions(workspace_yaml_text)

    lockfile = root / "pnpm-lock.yaml"
    if not lockfile.is_file() or lockfile.stat().st_size == 0:
        violations.append("[G6-frozen-deps] pnpm-lock.yaml is missing or empty")

    package_globs = parse_workspace_package_globs(workspace_yaml_text)
    for glob in package_globs:
        for manifest_path in sorted(root.glob(glob)):
            pkg_json = manifest_path / "package.json"
            if not pkg_json.is_file():
                continue
            rel = pkg_json.relative_to(root).as_posix()
            manifest = json.loads(pkg_json.read_text(encoding="utf-8"))
            violations += validate_dependency_specs(manifest, rel)
    return violations


def check_contract_drift_repo(root: Path) -> list[str]:
    generator = root / "scripts" / "generate-contracts.mjs"
    if not generator.is_file():
        return ["[G9-drift] scripts/generate-contracts.mjs is missing"]
    result = subprocess.run(
        ["node", str(generator), "--check"],
        capture_output=True,
        text=True,
        cwd=str(root),
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        return [f"[G9-drift] contract drift detected: {detail}"]
    return []


def run_repo_checks(root: Path, base_override: str | None) -> tuple[list[str], dict]:
    violations: list[str] = []
    summary: dict[str, int] = {}

    violations += check_required_files(root)
    lock_text = (root / "docs" / "architecture-lock.md").read_text(encoding="utf-8")
    violations += check_architecture_lock_text(lock_text)

    project_state_text = (root / "spec" / "PROJECT-STATE.md").read_text(encoding="utf-8")
    work_items_text = (root / "spec" / "work-items.md").read_text(encoding="utf-8")
    violations += check_frontier_consistency(project_state_text, work_items_text)

    surfaces = load_surfaces(SURFACES_REGISTRY)
    frontier = parse_frontier(project_state_text)
    active = [item for item, status in frontier.items() if status in ACTIVE_STATUSES]
    violations += check_concurrent_overlap(active, surfaces)

    base = resolve_diff_base(root, base_override)
    paths = changed_paths(root, base)
    ownership_violations = check_ownership(paths, surfaces)
    violations += ownership_violations

    violations += check_frozen_dependencies_repo(root)

    pkg_manifest_path = root / "packages" / "protocol-core" / "package.json"
    pkg_manifest = (
        json.loads(pkg_manifest_path.read_text(encoding="utf-8"))
        if pkg_manifest_path.is_file()
        else None
    )
    src_dir = root / "packages" / "protocol-core" / "src"
    source_files: dict[str, str] = {}
    if src_dir.is_dir():
        for path in sorted(src_dir.rglob("*.ts")):
            source_files[path.relative_to(src_dir).as_posix()] = path.read_text(
                encoding="utf-8"
            )
    violations += check_protocol_core_purity(pkg_manifest, source_files)

    ci_path = root / ".github" / "workflows" / "ci.yml"
    ci_text = (
        ci_path.read_text(encoding="utf-8") if ci_path.is_file() else None
    )
    violations += check_ci_workflow_text(ci_text)

    violations += check_contract_drift_repo(root)

    summary["diff_base"] = base  # type: ignore[assignment]
    summary["changed_paths"] = len(paths)
    summary["active_work_orders"] = len(active)
    return violations, summary


# ---------------------------------------------------------------------------
# Self-test (negative fixtures MUST fail the checks)
# ---------------------------------------------------------------------------


def self_test(repo_root: Path) -> tuple[int, int]:
    """Returns (passed, failed)."""
    fixtures = repo_root / "scripts" / "fixtures" / "governance"
    results: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))

    # G1: missing required file
    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        for rel in REQUIRED_FILES:
            (tree / rel).parent.mkdir(parents=True, exist_ok=True)
            (tree / rel).write_text("x", encoding="utf-8")
        (tree / "AGENTS.md").unlink()
        v = check_required_files(tree)
        record(
            "G1-missing-required-file",
            any("AGENTS.md" in message for message in v),
            str(v),
        )

    # G2: wrong version / broken numbering
    bad_lock = "# Arena Architecture Lock A2.0\n\n1. rule\n2. rule\n\n## Architecture Change Request\nx\n"
    v = check_architecture_lock_text(bad_lock)
    record(
        "G2-lock-wrong-version",
        any("does not match the expected A1.0" in m for m in v),
        str(v),
    )
    bad_numbering = (
        "# Arena Architecture Lock A1.0\n\n"
        + "\n".join(f"{i}. rule" for i in range(1, 24))
        + "\n\n## Architecture Change Request\nx\n"
    )
    v = check_architecture_lock_text(bad_numbering)
    record(
        "G2-lock-rule-count",
        any("locked rules" in m for m in v),
        str(v),
    )
    good_lock = (
        "# Arena Architecture Lock A1.0\n\n"
        + "\n".join(f"{i}. rule" for i in range(1, 25))
        + "\n\n## Architecture Change Request\nx\n"
    )
    v = check_architecture_lock_text(good_lock)
    record("G2-lock-good", v == [], str(v))

    # G3: frontier item not defined in work items
    work_items_fixture = (
        "# Work items\n\n| ID | Scope | Depends | Owned surfaces |\n|---|---|---|---|\n"
        "| A001 | foundation | — | scripts/* |\n"
        "| A002 | artifacts | A001 | packages/artifact-protocol/* |\n"
    )
    bad_state = "## Current frontier\n\n- A099 AUTHORIZED\n- A001 MERGED\n"
    v = check_frontier_consistency(bad_state, work_items_fixture)
    record(
        "G3-frontier-unknown-item",
        any("A099" in m for m in v),
        str(v),
    )
    good_state = "## Current frontier\n\n- A001 AUTHORIZED\n- A002 WAITING_ON_DEPENDENCIES\n"
    v = check_frontier_consistency(good_state, work_items_fixture)
    record("G3-frontier-good", v == [], str(v))
    overloaded_state = "## Current frontier\n\n" + "\n".join(
        f"- A00{i} AUTHORIZED" for i in range(1, 6)
    )
    v = check_frontier_consistency(overloaded_state, work_items_fixture)
    record(
        "G3-frontier-too-many-active",
        any("exceeds the maximum" in m for m in v),
        str(v),
    )

    # G4: changed path outside every owned surface
    fixture_surfaces = {
        "A001": ["scripts/*", "packages/protocol-core/*"],
        "A002": ["packages/artifact-protocol/*"],
    }
    v = check_ownership(
        ["scripts/governance-check.py", "packages/protocol-core/src/index.ts",
         "packages/rogue/x.ts", "spec/PROJECT-STATE.md"],
        fixture_surfaces,
    )
    record(
        "G4-ownership-unowned-path",
        len(v) == 2 and any("packages/rogue/x.ts" in m for m in v)
        and any("spec/PROJECT-STATE.md" in m for m in v),
        str(v),
    )

    # G5: two active work orders with overlapping surfaces
    v = check_concurrent_overlap(
        ["X1", "X2"],
        {"X1": ["packages/shared/*"], "X2": ["packages/shared/deep/*"]},
    )
    record("G5-overlap-nested", any("X1" in m for m in v), str(v))
    v = check_concurrent_overlap(
        ["X1", "X2"],
        {"X1": ["packages/alpha/*"], "X2": ["packages/beta/*"]},
    )
    record("G5-overlap-disjoint-clean", v == [], str(v))

    # G6: floating dependency specs must fail
    bad_manifest = {
        "dependencies": {"left-pad": "^1.0.0"},
        "devDependencies": {
            "typescript": "~5.0.0",
            "eslint": "*",
            "vitest": ">=1 <2",
            "zod": "latest",
            "broken": "",
            "workspace-float": "workspace:^",
        },
    }
    v = validate_dependency_specs(bad_manifest, "fixtures/bad-package.json")
    record(
        "G6-floating-deps",
        len(v) == 7,
        f"expected 7 violations, got {len(v)}: {v}",
    )
    good_manifest = {
        "dependencies": {},
        "devDependencies": {
            "typescript": "5.9.3",
            "eslint": "catalog:",
            "@arena/protocol-core": "workspace:*",
            "@arena/other": "workspace:0.0.0",
        },
    }
    v = validate_dependency_specs(good_manifest, "fixtures/good-package.json")
    record("G6-good-deps", v == [], str(v))
    v = validate_npmrc("registry=https://registry.npmjs.org/\n")
    record(
        "G6-npmrc-missing-save-exact",
        any("save-exact=true" in m for m in v) and any("engine-strict=true" in m for m in v),
        str(v),
    )
    v = validate_npmrc("save-exact=true\nengine-strict=true\n")
    record("G6-npmrc-good", v == [], str(v))
    v = validate_root_engines({"engines": {"node": ">=22"}, "packageManager": "pnpm@10"})
    record(
        "G6-root-engines-unbounded",
        any("engines.node" in m for m in v) and any("packageManager" in m for m in v),
        str(v),
    )
    v = validate_root_engines(
        {"engines": {"node": ">=22 <23"}, "packageManager": "pnpm@10.34.5"}
    )
    record("G6-root-engines-good", v == [], str(v))
    bad_workspace = (
        'packages:\n  - "packages/*"\n\ncatalog:\n  typescript: "5.x"\n  eslint: "^10.11.0"\n'
    )
    v = validate_catalog_versions(bad_workspace)
    record(
        "G6-catalog-floating",
        len(v) == 2,
        f"expected 2 violations, got {len(v)}: {v}",
    )

    # G7: protocol-core purity
    v = check_protocol_core_purity(
        {"dependencies": {"zod": "4.6.5"}}, {"index.ts": "export const x = 1;"}
    )
    record("G7-purity-runtime-deps", any("'dependencies' is non-empty" in m for m in v), str(v))
    v = check_protocol_core_purity(
        {"devDependencies": {"vitest": "catalog:"}},
        {"model.ts": "// calls openai to decide\nexport const x = 1;"},
    )
    record(
        "G7-purity-provider-name",
        any("'openai'" in m for m in v),
        str(v),
    )
    v = check_protocol_core_purity(
        {"devDependencies": {"vitest": "catalog:"}},
        {"index.ts": "export const neutral = 'adapter-abstraction-only';"},
    )
    record("G7-purity-good", v == [], str(v))

    # G8: CI workflow
    bad_ci = (
        "name: CI\non:\n  pull_request:\n  push:\njobs:\n  verify:\n"
        "    runs-on: ubuntu-latest\n    steps:\n"
        "      - uses: actions/checkout@v4\n"
        "      - uses: actions/setup-node@main\n"
        "      - run: pnpm install\n"
    )
    v = check_ci_workflow_text(bad_ci)
    record(
        "G8-ci-unpinned-actions",
        any("actions/checkout@v4" in m for m in v)
        and any("actions/setup-node@main" in m for m in v)
        and any("pnpm install --frozen-lockfile" in m for m in v),
        str(v),
    )
    good_ci = (
        "name: CI\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n"
        "  verify:\n    runs-on: ubuntu-latest\n    steps:\n"
        "      - uses: actions/checkout@v5.0.0\n"
        "      - uses: actions/setup-node@v5.0.0\n"
        "      - run: pnpm install --frozen-lockfile\n"
        "      - run: pnpm governance\n"
        "      - run: pnpm boundary\n"
        "      - run: pnpm typecheck\n"
        "      - run: pnpm lint\n"
        "      - run: pnpm test\n"
        "      - run: pnpm build\n"
    )
    v = check_ci_workflow_text(good_ci)
    record("G8-ci-good", v == [], str(v))

    # G9: contract drift through the real generator
    generator = repo_root / "scripts" / "generate-contracts.mjs"
    for case, against in (
        ("G9-drift-tampered", fixtures / "drift" / "tampered"),
        ("G9-drift-missing", fixtures / "drift" / "missing"),
    ):
        result = subprocess.run(
            ["node", str(generator), "--check", "--against", str(against)],
            capture_output=True,
            text=True,
            cwd=str(repo_root),
            check=False,
        )
        record(case, result.returncode != 0, f"exit={result.returncode}")

    passed = sum(1 for _, ok, _ in results if ok)
    failed = len(results) - passed
    print(f"[governance] self-test: {passed}/{len(results)} fixtures behaved as expected")
    for name, ok, detail in results:
        status = "PASS" if ok else "FAIL"
        suffix = f"  [{detail}]" if (detail and not ok) else ""
        print(f"  {status}  {name}{suffix}")
    return passed, failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Arena governance checker")
    parser.add_argument("--check-only", action="store_true", help="skip self-tests")
    parser.add_argument("--self-test-only", action="store_true", help="run self-tests only")
    parser.add_argument("--base", help="override the git diff base SHA")
    parser.add_argument("--root", default=str(REPO_ROOT), help="repository root")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    exit_code = 0

    if not args.check_only:
        _, failed = self_test(root)
        if failed:
            print(
                f"[governance] SELF-TEST FAILURE: {failed} fixture(s) did not behave "
                "as expected — checks are not trustworthy",
                file=sys.stderr,
            )
            exit_code = 1

    if not args.self_test_only and exit_code == 0:
        violations, summary = run_repo_checks(root, args.base)
        if violations:
            print(f"[governance] check: {len(violations)} violation(s)")
            for message in violations:
                print(f"  {message}")
            exit_code = 1
        else:
            print(
                "[governance] check: clean "
                f"(diff base {summary.get('diff_base', '?')}, "
                f"{summary.get('changed_paths', 0)} changed paths, "
                f"{summary.get('active_work_orders', 0)} active work order(s))"
            )

    if exit_code == 0:
        print("[governance] OK")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
