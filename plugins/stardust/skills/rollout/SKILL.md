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

> **Phases 1–2 are built**: inventory + page coverage (P1), and **first-class
> block dedup + site assembly + full-site verify** (P2). **optimize** (the
> detect → fix → verify quality gate) and the **dashboard** remain committed
> first-class steps deferred to later phases — see § Not yet built and PLAN § 8.
> Do not bolt those on here.

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
`site.site`, `site.da.ref`, and `site.liveHost`) if the inventory didn't infer
them — `deploy` needs them for the push and `verify` needs the host.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

Derive the distinct block set and the dedup-driven delivery plan **up front** —
this is what makes "convert each block once" a driving step, not a cleanup:

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance across the site (the per-page
  `modules` + chrome) into the **distinct** set, assigns each a canonical
  `edsBlockName` (kebab; reserved-class-guarded per deploy #15), and records
  `usedByPages` / `instanceCount`. Chrome (`header`/`nav`/`footer`) is marked
  `kind: chrome` → delivered as site-wide fragments, not per-page blocks.
- `plan.mjs` orders pages **representative-first per template**, walks them once,
  and assigns each distinct block a **single conversion point**: the first page
  in order that uses it CONVERTS it; every later page REUSES it by name. The
  per-page `convert` / `reuse` lists are exactly `deploy`'s Step-7 brief input
  (*"Existing blocks — REUSE, do not recreate: …"*), so each block converts once
  **without changing deploy**.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the page's migrated HTML (`source.migratedHtml`) to AEM via
   the `deploy` methodology (`skills/deploy/SKILL.md`). **Pass the page's plan
   step into deploy's brief**: create only the blocks in `convert`; for every
   block in `reuse`, instruct deploy to REUSE the existing block by its
   `edsBlockName` (do not recreate). This is the dedup contract in action.
2. **Record outcomes** with the state-writer (never hand-edit the ledger):

   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   # for each block this page converts:
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name <name>
   # … run the deploy steps …
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   ```

   On failure: `--status failed --error "<reason>"` and continue (one page's
   failure never aborts the rollout — mirrors `migrate`).

Parallelism: deliver multiple template clusters concurrently (one agent per
cluster, non-overlapping page sets), as `deploy` Step 7 dispatches per-archetype
agents. **Deliver each template's representative — the page that converts that
template's blocks — before its siblings**, so the blocks exist to be reused. The
state-writer is per-unit so concurrent updates don't collide.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates the artifacts that only make sense site-wide: `sitemap.xml` +
`robots.txt` from the delivered paths, and a **fragments manifest** mapping the
chrome blocks to `fragments/header.html` / `fragments/footer.html` with their
`canon/*.html` source. `deploy` lifts and pushes the actual fragment content
(Step 6); `assemble` prepares and records what to push.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url>   (explicit host)   |   --root <dir>   (offline, against a local export)
```

For every delivered page, `verify` confirms it's reachable (HTTP 200), has no
`about:error` (broken-image ingestion, deploy #75), and that every internal
`href="/…"` resolves to a known delivered path — then flips each page to
`verified` or `failed` with the reason. It exits non-zero if any page failed.

### Phase F — Report

Read `rollout.json.lastRun` (or re-run `inventory.mjs`) and print the counts:

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
To deliver  <list of remaining slugs>
```

Surface anything still `pending`/`stale`/`failed` as the explicit "what's
missing" list. Re-run from Phase B/C to pick up exactly those pages; when
`migrate` re-emits a page, `inventory` re-flags it `stale` and it re-delivers.

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
| `stardust/rollout/coverage/blocks.json` | the block dedup ledger + EDS mapping (schema: `schemas/rollout-blocks.schema.json`) |
| `stardust/rollout/plan.json` | dedup-driven delivery order + per-page convert/reuse briefs |
| `stardust/rollout/rollout.json` | config + `lastRun` summary (schema: `schemas/rollout-config.schema.json`) |
| `stardust/rollout/site/{sitemap.xml,robots.txt,manifest.json}` | site-level assembly artifacts |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes **only** under `stardust/rollout/`. It never modifies the
agnostic core, `state.json`, or `migrated/` — those are read-only inputs.

## What rollout does NOT do (yet)

- **No optimize/audit.** The detect → fix → verify quality gate returns as a
  first-class in-flow step in a later phase (PLAN § 8). Not bolted on now.
- **No dashboard.** The visual progress dashboard is a later phase; for now
  rollout reports counts to the terminal + the `lastRun` summary.
- **No redesign.** `rollout` never edits content or design; it delivers what
  `migrate` produced.
- **No new transport.** Delivery is `deploy`'s DA Source API path, unchanged.

## Scripts

- `scripts/inventory.mjs` — migrated tree → page + template coverage (idempotent;
  stale-aware).
- `scripts/blocks.mjs` — distinct-block dedup ledger (`blocks.json`).
- `scripts/plan.mjs` — dedup-driven delivery order + per-page convert/reuse briefs.
- `scripts/update-coverage.mjs` — deterministic delivery state-writer for pages
  (`<slug> --status …`) and blocks (`--block <id> --status …`); re-derives all
  roll-ups.
- `scripts/assemble.mjs` — site-level sitemap / robots / fragments manifest.
- `scripts/verify.mjs` — full-site verification (HTTP or offline `--root`).
- `scripts/lib.mjs` — shared IO + roll-up helpers (counts always recomputed).

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `skills/deploy/SKILL.md` — the single-page conversion methodology rollout drives.
- `skills/deploy/da-deploy-protocol.md` — the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
