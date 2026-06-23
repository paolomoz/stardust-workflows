#!/usr/bin/env node
/**
 * rollout/dashboard.mjs — self-contained visual progress dashboard (Phase 4).
 *
 * Reads the rollout coverage + optimize ledger and emits:
 *   - stardust/rollout/dashboard/data.json  (the inspectable snapshot the HTML renders)
 *   - stardust/rollout/dashboard/index.html (self-contained, no external JS, brand-tinted)
 *
 * Panels: headline counts · delivery matrix (status + per-template + blocks) ·
 * quality scorecard (7 dimensions + overall + severity + history) · findings &
 * autofix routing · what's-missing.
 *
 * Usage: node skills/rollout/scripts/dashboard.mjs [--out <rolloutDir>]
 */
import { join } from 'node:path';
import { readJSON, writeJSON } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const i = process.argv.indexOf('--out');
const OUT = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'stardust/rollout';

const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!pagesDoc) { console.error('rollout dashboard: run inventory.mjs first.'); process.exit(1); }
const pages = pagesDoc.pages || [];
const templates = (readJSON(join(OUT, 'coverage', 'templates.json'), {}).templates) || [];
const blocks = (readJSON(join(OUT, 'coverage', 'blocks.json'), {}).blocks) || [];
const findingsDoc = readJSON(join(OUT, 'optimize', 'findings.json'), { findings: [], runs: [] });
const scorecard = readJSON(join(OUT, 'optimize', 'scorecard.json'), null);
const findings = findingsDoc.findings || [];

// brand accent (graceful): try the captured extraction, else default
const brand = readJSON(join(OUT, '..', 'current', '_brand-extraction.json'), null);
const accent = (() => {
  try { return (brand.palette.find((p) => p.role === 'primary') || brand.palette[0]).value; } catch { return '#147aff'; }
})();

const countStatus = (arr, get) => arr.reduce((m, x) => { const s = get(x); m[s] = (m[s] || 0) + 1; return m; }, {});
const pageStatus = countStatus(pages, (p) => (p.delivery && p.delivery.status) || 'pending');
const open = findings.filter((f) => f.status === 'open' || f.status === 'in-progress');

const snapshot = {
  generatedAt: new Date().toISOString(),
  target: config.target || 'aem-eds',
  site: { sourceUrl: (config.site && config.site.sourceUrl) || null, liveHost: (config.site && config.site.liveHost) || null },
  pages: {
    total: pages.length,
    verified: pageStatus.verified || 0, deployed: pageStatus.deployed || 0,
    pending: pageStatus.pending || 0, stale: pageStatus.stale || 0, failed: pageStatus.failed || 0,
    byStatus: pageStatus,
  },
  templates: templates.map((t) => ({ id: t.id, pageCount: t.pageCount, delivery: t.delivery || {} })),
  blocks: {
    total: blocks.length,
    converted: blocks.filter((b) => ['converted', 'deployed', 'verified'].includes(b.delivery && b.delivery.status)).length,
    module: blocks.filter((b) => b.kind === 'module').length,
    chrome: blocks.filter((b) => b.kind === 'chrome').length,
  },
  quality: scorecard ? {
    overall: scorecard.current.overall, dimensions: scorecard.current.dimensions,
    severity: scorecard.current.severity, fixed: scorecard.current.fixed,
    history: (scorecard.history || []).map((h) => h.overall),
  } : null,
  findings: {
    byFixability: countStatus(open, (f) => f.fixability),
    byAutofix: countStatus(open.filter((f) => f.autofix && f.autofix.available), (f) => f.autofix.status),
    bySource: countStatus(open, (f) => f.source),
    openP1: open.filter((f) => f.severity === 'P1').map((f) => ({ check: f.check, source: f.source, scope: f.scope.ids.join(','), evidence: f.evidence })),
  },
  missing: {
    pages: pages.filter((p) => ['pending', 'stale', 'failed'].includes(p.delivery && p.delivery.status)).map((p) => p.slug),
    blocks: blocks.filter((b) => !['converted', 'deployed', 'verified'].includes(b.delivery && b.delivery.status)).map((b) => b.id),
  },
};

const dashDir = join(OUT, 'dashboard');
mkdirSync(dashDir, { recursive: true });
writeJSON(join(dashDir, 'data.json'), snapshot);
writeFileSync(join(dashDir, 'index.html'), render(snapshot, accent));

console.log(`rollout dashboard → ${join(dashDir, 'index.html')}`);
console.log('='.repeat(60));
console.log(`Pages ${snapshot.pages.verified}/${snapshot.pages.total} verified · Blocks ${snapshot.blocks.converted}/${snapshot.blocks.total} converted · Health ${snapshot.quality ? `${snapshot.quality.overall}/100` : 'n/a'}`);

// ---------------------------------------------------------------- rendering
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function statusBar(byStatus, total) {
  const order = [['verified', '#2e9e5b'], ['deployed', '#5b8def'], ['pending', '#9aa3ad'], ['stale', '#e0a72e'], ['failed', '#d6473b']];
  const segs = order.filter(([s]) => byStatus[s]).map(([s, c]) => `<span class="seg" style="width:${pct(byStatus[s], total)}%;background:${c}" title="${s}: ${byStatus[s]}"></span>`).join('');
  const key = order.filter(([s]) => byStatus[s]).map(([s, c]) => `<span class="k"><i style="background:${c}"></i>${s} ${byStatus[s]}</span>`).join('');
  return `<div class="bar">${segs}</div><div class="keys">${key}</div>`;
}

function dimBars(dims) {
  const labels = { 'brand-tensions': 'Brand', 'design-ux': 'Design/UX', accessibility: 'A11y', seo: 'SEO', 'content-conversion': 'Content', 'ai-search': 'AI-search', 'cross-page': 'Cross-page' };
  return Object.entries(labels).map(([k, label]) => {
    const v = dims[k];
    if (v === null || v === undefined) return `<div class="dim"><span class="dl">${label}</span><span class="dn na">not assessed</span></div>`;
    const c = v >= 80 ? '#2e9e5b' : v >= 50 ? '#e0a72e' : '#d6473b';
    return `<div class="dim"><span class="dl">${label}</span><span class="dbar"><i style="width:${v}%;background:${c}"></i></span><span class="dn">${v}</span></div>`;
  }).join('');
}

function sparkline(hist) {
  if (!hist || hist.length < 2) return '';
  const w = 220; const h = 40; const max = 100;
  const pts = hist.map((v, idx) => `${(idx / (hist.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts}"/></svg><div class="muted">overall health across ${hist.length} runs → ${hist.at(-1)}</div>`;
}

function templateRows(ts) {
  return ts.map((t) => {
    const d = t.delivery || {}; const v = d.verified || 0;
    return `<tr><td>${esc(t.id)}</td><td>${t.pageCount}</td><td><span class="mini"><i style="width:${pct(v, t.pageCount)}%"></i></span>${v}/${t.pageCount}</td></tr>`;
  }).join('');
}

function chips(obj, colors = {}) {
  const e = Object.entries(obj);
  if (!e.length) return '<span class="muted">none</span>';
  return e.map(([k, n]) => `<span class="chip" style="border-color:${colors[k] || '#ccd2d9'}">${esc(k)} <b>${n}</b></span>`).join('');
}

function render(s, ac) {
  const q = s.quality;
  const health = q ? q.overall : null;
  const hc = health === null ? '#9aa3ad' : health >= 80 ? '#2e9e5b' : health >= 50 ? '#e0a72e' : '#d6473b';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>rollout — ${esc(s.site.sourceUrl || s.target)}</title>
<style>
:root{--accent:${ac};--ink:#1a1f26;--muted:#6b757f;--line:#e7eaee;--bg:#f6f7f9;--card:#fff}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:1100px;margin:0 auto;padding:28px 22px 60px}
header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:22px}
h1{font-size:20px;margin:0}h1 b{color:var(--accent)}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 12px}
.muted{color:var(--muted);font-size:12px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card .n{font-size:30px;font-weight:700;line-height:1}.card .l{font-size:12px;color:var(--muted);margin-top:6px}.card .s{font-size:12px;margin-top:8px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:14px}
.bar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:#eef0f3}.seg{display:block}
.keys{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px}.k{font-size:12px;color:var(--muted)}.k i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.mini{display:inline-block;width:90px;height:8px;border-radius:4px;background:#eef0f3;margin-right:8px;vertical-align:middle;overflow:hidden}.mini i{display:block;height:100%;background:#2e9e5b}
.dim{display:flex;align-items:center;gap:10px;margin:7px 0}.dl{width:90px;font-size:12px;color:var(--muted)}.dbar{flex:1;height:9px;background:#eef0f3;border-radius:5px;overflow:hidden}.dbar i{display:block;height:100%}.dn{width:34px;text-align:right;font-variant-numeric:tabular-nums}.dn.na{color:#b6bcc4;font-size:11px;width:auto}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.gauge{display:flex;align-items:center;gap:16px}.gauge .big{font-size:44px;font-weight:800;color:${hc}}
.sev{display:flex;gap:10px;margin-top:6px}.pill{border-radius:20px;padding:3px 11px;font-size:12px;font-weight:600;color:#fff}
.chip{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:3px 10px;margin:3px 4px 0 0;font-size:12px}.chip b{color:var(--accent)}
ul.miss{margin:6px 0 0;padding-left:18px;font-size:13px;columns:2}
.p1 li{font-size:12px;margin:4px 0}.p1 code{background:#fbeae8;color:#a3271c;padding:1px 5px;border-radius:4px}
footer{margin-top:26px;color:var(--muted);font-size:11px;border-top:1px solid var(--line);padding-top:12px}
@media(max-width:720px){.cards{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}ul.miss{columns:1}}
</style></head><body><div class="wrap">
<header><h1>rollout <b>→ ${esc(s.target)}</b></h1><div class="muted">${esc(s.site.sourceUrl || '')}${s.site.liveHost ? ` · ${esc(s.site.liveHost)}` : ''} · ${esc(s.generatedAt.slice(0, 16).replace('T', ' '))}</div></header>

<div class="cards">
  <div class="card"><div class="n">${s.pages.verified}<span class="muted" style="font-size:16px">/${s.pages.total}</span></div><div class="l">pages verified</div><div class="s muted">${s.pages.deployed} deployed · ${s.pages.pending + s.pages.stale} to go</div></div>
  <div class="card"><div class="n">${s.templates.length}</div><div class="l">templates</div><div class="s muted">grouping ${s.pages.total} pages</div></div>
  <div class="card"><div class="n">${s.blocks.converted}<span class="muted" style="font-size:16px">/${s.blocks.total}</span></div><div class="l">blocks converted</div><div class="s muted">${s.blocks.module} module · ${s.blocks.chrome} chrome</div></div>
  <div class="card"><div class="n" style="color:${hc}">${health === null ? '—' : health}</div><div class="l">quality health</div><div class="s muted">${q ? `P1 ${q.severity.P1} · P2 ${q.severity.P2} · P3 ${q.severity.P3} open` : 'optimize not run'}</div></div>
</div>

<h2>Delivery</h2>
<div class="panel">${statusBar(s.pages.byStatus, s.pages.total)}</div>
<div class="panel"><table><thead><tr><th>template</th><th>pages</th><th>verified</th></tr></thead><tbody>${templateRows(s.templates)}</tbody></table></div>

<h2>Quality</h2>
${q ? `<div class="grid2">
  <div class="panel"><div class="gauge"><div class="big">${health}</div><div><div class="muted">overall health</div><div class="sev">
    <span class="pill" style="background:#d6473b">P1 ${q.severity.P1}</span><span class="pill" style="background:#e0a72e">P2 ${q.severity.P2}</span><span class="pill" style="background:#9aa3ad">P3 ${q.severity.P3}</span>
  </div><div class="muted" style="margin-top:8px">fixed: P1 ${q.fixed.P1} · P2 ${q.fixed.P2} · P3 ${q.fixed.P3}</div></div></div>
    <div style="margin-top:14px">${sparkline(q.history)}</div></div>
  <div class="panel">${dimBars(q.dimensions)}</div>
</div>
<div class="panel"><b>Findings routing</b> &nbsp;<span class="muted">(open)</span><br>
  <div style="margin-top:8px">fixability: ${chips(s.findings.byFixability, { 'platform-migration': '#5b8def', 'design-pass': '#e0a72e', 'out-of-scope': '#9aa3ad' })}</div>
  <div style="margin-top:6px">autofix: ${chips(s.findings.byAutofix)}</div>
  <div style="margin-top:6px">source: ${chips(s.findings.bySource)}</div>
  ${s.findings.openP1.length ? `<div style="margin-top:10px"><b>Open P1</b><ul class="p1">${s.findings.openP1.map((f) => `<li><code>${esc(f.check)}</code> [${esc(f.scope)}] <span class="muted">${esc(f.source)}</span> — ${esc(f.evidence)}</li>`).join('')}</ul></div>` : '<div class="muted" style="margin-top:10px">no open P1 — gate clean ✓</div>'}
</div>` : '<div class="panel muted">optimize has not been run yet — run optimize.mjs (and record external audits) to populate the scorecard.</div>'}

<h2>What's missing</h2>
<div class="panel">
  <b>${s.missing.pages.length}</b> pages still to deliver${s.missing.pages.length ? `<ul class="miss">${s.missing.pages.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ' <span class="muted">— all delivered ✓</span>'}
  <div style="margin-top:10px"><b>${s.missing.blocks.length}</b> blocks not yet converted${s.missing.blocks.length ? `: <span class="muted">${s.missing.blocks.map(esc).join(', ')}</span>` : ' <span class="muted">— all converted ✓</span>'}</div>
</div>

<footer>Generated by stardust:rollout/dashboard from coverage/* + optimize/* · self-contained, no external JS · data.json holds this snapshot.</footer>
</div></body></html>`;
}
