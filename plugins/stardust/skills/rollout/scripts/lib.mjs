/**
 * rollout/lib.mjs — shared IO + roll-up helpers so every script derives the same
 * counts from the same per-unit truth (counts are always recomputed, never
 * incremented).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

const countBy = (rows, get, val) => rows.filter((r) => get(r) === val).length;

/** Page delivery counts from coverage/pages.json rows. */
export function pageCounts(pages) {
  const g = (p) => (p.delivery && p.delivery.status) || 'pending';
  return {
    total: pages.length,
    verified: countBy(pages, g, 'verified'),
    deployed: countBy(pages, g, 'deployed'),
    pending: countBy(pages, g, 'pending'),
    stale: countBy(pages, g, 'stale'),
    failed: countBy(pages, g, 'failed'),
  };
}

/** Block conversion counts from coverage/blocks.json rows. */
export function blockCounts(blocks) {
  const converted = blocks.filter((b) => ['converted', 'deployed', 'verified']
    .includes(b.delivery && b.delivery.status)).length;
  return { total: blocks.length, converted, pending: blocks.length - converted };
}

/** Recompute each template's delivery roll-up in place from the page rows. */
export function rollupTemplates(templatesDoc, pages) {
  if (!templatesDoc || !Array.isArray(templatesDoc.templates)) return;
  for (const t of templatesDoc.templates) {
    const tp = pages.filter((p) => (t.pages || []).includes(p.slug));
    const g = (p) => (p.delivery && p.delivery.status) || 'pending';
    t.delivery = {
      verified: countBy(tp, g, 'verified'),
      deployed: countBy(tp, g, 'deployed'),
      pending: tp.length - countBy(tp, g, 'verified') - countBy(tp, g, 'deployed'),
    };
  }
}

/** Recompute rollout.json lastRun from the page + (optional) block rows. */
export function rollupConfig(config, pages, blocks, now) {
  if (!config) return;
  const counts = pageCounts(pages);
  config.lastRun = {
    ...(config.lastRun || {}),
    at: now,
    pages: counts,
    blocks: blocks ? blockCounts(blocks) : (config.lastRun && config.lastRun.blocks) || { total: 0, converted: 0, pending: 0 },
    verifyFailures: counts.failed,
  };
}

/** EDS block name from a block id: kebab + guard against reserved EDS classes (#15). */
const RESERVED = new Set(['section', 'default-content', 'block-content', 'wrap', 'button']);
export function edsName(id) {
  let n = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!n) n = 'block';
  if (RESERVED.has(n)) n = `blk-${n}`;
  return n;
}

/** Chrome ids deliver as static fragments, not per-page blocks. */
export const CHROME_IDS = new Set(['header', 'nav', 'footer']);
export const kindOf = (id) => (CHROME_IDS.has(String(id).toLowerCase()) ? 'chrome' : 'module');
