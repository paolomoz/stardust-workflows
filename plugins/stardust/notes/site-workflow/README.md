# site-workflow — design package

Proposal for extending stardust into a **full-site redesign, optimization &
migration-to-AEM workflow**. This folder is the review deliverable; **no skill
code is written yet**.

## Contents

- **`PLAN.md`** — the design document. Start here. Covers the two-tier skill map
  (agnostic core vs the platform `deploy` layer), the page/template/block
  coverage model, the D0–D6 depth ladder, the `optimize` audit subsystem, the
  content-fidelity dial, the parallel-agent (claim + frozen-brief + fragment-merge)
  protocol, the `dashboard`, and the build phasing.
- **`schemas/`** — JSON Schema (draft 2020-12) for every new file:
  - `coverage-pages.schema.json`, `coverage-templates.schema.json`,
    `coverage-blocks.schema.json` — the three tracking dimensions.
  - `coverage-claims.schema.json` — the parallel-agent lease file.
  - `optimize-findings.schema.json`, `optimize-scorecard.schema.json` — the audit
    subsystem.
  - `state-extensions.schema.json` — the additive `state.json` keys.
- **`examples/`** — worked instances (`coverage-pages.example.json`,
  `optimize-findings.example.json`) that validate against the schemas and make
  the detect→fix→verify loop concrete.

## Decisions locked for this proposal

| Decision | Choice |
|---|---|
| AEM target | Edge Delivery Services (EDS / da.live) |
| Core stays | platform-agnostic (HTML only): extract, direct, prototype, migrate, uplift |
| Platform layer | the existing `deploy` skill, expanded in place for AEM-EDS (target-contract seam left for future platforms) |
| New core skills | `site` (orchestrator), `optimize` (detector), `dashboard` |
| Content posture | verbatim-first, opt-in optimize (logged modification budget) |
| This step | written plan + schemas only |

## Open questions

See `PLAN.md` § 12 — depth-vs-status duplication, template identity granularity,
the optimize check-catalog scope, and dashboard hosting.
