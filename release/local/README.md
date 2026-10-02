# Arena Local Profile (B016)

The **local profile** is the developer-facing Arena distribution: what a
fresh machine gets by following
[docs/getting-started/README.md](../../docs/getting-started/README.md).
This directory records what the profile ships, what is intentionally
absent, and the checklist that gates a profile release.

| Artifact | Purpose |
| --- | --- |
| [RELEASE-NOTES.md](RELEASE-NOTES.md) | Versioned notes for the local profile (what changed, what is verified). |
| [CHECKLIST.md](CHECKLIST.md) | The repeatable, command-based release checklist for the local profile. |

## Profile summary

The local profile ships:

- the full Arena workspace (apps, packages, services, adapters, bodies,
  environments) installable with Node 22 + corepack-pinned pnpm;
- the **product workflow commands** (`scripts/product/`): install, seed,
  doctor, reset — zero external dependencies, runnable standalone;
- the **deterministic Demo mode** (B006): the guided `/demo` experience
  over the frozen corpus under the reserved demo tenant, always visibly
  labelled, resettable;
- the **local fake persistence posture** (B002): in-memory fakes plus
  the file-backed local store driven through the same
  `ControlPlaneRepository` port;
- developer documentation: the quickstart, the local-mode contract and
  the troubleshooting map (`docs/getting-started/`).

The local profile intentionally does **not** ship:

- hosted provider wiring activation (Neon/R2/Upstash/Vercel/Apify
  adapters exist but are not wired locally — hosted preview is the
  B015/B019 posture and an explicit opt-in);
- any provider credential handling or secret injection;
- any billable surface whatsoever;
- customer data or customer-authoritative state of any kind — demo
  state is labelled, deterministic and disposable.

See [RELEASE-NOTES.md](RELEASE-NOTES.md) for the current profile
version and its verification evidence.
