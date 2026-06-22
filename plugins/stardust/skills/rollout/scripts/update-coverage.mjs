#!/usr/bin/env node
/**
 * rollout/update-coverage.mjs — deterministic state-writer for the delivery loop.
 *
 * The per-page delivery itself is the LLM-driven `deploy` methodology; this helper
 * just records the outcome in the coverage ledger so the loop stays honest and
 * resumable. Call it after each page's deploy step.
 *
 * Usage:
 *   node skills/rollout/scripts/update-coverage.mjs <slug> --status <s> [--url <deployedUrl>] [--error <msg>] [--out <rolloutDir>]
 *   <status>: pending | converting | deployed | verified | stale | failed
 *
 * Re-derives the rollout.json + templates.json roll-ups after the write.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slug = process.argv[2];
const STATUSES = ['pending', 'converting', 'deployed', 'verified', 'stale', 'failed'];
const status = arg('status', null);
const url = arg('url', null);
const error = arg('error', null);
const OUT = arg('out', 'stardust/rollout');

if (!slug || slug.startsWith('--') || !status || !STATUSES.includes(status)) {
  console.error(`usage: update-coverage.mjs <slug> --status <${STATUSES.join('|')}> [--url <u>] [--error <m>]`);
  process.exit(2);
}

const pagesPath = join(OUT, 'coverage', 'pages.json');
const templatesPath = join(OUT, 'coverage', 'templates.json');
const configPath = join(OUT, 'rollout.json');
const readJSON = (p, f = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return f; } };

const doc = readJSON(pagesPath);
if (!doc) { console.error(`rollout: ${pagesPath} not found — run inventory.mjs first.`); process.exit(1); }

const page = (doc.pages || []).find((p) => p.slug === slug);
if (!page) { console.error(`rollout: no page with slug "${slug}" in coverage.`); process.exit(1); }

const now = new Date().toISOString();
page.delivery = page.delivery || {};
page.delivery.status = status;
if (status === 'deployed') { page.delivery.deployedAt = now; if (url) page.delivery.deployedUrl = url; }
if (status === 'verified') { page.delivery.verifiedAt = now; if (url) page.delivery.deployedUrl = url; }
if (status === 'failed') { page.delivery.error = error || 'unspecified'; } else { page.delivery.error = null; }

doc.generatedAt = now;
writeFileSync(pagesPath, `${JSON.stringify(doc, null, 2)}\n`);

// Re-derive template roll-ups + config counts from the updated pages.
const pages = doc.pages || [];
const countBy = (subset, s) => subset.filter((p) => p.delivery && p.delivery.status === s).length;

const tdoc = readJSON(templatesPath);
if (tdoc && Array.isArray(tdoc.templates)) {
  for (const t of tdoc.templates) {
    const tp = pages.filter((p) => (t.pages || []).includes(p.slug));
    t.delivery = {
      verified: countBy(tp, 'verified'),
      deployed: countBy(tp, 'deployed'),
      pending: tp.length - countBy(tp, 'verified') - countBy(tp, 'deployed'),
    };
  }
  tdoc.generatedAt = now;
  writeFileSync(templatesPath, `${JSON.stringify(tdoc, null, 2)}\n`);
}

const config = readJSON(configPath);
if (config) {
  const counts = {
    total: pages.length,
    verified: countBy(pages, 'verified'),
    deployed: countBy(pages, 'deployed'),
    pending: countBy(pages, 'pending'),
    stale: countBy(pages, 'stale'),
    failed: countBy(pages, 'failed'),
  };
  config.lastRun = { ...(config.lastRun || {}), at: now, pages: counts, verifyFailures: counts.failed };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${slug} → ${status}   (site: ${counts.verified} verified / ${counts.deployed} deployed / ${counts.pending + counts.stale} remaining of ${counts.total})`);
} else {
  console.log(`${slug} → ${status}`);
}
