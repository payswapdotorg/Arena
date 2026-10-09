# P002 acceptance proofs — embedded-postgres
- clock: ManualClock pinned at 2026-10-07T10:00:00.000Z (A015 injected time)
- (a) start #1 applied migrations: [1,2,3,4,5]
- (b) escalation persisted + read back: requestId=esc_…(36 chars) state=matching lens=customer
- (c) restart: migrationsApplied=[] recovery={"nonTerminalJobs":1,"reclaimedLeases":1,"terminalJobsUntouched":0}
- audit chain: 3 records, digest-linked across the restart boundary (head 452b05bfc2b3…(64 hex))
- (d) replay returned requestId=esc_…(36 chars) outcome="replay"; recorded outcome stable (274 bytes)
- (e) cross-tenant fail-closed: create=RUNTIME_CROSS_TENANT_ACCESS read=RUNTIME_ESCALATION_NOT_FOUND act=ESCALATION_CROSS_TENANT_ACCESS list=0
- health: state="started" ready=true capacity="AVAILABLE"
