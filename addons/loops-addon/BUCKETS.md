# Sharing loop drafts with Stargate Graph

Loops is the sole writer of the `loop-drafts` bucket. Graph may read it, but
only after **the user** grants that connection in Mosaic — an add-on cannot ask
to be connected, and neither side can escalate permission on its own.

## Manifest

```json
"permissions": ["agents:read", "mcp:read", "buckets:publish"],
"buckets": {
  "publishes": [{ "id": "loop-drafts", "kind": "loop-draft", "label": "Loop drafts", "history": "all" }],
  "reads": []
}
```

`buckets:publish` is required whenever `publishes` is non-empty, and is refused
when declared with nothing published.

## Two buttons, deliberately not merged

- **Save state** → `StateManager`, which persists to this add-on's own
  localStorage (its webview storage). It does **not** touch the Vault.
- **Share with Graph** → `buckets.write()`. The only action that crosses an
  add-on boundary.

Both report the real outcome. A missing bridge, a rejected manifest, a cap
breach and a storage error are distinct, and each is shown as itself.

## Payload

`src/services/bucketPayload.ts` is the contract, versioned (`v: 1`) and
validated **before** writing, so a payload that writes is a payload Graph reads.
Only loop topology crosses: id, name, description, status, tag, nodes, edges,
timestamps. No config, schemas, timings, credentials or file paths.

Graph carries its own identical copy (`graph-addon/src/services/loopDraftSchema.ts`)
because the two add-ons are separate packages with separate builds. Keep them in
sync.

## A bucket is untrusted

The host guarantees who wrote an item and that the user connected you. It
guarantees nothing about the contents. Graph validates shape, types and lengths,
and never evaluates or interpolates a payload.
