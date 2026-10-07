# G002 evidence — HTTP reachability and Vercel deployment (CURRENT)

## Landing probes (3× spaced, 2026-10-07 UTC)

```
$ curl -s -o landing.html -w "HTTP %{http_code} | %{content_type} | %{size_download}B | total %{time_total}s" https://arena-preview-five.vercel.app/
13:15:56  HTTP 200 | text/html; charset=utf-8 | 20879B | total 1.541280s
13:16:03  HTTP 200 | text/html; charset=utf-8 | 20879B | total 0.331347s
13:16:08  HTTP 200 | text/html; charset=utf-8 | 20879B | total 0.530535s
```

- Title: `<title>Arena — professional AI capability, kept inspectable</title>`
- Body markers: "Arena"/"arena"/"role" references present (11/190/13+ occurrences).

## Demo surface + reset contract

```
$ curl -o /dev/null -w "%{http_code}" https://arena-preview-five.vercel.app/demo
200 | text/html; charset=utf-8
$ curl -X POST -o /dev/null -w "%{http_code}" https://arena-preview-five.vercel.app/demo/reset
303   (redirect per the documented deterministic demo-reset contract)
```

## Error state

```
$ curl -o /dev/null -w "%{http_code}" https://arena-preview-five.vercel.app/nonexistent-xyz
404
```

## Vercel deployment truth (API, 2026-10-07 ~13:17 UTC)

Project: `arena-preview` — id `prj_PxNulA41ti7n3uulomMVhiskUPCa` — framework nextjs — updatedAt 2026-10-07T10:37:07Z.

Latest production deployments (GET /v6/deployments?target=production&limit=3):

| uid | state | created (UTC) |
|---|---|---|
| dpl_GzgnnC6kMPdhtgafbeQGawqLpCVL | READY | 2026-10-07T10:36:57Z |
| dpl_DoxoSnRMm85KiMAzDaksXcM9JLhy | READY | 2026-10-07T05:02:04Z |
| dpl_GyXmdsa5YMYFa2iVgFpTU4kj4ut8 | READY | 2026-10-04T21:33:13Z |

Notes (honest):
- `meta.gitRef` is empty on all three: the deployment chain is API/script-triggered
  (the documented B015/B019 deploy pipeline), not git-integration — so deployment↔commit
  identity is carried by the deploy pipeline's own records, not Vercel metadata.
- The October 4 deployment is HISTORY; the October 7 deployments (05:02 and 10:36 UTC)
  are the CURRENT production state serving the URL probed above — the stale-record
  concern in the closure spec is resolved.
- No Vercel authorization/access failure was encountered with the working token during
  this reconciliation.
