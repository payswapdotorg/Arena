# G001 evidence — documented persistence behavior (per docs/getting-started/local-mode.md)

The doc's contract: the CLI store (`.arena-local/`) persists across commands; the web demo
runtime recomposes per process; `reset` wipes totally. Verified on the fresh machine:

## Seed → file-backed store created

```
$ node scripts/product/seed.mjs
[arena-seed] corpus: version 1 · hash summary 4dfd1acd (deterministic — identical on every machine)
[arena-seed] seeded records (5):
[arena-seed] local store: /home/user/arena/.arena-local/store/control-plane.json · 5 record(s) · format v1 (local fake — zero providers, zero credentials)
```

## Persistence across commands (a NEW process sees the same store)

```
$ node scripts/product/doctor.mjs
PASS  store: local fake persistence store healthy: 5 record(s) · tenants {"arena-demo":5} — demo corpus present and byte-identical (deterministic)
```

## Total reset + reseed

```
$ node scripts/product/reset.mjs --yes --reseed
[arena-seed] local store: … 5 record(s) · format v1 (local fake — zero providers, zero credentials)
[arena-reset] done — local state wiped and re-seeded to the identical corpus hash.
```

Matches the documented behavior exactly: persistent CLI store, byte-identical deterministic
corpus (hash 4dfd1acd), total explicit reset. The web `/demo` runtime recomposes in-process
(verified by the E2E/UX runners' demo-reset cleanup contract).
