# G001 evidence — start, landing, Demo, reset, error state (fresh machine)

```
$ (nohup npx next start -p 3100 > /tmp/next.log 2>&1 &)
✓ Ready in 571ms   (server log: Local: http://localhost:3100)

=== GET / (after wait: 200) ===
HTTP 200 | text/html; charset=utf-8 | 20879B | 0.016465s
<title>Arena — professional AI capability, kept inspectable</title>

=== GET /demo ===
HTTP 200 | text/html; charset=utf-8 | 97570B

=== POST /demo/reset ===
HTTP 303 (redirect)          # the documented deterministic demo-reset contract

=== GET /nonexistent-xyz ===
HTTP 404                     # error state present
```

Note: the local landing payload (20879B) is byte-size-identical to the hosted preview's
landing (20879B, see G002 evidence) — consistent with the deterministic-build posture.
