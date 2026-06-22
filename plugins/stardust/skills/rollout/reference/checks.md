# optimize check catalog (rollout in-flow quality gate)

The deterministic detectors `optimize.mjs` runs over the delivered (or migrated)
HTML. Findings reference a check by `layer` + `check`; this catalog can grow
without a schema change. Severity drives the gate (any open **P1** fails it);
fixability routes the fix.

`fixability`: **PM** = platform-migration (rollout re-deploys to fix) · **DP** =
design-pass (upstream — fix in migrate/prototype; rollout only surfaces) · **OOS**
= out-of-scope (informational).

## accessibility

| check | sev | fix | fires when | recommended move |
|---|---|---|---|---|
| `landmark-main` | P1 | PM | no `<main>` in the delivered HTML | ensure block output lands inside `<main>` (deploy anti-pattern 17) |
| `img-alt` | P2 | DP | one or more `<img>` without `alt=` | author alt text upstream; rollout can't synthesize it |

## seo

| check | sev | fix | fires when | recommended move |
|---|---|---|---|---|
| `title-missing` | P1 | PM | no `<title>` | add a metadata block; EDS derives `<title>` (deploy #34) |
| `title-length` | P3 | PM | `<title>` < 10 or > 70 chars | ~50–60 chars: brand + primary keyword |
| `meta-description` | P2 | PM | no `<meta name="description">` | add a Description row to the metadata block |
| `single-h1` | P1 | PM | `<h1>` count ≠ 1 | hero headline = single `<h1>`; others `<h2>` (deploy #35) |
| `canonical` | P2 | PM | no `<link rel="canonical">` | emit a self-canonical link at delivery |
| `sitemap` (site) | P2 | PM | `rollout/site/sitemap.xml` absent | run `assemble.mjs` and deploy the sitemap |

## ai-search

| check | sev | fix | fires when | recommended move |
|---|---|---|---|---|
| `jsonld` | P2 | PM | no `application/ld+json` | emit page-type JSON-LD in the head |

## cross-page (site-level)

| check | sev | fix | fires when | recommended move |
|---|---|---|---|---|
| `duplicate-title` | P2 | DP | ≥2 pages share a `<title>` | unique titles upstream (migrate metadata) |
| `duplicate-description` | P3 | DP | ≥2 pages share a description | per-page descriptions upstream |

## Not yet assessed (judgment layers)

`brand-tensions`, `design-ux`, `content-conversion` need design-director / content
judgment, not deterministic parsing. They are scored `null` (not assessed) in the
scorecard and are reserved for a future LLM-driven enrichment pass that appends
findings to the same ledger. The schema already enumerates all seven layers.

## Scope & loop semantics

- A page-level finding is `id`-keyed by `layer|check|page-slug`; site-level by
  `layer|check|*` (or the involved slug set). Re-runs match by id — no duplicates.
- A finding is only resolved (→ `fixed`) when **this run actually inspected its
  scope** (the page was loaded, or site checks ran). A `--slug` run never marks
  another page's findings fixed.
- `accepted` / `wontfix` are human decisions and are never auto-reopened.
