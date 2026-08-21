# Company Store live-origin smoke

Captured: 2026-08-21T23:22:50.413Z
Origin: `https://mas-speeds-constitutional-cleared.trycloudflare.com`
Script: `npm run smoke:company-store-live`
durable: **false** · pinAllowed: **false** · m1Complete: **false**

## Checks

- [x] health — HTTP 200 challenge=false
- [x] plugins-packages-meta-installMethods — packages=3 meta.total=3 installMethods=3
- [x] plugins-q-hit — n=1 meta.total=1
- [x] plugins-q-miss — n=0
- [x] search-pagination — p1=2 p2=1 total=3
- [x] pin-script-refuse — correctly refused ephemeral/local origin

## Wire snapshot

- packages: 3
- meta.total: 3
- meta.source: stale
- q=crosstalk packages: 1
- search page1 limit2: 2 / total 3
- search page2 limit2: 1
- body sha256[0:16]: `7f6a85dc143d7b65`
- Artifact: [`live-smoke-2026-08-21T23-22-50-413Z.json`](./live-smoke-2026-08-21T23-22-50-413Z.json)

Do **not** treat trycloudflare as Stage 2 production pin evidence.

