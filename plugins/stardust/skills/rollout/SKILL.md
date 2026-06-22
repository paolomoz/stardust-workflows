---
name: rollout
description: Deliver a WHOLE redesigned site to AEM Edge Delivery Services. The full-site sibling of `deploy` (which converts one page). Inventories the platform-agnostic migrated tree (stardust/migrated/ + _meta.json sidecars) into a delivery coverage ledger, then delivers each page by invoking the `deploy` methodology, tracking what is done and what is missing across the whole site. Use when the user has a migrated stardust site and wants to push the entire site to AEM, not just one page.
license: Apache-2.0
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

`deploy` converts **one** page to AEM. `rollout` delivers the **whole site**: it
inventories the agnostic output of `migrate`, then drives `deploy` across every
page, tracking delivery coverage so you always know what's done and what's left.

`rollout` is **delivery-only** — it does not redesign. The page-by-page redesign
(`extract → direct → prototype → migrate`) and `deploy` itself are **unchanged**;
`rollout` is the across-pages layer on top. The full design rationale, the
coverage model, and the phasing are in
[`notes/rollout/PLAN.md`](../../notes/rollout/PLAN.md).

> **This is Phase 1** (inventory + delivery loop + page coverage). Block **dedup**
> and **optimize** are committed first-class steps deferred to later phases — see
> § Not yet built and PLAN § 8. Do not bolt them on here; Phase 1 is built so they
> slot in without rework.

## When to use

The user has:
1. A migrated stardust site at `stardust/migrated/` (the output of
   `stardust migrate`: per-page HTML + `_meta.json` sidecars). This is the
   explicit handoff `migrate` documents for downstream AEM conversion.
2. An EDS/AEM project + DA destination (the same target `deploy` needs — see
   `skills/deploy/SKILL.md` and `da-deploy-protocol.md`).
3. A goal to deliver the **entire** site, incrementally and resumably.

If there is no `stardust/migrated/` tree, stop and recommend `stardust migrate`
first. For a single page, use `stardust deploy` directly — `rollout` is for the
whole site.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/migrated/` exists and contains at least one `*.html` page.
   If not, recommend `stardust migrate` and stop.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport
   — it reuses `deploy`'s.

## Procedure

### Phase A — Inventory (build the coverage)

Run the inventory script to project the migrated tree into the delivery coverage:

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout
```

It writes:
- `stardust/rollout/coverage/pages.json` — one row per migrated page: slug,
  delivered `path`, `templateId` (from the sidecar `template`/`type`), the
  `blocks` it composes (from the sidecar `modules`), a `sourceHash`, and the
  per-page `delivery` status.
- `stardust/rollout/coverage/templates.json` — pages grouped by template (drives
  delivery order and per-template roll-ups).
- `stardust/rollout/rollout.json` — target + DA config + a `lastRun` counts
  summary.

The inventory is **idempotent and incremental**: existing delivery status is
preserved; a page whose migrated HTML changed after it was delivered is
re-flagged `stale`. Re-run it any time `migrate` re-emits pages.

Fill in the DA coordinates in `stardust/rollout/rollout.json` (`site.da.org`,
`site.site`, `site.da.ref`) if the inventory didn't infer them — `deploy` needs
them for the push.

### Phase B — Deliver the site (drive `deploy` per page)

Deliver every page whose `delivery.status` is `pending`, `stale`, or `failed`.
Order: **representative page of each template first** (read
`templates.json[].representativeSlug`), then its siblings — so block treatments
are settled once per template before the bulk of its pages go out.

For each page to deliver:

1. **Convert + push** the page's migrated HTML (`source.migratedHtml`) to AEM by
   following the `deploy` methodology in `skills/deploy/SKILL.md` (section→block,
   static fragments, `metadata` block, body-fragment write via the DA Source API
   per `da-deploy-protocol.md`). `rollout` does not reimplement any of this — it
   invokes `deploy` page by page.
2. **Record the outcome** in the ledger with the state-writer (keeps the run
   honest and resumable — never hand-edit `pages.json`):

   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   # … run the deploy steps …
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   ```

   On failure: `--status failed --error "<reason>"` and continue to the next page
   (one page's failure never aborts the site rollout — mirrors `migrate`).

3. **Verify** the delivered page renders (200, blocks decorate, no
   `about:error`), then:

   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status verified
   ```

Parallelism: you may deliver multiple template clusters concurrently (one agent
per cluster, non-overlapping page sets), exactly as `deploy` Step 7 dispatches
per-archetype agents. The state-writer is per-slug so concurrent updates don't
collide. (How light the cross-page coordination can be is PLAN § 10 open
question 4 — keep it simple in Phase 1: partition by template, no shared locks.)

### Phase C — Report

Re-run the inventory (or read `rollout.json.lastRun`) and print the counts:

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <s> stale
Templates   <T> (per-template delivered/total)
To deliver  <list of remaining slugs>
```

Surface anything still `pending`/`stale`/`failed` as the explicit "what's
missing" list. Re-running Phase B picks up exactly those pages.

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`/`type`), `blocks` (`modules`), `title` |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

| Path | Purpose |
|---|---|
| `stardust/rollout/coverage/pages.json` | per-page delivery ledger (schema: `schemas/rollout-pages.schema.json`) |
| `stardust/rollout/coverage/templates.json` | template grouping + roll-ups (schema: `schemas/rollout-templates.schema.json`) |
| `stardust/rollout/rollout.json` | config + `lastRun` summary (schema: `schemas/rollout-config.schema.json`) |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes **only** under `stardust/rollout/`. It never modifies the
agnostic core, `state.json`, or `migrated/` — those are read-only inputs.

## What rollout does NOT do (Phase 1)

- **Block dedup is not yet first-class.** In Phase 1 each page is converted via
  `deploy` independently, so a block shared by many pages may be converted more
  than once. Phase 2 makes dedup a driving step (convert each distinct block
  once; canonical EDS names up front). The `blocks` field is already inventoried
  per page so Phase 2 has its input. Do not add ad-hoc reconciliation here.
- **No optimize/audit.** The detect → fix → verify quality gate returns as a
  first-class in-flow step in a later phase (PLAN § 8). Not bolted on now.
- **No dashboard.** Visual progress dashboard is a later phase; Phase 1 reports
  counts to the terminal + the `lastRun` summary.
- **No redesign.** `rollout` never edits content or design; it delivers what
  `migrate` produced.
- **No new transport.** Delivery is `deploy`'s DA Source API path, unchanged.

## Scripts

- `scripts/inventory.mjs` — migrated tree → coverage (idempotent; stale-aware).
- `scripts/update-coverage.mjs` — deterministic per-page delivery state-writer;
  re-derives template + config roll-ups.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `skills/deploy/SKILL.md` — the single-page conversion methodology rollout drives.
- `skills/deploy/da-deploy-protocol.md` — the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
