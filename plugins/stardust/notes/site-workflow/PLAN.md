# stardust:site — full-site redesign, optimization & migration workflow

> Design plan. Status: **proposal for review**. No skill code is written yet —
> this document plus the JSON schemas under `schemas/` are the deliverable.
> Build order is in § 11 (Phasing).

## 0. Problem statement

Today stardust redesigns a site **page by page** and stops at platform-agnostic
static HTML. We want stardust to drive a **whole-site redesign + migration to
AEM** as a long-running, resumable, iterative campaign that:

1. **Tracks what is done and what is missing** across three dimensions —
   **pages**, **templates** (groups of pages sharing a design structure), and
   **content blocks** within pages.
2. **Migrates content verbatim** (copy + images) while redesigning, with a
   **controlled degree of modification** to optimise it for the redesign.
3. **Optimises the site during redesign/migration**, fixing the issues the
   stardust audit detects (the 7-layer model at
   `github.com/paolomoz/semrush-stardust/audit`).
4. **Iterates over portions** of the site — start with a slice, go wider and
   deeper over successive passes.
5. Lets the user **track progress with high-level visual dashboards**.
6. Supports **parallel agents** where possible, **without drift or shortcuts**.
7. Tracks **coverage, progress, and depth in files** so the workflow stays on
   track across sessions and agents.
8. **Starts with `stardust uplift`**, requires user input at the start and at
   defined gates thereafter.
9. Keeps the user **informed of the counts** of pages, templates, and blocks
   that still need to be redesigned and migrated.

## 1. Design principles (locked with the user)

- **AEM target: Edge Delivery Services (EDS / da.live).** First-class, but not
  the entry point.
- **stardust core stays platform-agnostic.** `extract`, `direct`, `prototype`,
  `migrate`, `uplift` (and the new `site`, `optimize`, `dashboard`) only ever
  produce or reason about **HTML and the site model**. Nothing in core knows
  what AEM is.
- **All platform specifics live in `deploy`.** `deploy` is expanded in place
  into the full site-delivery workflow for AEM-EDS now; a target-contract seam
  (§ 9) is left so other platforms can be contributed later without touching
  core.
- **Content posture: verbatim-first, opt-in optimize.** Copy and images are
  preserved verbatim by default; optimisation is applied only where an audit
  finding justifies it, within a logged **modification budget**.
- **Open and reasoned.** Every coverage/depth/finding change is recorded in
  files with provenance; nothing is invented silently. This extends stardust's
  existing provenance + journal discipline.

## 2. Skill map

### Tier 1 — stardust core (platform-agnostic)

| Skill | Status | Role in this workflow |
|---|---|---|
| `extract` | existing | Crawl + live-render capture → `current/`. Gains a **discovery** sub-mode that seeds the page ledger at depth D0 without rendering everything. |
| `direct` | existing | Resolve intent → target `DESIGN.*`. Unchanged mission; consumes `optimize` findings as fix-obligations. |
| `prototype` | existing | Redesigned HTML per page/archetype. Consumes design-pass findings; flips them to `fixed` on resolution. |
| `migrate` | existing | Approved design → deployable **HTML** + `_meta.json`. Gains the **content-fidelity dial** (§ 7). Still the final *agnostic* phase. |
| `uplift` | existing | One-URL, 3-variant presales entry. Becomes the **first step** `site` runs. |
| `prepare-migration` | existing | Prep cascade orchestrator (agnostic). Reused by `site` per batch. |
| `diff` | existing | Visual/content diff. Reused for optimize before/after evidence. |
| **`site`** | **new** | The **campaign orchestrator / brain**. Owns the coverage model, iteration + depth, batch selection, parallel-agent dispatch, gates, counts. Entry: `stardust:site <url>`. |
| **`optimize`** | **new** | The **7-layer site-optimization detector**. Writes the findings ledger + scorecard; tags fixability `design-pass` / `platform-migration` / `out-of-scope`. |
| **`dashboard`** | **new** | Generates the **self-contained visual dashboards** over coverage + audit + delivery. |

### Tier 2 — platform layer

| Skill | Status | Role |
|---|---|---|
| **`deploy`** | **expanded** | The full **site-delivery workflow** for AEM-EDS: section→EDS block, fragments, DA Source API, the CWV/CLS/font/semantic fixes that realise `platform-migration` findings. Owns the per-target **delivery** overlay on the coverage model. A `reference/target-contract.md` documents the seam other platforms will implement. |

> Master `stardust` keeps routing + the state report. The long-running
> iteration logic lives in `site`, which master delegates to.

## 3. The site model (files)

Everything lives under `stardust/`. New paths are **bold**.

```
stardust/
├── state.json                       # existing per-page state machine (extended, § 3.4)
├── direction.md                     # existing
├── journal.md                       # existing (append-only narrative)
├── current/ …                       # existing (extract output)
├── prototypes/ …                    # existing
├── migrated/ …                      # existing (agnostic HTML)
├── canon/ …                         # existing
├── coverage/                        # NEW — the three tracking dimensions + leases
│   ├── pages.json                   #   page coverage ledger          (schema: coverage-pages)
│   ├── templates.json               #   template coverage ledger      (schema: coverage-templates)
│   ├── blocks.json                  #   block/module coverage ledger  (schema: coverage-blocks)
│   ├── claims.json                  #   parallel-agent lease file      (schema: coverage-claims)
│   └── fragments/                   #   per-unit ledger fragments parallel agents write, site merges
│       └── <claim-id>.json
├── optimize/                        # NEW — the audit subsystem
│   ├── findings.json                #   findings ledger               (schema: optimize-findings)
│   └── scorecard.json               #   7-dimension health + history  (schema: optimize-scorecard)
└── dashboard/                       # NEW — generated dashboards
    ├── index.html                   #   self-contained, brand-styled
    └── data.json                    #   the snapshot the HTML renders (so it's inspectable)
```

### 3.1 Coverage = pages × templates × blocks, each with status + depth

The three ledgers are **derived, maintained projections** over `state.json`,
`current/`, `DESIGN.json.extensions`, and the optimize/delivery state. They are
not a second source of truth for things state.json already owns — they
**roll up** and **cross-reference** so the orchestrator and dashboard can answer
"what's done / what's missing" in O(1) without re-deriving every run.

- `pages.json` — one row per discovered page: its template, depth, generation
  status, optimize rollup, content mode, delivery status, batch.
- `templates.json` — one row per template (a typed archetype): which pages it
  governs, archetype-approval status, % of its pages prototyped / migrated /
  delivered, and the blocks it composes.
- `blocks.json` — one row per reusable block/module: its slots, which templates
  use it, instance count, redesign + content status, optimize findings touching
  it, and per-target delivery status.

`site` owns writing these; every other skill **reads** them and writes back only
its own narrow fields (e.g. `prototype` sets a page's depth to D3; `deploy` sets
a block's delivery status). Concurrency is handled by the fragment-merge pattern
(§ 8.3), not locks.

### 3.2 The depth ladder (D0–D6)

A single ordered axis unifies the lifecycle so "go deeper on a portion" is a
first-class, trackable move. A page's `depth` is the deepest rung it has
reached; a template's/block's depth is the min (or representative) across its
pages.

| Depth | Name         | Meaning                                                        | Owner |
|------:|--------------|----------------------------------------------------------------|-------|
| D0 | `discovered`  | URL known (sitemap/crawl), not yet rendered                    | extract (discovery) |
| D1 | `extracted`   | Live Playwright capture exists (`current/pages/<slug>.json`)   | extract |
| D2 | `directed`    | In scope of an active direction; **template assigned** (typed) | direct |
| D3 | `prototyped`  | Redesigned HTML prototype exists (`approved` is a sub-flag)    | prototype |
| D4 | `optimized`   | Findings detected **and** all `design-pass` findings for this page resolved or accepted | optimize + prototype |
| D5 | `migrated`    | Final migrated **HTML** emitted (`migrated/…`)                 | migrate |
| D6 | `delivered`   | Converted + deployed to AEM-EDS and verified live              | deploy |

D1–D3 and D5 are the existing stardust states; **D0, D4, D6 are new**. The
existing `extracted/directed/prototyped/approved/migrated` strings remain in
`state.json`; `depth` is the numeric projection the campaign reasons over.

### 3.3 Iteration & batches

An **iteration** advances a chosen **batch** (a portion of the inventory) toward
a **target depth**. A batch is `{ id, selector, targetDepth, openedAt }` where
`selector` is one of: explicit slugs, a template id, a page type, a URL glob, or
`all`. Every page/template/block row carries the `batch` id that brought it to
its current depth, so the dashboard can show an iteration timeline and the user
can "start with the homepage + nav + article template, then widen."

`site` recommends the next batch (heuristics in § 6.4) but the user confirms.

### 3.4 `state.json` extensions

Additive, backward-compatible. New optional keys (schema:
`state-extensions.schema.json`):

- `site` block gains `delivery: { target, deployUrl, status }`.
- Each `pages[]` entry gains optional `depth` (int 0–6), `templateId`,
  `contentMode` (`verbatim|optimized`), `batchId`.
- New top-level optional `campaign` block: `{ activeBatch, iterations[],
  targets[] }`.
- New top-level optional `optimize` block: `{ lastRunAt, scorecardPath,
  findingsPath, openP1 }`.

Skills that predate these keys keep working; absence means "not yet tracked."

## 4. Three tracking dimensions in detail

### 4.1 Pages

Source of truth for *which pages exist* stays `state.json.pages[]` + the crawl
log. `coverage/pages.json` adds the campaign view. A page tracks:

- identity: `slug`, `url`, `title`
- `templateId` — the template that governs its redesign
- `depth` + per-rung timestamps (mirrors `state.json.history`)
- `optimize`: `{ score, findings: { total, P1, P2, P3, open, fixed } }`
- `contentMode`: `verbatim` (default) | `optimized`
- `delivery`: `{ target, status, deployedUrl }` (filled by deploy)
- `batchId`, `stale`

"Pages still to redesign" = pages with `depth < D3`. "…to migrate" =
`depth < D5`. "…to deliver" = `depth < D6`. The dashboard reads these directly.

### 4.2 Templates

A **template** is the design structure shared by a set of pages — stardust
already models this as page `type` + an **approved archetype** + canon. The
templates ledger makes it explicit and trackable:

- `id`, `label`, `type` (landing/article/listing/program/form/static/unique)
- `archetypeSlug` — the representative page whose **approved** prototype defines
  the template
- `status`: `candidate` → `confirmed` → `archetype-approved` → `canon-folded`
- `pages[]` (slugs) + `pageCount`
- `coverage`: `{ prototyped, migrated, delivered }` counts → percentages
- `blocks[]` — block ids this template composes
- `depth` (representative)

This is what powers "you have 7 templates; 4 are archetype-approved, covering
112 of 134 pages; the `program` template archetype is still pending."

### 4.3 Content blocks

A **block** is a reusable content section. stardust already has two flavours:
**brand modules** (`DESIGN.json.extensions.modules[]`, with typed slots) and
**section archetypes** (the `data-*`-tagged sections in prototypes). The blocks
ledger unifies them:

- `id`, `label`, `kind`: `chrome` (header/footer) | `module` | `section`
- `slots[]`: `{ name, type, required, default }`
- `usedByTemplates[]`, `instanceCount` (how many page instances)
- `generation`: `{ redesignStatus: pending|prototyped|canonized, contentStatus }`
- `optimize`: finding ids touching this block
- `delivery`: `{ target, edsBlockName, status, blockPath }` (filled by deploy)
- `depth`

This powers "134 pages compose 19 distinct blocks; 15 are canonized, 11 are
converted to EDS blocks, the `pricing-table` block still needs a redesign pass."

## 5. `optimize` — the site-optimization subsystem

Ports the **7 detection layers** from the stardust audit. The skill **detects
and records**; the **fixes are applied by the existing phases** (direct /
prototype / migrate for `design-pass`, deploy for `platform-migration`) and
marked resolved in the ledger — closing the detect → fix → verify loop the audit
site describes.

### 5.1 The seven layers

| Layer id | Name | ~Checks | Method |
|---|---|---:|---|
| `brand-tensions` | Brand tensions | 13 | deterministic detectors |
| `design-ux` | Design & UX | 20 | design-director judgment |
| `accessibility` | Accessibility | 9 | rendered (real browser) |
| `seo` | On-page SEO | 18 | live fetch + parse |
| `content-conversion` | Content & conversion | 10 | judgment |
| `ai-search` | AI-search readiness | 6 | fetch (llms.txt / OKF / citability) |
| `cross-page` | Cross-page consistency | 10 | multi-page crawl |

The exact check catalog lives in the future `optimize/reference/checks.md`; the
ledger references checks by `layer` + `check` id, so the catalog can grow
without a schema change.

### 5.2 Fixability (mirrors the audit site's Yes / Partial / No)

Every finding is tagged:

- `design-pass` — the redesign fixes it directly (type scale, CTA discipline,
  hierarchy, contrast, alt text…). Resolved by direct/prototype/migrate.
- `platform-migration` — resolved by the EDS migration / regeneration, not the
  design pass (Core Web Vitals/CLS, semantic landmarks via blocks, sitemap,
  self-canonical, font CLS). Resolved by **deploy**.
- `out-of-scope` — infrastructure/TLS/external (informational only).

### 5.3 Ledger & scorecard

- `optimize/findings.json` — append-only `runs[]` + a `findings[]` array. A
  finding carries `{ id, layer, check, severity (P1|P2|P3), scope (site|template|
  page|block + ids), evidence, fixability, recommendedMove, status (open|
  in-progress|fixed|accepted|wontfix), resolvedBy }`. The resolving phase flips
  `status` and stamps `resolvedBy: { phase, artifact, at }`.
- `optimize/scorecard.json` — the 7 dimensions each 0–100, an overall site-health
  0–100, severity mix, "uplift headroom", and a `history[]` so the dashboard can
  show the score climbing across iterations.

### 5.4 Where detection plugs in

`optimize` is callable standalone (`stardust:optimize [scope]`) and is also run
by `site` at two points per batch: once after **extract** (baseline findings on
the current site — this also enriches the existing `brand-review.html` tensions)
and once after **prototype/migrate** (verify findings were actually fixed →
advances pages to D4 and updates the scorecard).

## 6. `site` — the campaign orchestrator

### 6.1 Entry

`stardust:site <url>` starts (or resumes) a campaign. First run delegates to
`uplift <url>` to produce the initial brand surface, three variants, and the
first audit baseline. Resume reads `coverage/` + `journal.md` and reports.

### 6.2 The loop

```
uplift (once)  →  [ select batch + target depth ]  →  advance batch  →  refresh
   │                        ▲                              │            coverage,
   └─ initial gate          └──────────  next iteration ───┘            optimize,
                                                                        dashboard,
                                                                        counts, journal
```

"Advance batch" runs the agnostic pipeline for the batch's pages up to the
target depth, parallelised by template cluster (§ 8), then — if the target depth
is D6 — hands the batch to `deploy` for delivery.

### 6.3 Gates (where user input is required)

Per the brief: heavy input at the start, then only when required.

1. **Initial direction** (after uplift): pick variant/direction; confirm
   template catalog; choose content posture; choose the first batch + depth.
2. **Template-catalog confirmation** when a new page type is discovered.
3. **Content posture per batch** when a batch opts pages into `optimized` mode.
4. **Audit P1 prioritisation** when new P1 findings appear.
5. **Delivery go/no-go** before `deploy` pushes to AEM.

Between gates, `site` runs autonomously and reports at iteration boundaries.

### 6.4 Counts & "what's missing" report

After every iteration `site` prints (and the dashboard renders):

```
site campaign — example.com         target: aem-eds      iteration 3
=====================================================================
Pages       134 total   ·  88 redesigned (D3+)   ·  61 migrated (D5+)  ·  20 delivered (D6)
            → 46 still to redesign · 73 still to migrate · 114 still to deliver
Templates     7 total   ·  4 archetype-approved   ·  covering 112/134 pages
            → program, form, search archetypes still pending
Blocks       19 total   ·  15 canonized           ·  11 converted to EDS
            → pricing-table, comparison, faq-accordion still pending redesign
Optimize    health 71/100 (+13 since baseline) · P1 3 open / 4 fixed · P2 9 open
Next        recommended batch: "article template + 24 article pages" → D5
Gates       1 waiting: confirm `program` template archetype
```

### 6.5 Recommendation heuristics

In order: unresolved gate → finish the in-flight batch → approve a pending
template archetype (unblocks the most pages) → advance the batch with the most
pages closest to the next depth → run `optimize` if the scorecard is stale →
otherwise recommend `deploy` for migrated-but-undelivered pages.

## 7. Content fidelity dial (verbatim-first, opt-in optimize)

Extends `migrate/reference/content-preservation.md`. Each page (and, finer, each
section) carries `contentMode`:

- **`verbatim`** (default) — today's behaviour: headlines, body copy, CTA
  labels, nav labels, form schema, alt text, link destinations preserved
  exactly; only restyled.
- **`optimized`** — a **bounded** modification is allowed, gated by a
  **modification budget**:
  - Eligible only when (a) the user opts the page/batch in, **or** (b) a
    `design-pass` finding in `{content-conversion, seo}` justifies the specific
    edit.
  - Allowed edits: microcopy/CTA-label consolidation, meta title/description,
    heading text **for hierarchy only**, alt-text improvement. **Never**
    body-paragraph rewriting; **never** invented facts (stats, names, prices,
    legal) — those stay `[data-placeholder]` per existing rules.
  - Every edit is logged in the page `_meta.json` `contentDeviations[]` with
    `{ kind, findingId, before, after, rationale }` — the audit trail that keeps
    "controlled" honest.

Images are always migrated verbatim (existing asset-bundling); "optimize" never
substitutes imagery — at most it re-crops/re-positions within layout, which is a
prototype concern, not a content edit.

## 8. Parallel agents without drift

Builds on `deploy` Step 7's existing "one agent per archetype cluster,
non-overlapping blocks" pattern and generalises it across phases.

### 8.1 Unit of parallelism

A **template cluster** (an archetype + its sibling pages) or a **page batch
slice**. One agent owns a non-overlapping set. 3–4 agents is the sweet spot.

### 8.2 The frozen-brief + claim contract

Before working, an agent acquires a **claim** in `coverage/claims.json`:
`{ id, agent, scope, phase, frozenBrief, status, acquiredAt, heartbeatAt }`.
The `frozenBrief` pins the inputs the agent may use:

- `directionSha`, `canonSha` — the agent renders against these exact versions.
- `templateArchetype` — the approved archetype it forks (Path A′).
- `pages[]` — its and only its scope.
- `findings[]` — the optimize findings in its scope it is responsible for.
- `blockContract` — the slot shapes it must honour.

**An agent may not**: re-derive direction, mint new canon, re-type pages outside
its scope, mark findings fixed it didn't address, or skip a validation gate.
These are the "no drift / no shortcuts" invariants — they're written into the
agent brief and re-checked by `site` at merge time.

### 8.3 Fragment-merge (avoids last-write-wins)

Stardust deliberately does not lock (`state-machine.md` § Concurrency). So each
agent writes **only its own per-page artifacts** + a **per-unit ledger
fragment** at `coverage/fragments/<claim-id>.json` (never the shared ledgers).
When the agents finish, `site` **merges** the fragments into
`coverage/pages|templates|blocks.json` in a single owner-process write. Merge is
deterministic (keyed by slug/id) and rejects fragments whose `frozenBrief` shas
no longer match the active direction/canon (catches a drifted or stale agent).

### 8.4 Heartbeat & reclaim

A claim carries `heartbeatAt`; a stale claim (no heartbeat past a threshold) can
be reclaimed by `site` and its scope reassigned. Completed claims are retained
for the iteration's audit trail, then archived.

## 9. `deploy` expansion (AEM-EDS) + the target seam

`deploy` keeps its current AEM-EDS conversion methodology (section→block,
fragments, DA Source API, the CWV/CLS/font discipline) and gains:

- **Delivery coverage**: writes the `delivery` overlay on `pages.json` /
  `blocks.json` (`status: pending|converting|deployed|verified`, `deployedUrl`,
  `edsBlockName`). Advances delivered pages to **D6**.
- **Findings realisation**: consumes `platform-migration` findings (CWV/CLS,
  semantic landmarks, sitemap, self-canonical, font CLS) and marks them `fixed`
  with `resolvedBy: { phase: deploy }` when the delivered page verifies.
- **Delivery dashboard data**: feeds the per-target panel.

### 9.1 The target-contract seam (for the future, documented now)

So others can contribute platforms without touching core, `deploy` reads/writes
a stable contract (to be documented in `deploy/reference/target-contract.md`):

- **Input**: the migrated HTML tree + `coverage/*` + `optimize/findings.json`
  (the `platform-migration` subset).
- **Output**: per-page/per-block `delivery` rows + resolved findings + a
  verification report.
- A target declares `{ id, label, capabilities[], fixesFindingLayers[] }`. AEM-EDS
  is the first `targetId`. The single-skill-for-now decision means we don't split
  `deploy-<platform>` skills yet — we just keep the AEM specifics behind this
  documented boundary so the split is mechanical later.

## 10. `dashboard` — visual progress

Generates `stardust/dashboard/index.html` — **self-contained, no external JS**,
rendered in the captured brand's colours/fonts (the same ethos as
`brand-review.html` and the audit pages). Panels:

1. **Headline counts** — pages/templates/blocks totals + remaining-to-redesign /
   -migrate / -deliver.
2. **Coverage matrix** — pages × depth (D0–D6) stacked bars; template coverage
   %; block status grid.
3. **Audit scorecard** — 7 dimensions + overall health, P1/P2/P3 burn-down
   across iterations (reads `scorecard.history[]`).
4. **Iteration timeline** — each batch and the depth it advanced.
5. **Delivery panel** (when a target is active) — converted / deployed /
   verified.

`dashboard/data.json` is the snapshot the HTML renders, so the numbers are
inspectable and testable independent of the HTML. `site` regenerates the
dashboard at every iteration boundary.

## 11. Phasing (build order — not part of this deliverable)

Each phase is independently testable; the agnostic phases (P1–P4) ship value
without any AEM.

- **P1 — Tracking foundation.** `coverage/*` schemas + `state.json` extensions +
  `dashboard` skill. Wire existing phases to write `depth`. Deliverable: a
  dashboard that reflects a real stardust project's progress.
- **P2 — `optimize`.** 7-layer detection + `findings.json` + `scorecard.json` +
  fixability tagging; enrich `brand-review.html`. Deliverable: a findings ledger
  + scorecard for an extracted site.
- **P3 — `site` orchestrator.** Iteration/depth/batches/gates/counts + the
  parallel claim/frozen-brief/fragment-merge protocol; uplift entry. Deliverable:
  an end-to-end agnostic campaign (uplift → … → migrated HTML) with live
  tracking.
- **P4 — Content fidelity dial.** `contentMode` in migrate + content-preservation
  + modification-budget logging. Deliverable: opt-in optimized content with an
  auditable deviation trail.
- **P5 — `deploy` expansion (AEM-EDS).** Delivery coverage + findings realisation
  + delivery dashboard + the documented target-contract seam. Deliverable: the
  full redesign → optimize → migrate → **deploy to AEM-EDS** workflow with D6
  tracking.

## 12. Open questions for the next review

1. **Depth vs status duplication** — confirm `depth` is a *projection* over the
   existing `state.json` strings (this plan's stance) rather than a new
   authoritative field, to avoid two sources of truth.
2. **Template identity** — should `templateId` equal the page `type`, or can one
   `type` host multiple templates (e.g. two distinct `landing` archetypes)? The
   schema allows the latter; confirm the intended granularity.
3. **optimize check catalog** — port the exact ~86 checks now, or seed the
   high-value subset the audit site enumerates and grow the catalog per project?
4. **Dashboard hosting** — file:// self-contained only (this plan), or also a
   `deploy`-published live dashboard alongside the AEM site?

## 13. Reference map

- Existing architecture this builds on: `skills/stardust/reference/state-machine.md`
  (lifecycle, types, concurrency), `artifact-map.md` (file ownership),
  `skills/migrate/reference/content-preservation.md` (verbatim rules),
  `skills/prepare-migration/SKILL.md` (prep cascade), `skills/deploy/SKILL.md`
  (EDS conversion + parallel agents), `skills/uplift/SKILL.md` (entry).
- Audit model ported by `optimize`: `github.com/paolomoz/semrush-stardust/audit`
  (7 layers, fixability map, scorecard).
- Schemas accompanying this plan: `schemas/*.schema.json`; worked examples:
  `examples/*.example.json`.
```
