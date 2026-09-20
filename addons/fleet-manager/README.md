# Fleet Manager (Mosaic addon)

Manage multiple HyperCycle nodes inside [Mosaic Companion](https://github.com/hypercycle-development/mosaic-companion): registry list, ALIVE/DEAD health probes, dashboard counts, and simple alerts.

## Permissions

- `nodes:read` — read the local node registry via `addonAPI.nodes.list()`

Health checks call each node's HTTP `/health` endpoint from the renderer. Nodes are created/edited in Mosaic Configuration; this addon does not write the registry and does not store private keys.

## Develop locally

```bash
cd addons/fleet-manager
npm install
npm run build    # writes renderer/
```

In a **dev** Mosaic build (or packaged with `MOSAIC_ADDON_DEV=1`):

Configuration → Addons → Dev corner → **Install unpacked** → select this folder (`addons/fleet-manager`, the one with `manifest.json`).

## Layout

```
addons/fleet-manager/
  manifest.json
  LICENSE
  NOTICE
  package.json
  vite.config.ts
  index.html          # Vite entry (dev)
  src/                # source reviewed in PRs
  renderer/           # build output (gitignored in mosaic-addons)
```

## Licence

MIT — see `LICENSE`.
