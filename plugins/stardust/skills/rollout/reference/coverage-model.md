# rollout coverage model (operational reference)

The contract the two scripts maintain. Design rationale is in
`notes/rollout/PLAN.md`; this doc is the runtime behaviour.

## Files (all under `stardust/rollout/`)

| File | Writer | Contract |
|---|---|---|
| `rollout.json` | inventory + update-coverage | target + DA config + `lastRun` counts |
| `coverage/pages.json` | inventory (rows) + update-coverage (delivery) | one row per migrated page |
| `coverage/templates.json` | inventory + update-coverage | pages grouped by `templateId` + roll-ups |

`rollout` writes nothing outside this directory. `stardust/migrated/`,
`state.json`, and the rest of the agnostic core are read-only inputs.

## Page delivery status lifecycle

```
            ┌──────────────── (migrated HTML changed after delivery) ──────────────┐
            ▼                                                                       │
  pending ──► converting ──► deployed ──► verified ──────────────────────────► stale
     ▲            │                                                                 │
     └─ inventory │                                                                 │
        seeds new └──► failed ──(retry)──► converting …                             │
                                                                                    │
                  stale/failed pages are re-picked by the next Phase B pass ◄───────┘
```

- **pending** — inventoried, not yet delivered. New pages start here.
- **converting** — `deploy` is mid-flight on this page.
- **deployed** — pushed to the branch preview; not yet verified.
- **verified** — renders live (200, blocks decorate, no `about:error`).
- **failed** — a delivery error; `error` carries the reason. Non-fatal to the run.
- **stale** — was deployed/verified, but `migrate` re-emitted the page (its
  `sourceHash` changed). Needs re-delivery.

## Idempotency rules (inventory)

On every `inventory.mjs` run:
- A page's `sourceHash` is recomputed from its migrated HTML bytes.
- If a page already exists in `pages.json`:
  - hash **unchanged** → its `delivery` is preserved verbatim.
  - hash **changed** and prior status ∈ {`deployed`,`verified`} → status becomes
    `stale` (delivered URL retained); otherwise the prior status is kept.
- A page **not** in prior coverage → seeded `pending`.
- Pages are keyed by `slug` (from the `_meta.json` sidecar, else derived from the
  delivered path). The `assets/` bundle is never inventoried.

## Roll-ups

`update-coverage.mjs` and `inventory.mjs` both re-derive, from `pages.json`:
- each template's `{ verified, deployed, pending }` in `templates.json`;
- the site-wide `lastRun.pages` counts in `rollout.json`.

So the counts never drift from the per-page truth — they are always recomputed,
never incremented.
