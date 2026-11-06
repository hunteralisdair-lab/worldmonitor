#!/usr/bin/env node
/**
 * Build public/data/uk-polls.json: a poll-of-polls for Westminster voting
 * intention, aggregated from the Wikipedia page "Opinion polling for the
 * next United Kingdom general election" (which lists every published poll
 * with citations — including YouGov, Opinium, Survation etc. — so we embed
 * the aggregate rather than scraping any single pollster's proprietary
 * trackers).
 *
 * Parsing is deliberately defensive: party columns are located by header
 * text, rows without plausible percentage cells are skipped, and the script
 * fails loudly if fewer than 5 polls parse — stale output is never written
 * silently over good data.
 *
 * Usage: node scripts/fetch-uk-polls.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = resolve(ROOT, 'public/data/uk-polls.json');

const PAGE = 'Opinion_polling_for_the_next_United_Kingdom_general_election';
const HTML_URL = `https://en.wikipedia.org/api/rest_v1/page/html/${PAGE}`;
const UA = 'worldmonitor-politics-fork/1.0 (poll-of-polls build script)';

// Party key -> header patterns (case-insensitive, matched against th text)
const PARTIES = [
  { key: 'con',    label: 'Con',     patterns: [/^con/i] },
  { key: 'lab',    label: 'Lab',     patterns: [/^lab/i] },
  { key: 'libdem', label: 'Lib Dem', patterns: [/lib ?dem/i, /^ld$/i] },
  { key: 'snp',    label: 'SNP',     patterns: [/^snp/i] },
  { key: 'green',  label: 'Green',   patterns: [/^green?/i, /^grn/i] },
  { key: 'reform', label: 'Reform',  patterns: [/^ref/i] },
];

// GE 2024 national vote shares (GB), for the "vs 2024" deltas in the panel.
const GE2024 = { con: 23.7, lab: 33.7, libdem: 12.2, snp: 2.5, green: 6.7, reform: 14.3 };

function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellsOf(rowHtml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
    const colspanMatch = openTag.match(/colspan="?(\d+)/i);
    out.push({ text: stripTags(m[1]), colspan: colspanMatch ? parseInt(colspanMatch[1], 10) : 1 });
  }
  return out;
}

const res = await fetch(HTML_URL, { headers: { 'User-Agent': UA } });
if (!res.ok) throw new Error(`Wikipedia HTML fetch failed: HTTP ${res.status}`);
const html = await res.text();

const tableMatch = html.match(/<table[^>]*wikitable[\s\S]*?<\/table>/i);
if (!tableMatch) throw new Error('No wikitable found on the polling page');
const table = tableMatch[0];

const rowHtmls = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

// Locate the header row and compute each party's absolute column index,
// expanding colspans so indices line up with data-row cells.
let columns = null;
for (const rowHtml of rowHtmls) {
  const ths = cellsOf(rowHtml, 'th');
  if (ths.length < 5) continue;
  const expanded = [];
  for (const cell of ths) for (let i = 0; i < cell.colspan; i += 1) expanded.push(cell.text);
  const mapped = {};
  for (const party of PARTIES) {
    const idx = expanded.findIndex(text => party.patterns.some(p => p.test(text)));
    if (idx >= 0) mapped[party.key] = idx;
  }
  if (Object.keys(mapped).length >= 4) {
    columns = { mapped, headerCount: expanded.length };
    break;
  }
}
if (!columns) throw new Error('Could not locate the party header row');

const polls = [];
for (const rowHtml of rowHtmls) {
  const tds = cellsOf(rowHtml, 'td');
  if (tds.length < 5) continue; // header, event or spacer rows
  const ths = cellsOf(rowHtml, 'th');
  // Data rows on this page usually lead with dates (th or first td) then pollster.
  const leading = ths.map(c => c.text);
  const expanded = [];
  for (const cell of tds) for (let i = 0; i < cell.colspan; i += 1) expanded.push(cell.text);
  const all = [...leading, ...expanded];

  const values = {};
  let plausible = 0;
  for (const party of PARTIES) {
    const idx = columns.mapped[party.key];
    if (idx === undefined) continue;
    const raw = all[idx] ?? '';
    const num = parseFloat(raw.replace('%', ''));
    if (Number.isFinite(num) && num >= 0 && num <= 70) {
      values[party.key] = num;
      plausible += 1;
    }
  }
  if (plausible < 4) continue;

  polls.push({
    dates: all[0] ?? '',
    pollster: all[1] ?? '',
    ...values,
  });
  if (polls.length >= 15) break;
}

if (polls.length < 5) {
  throw new Error(`Only ${polls.length} polls parsed — page layout likely changed, refusing to write`);
}

const window = polls.slice(0, 10);
const average = {};
for (const party of PARTIES) {
  const vals = window.map(p => p[party.key]).filter(v => Number.isFinite(v));
  if (vals.length >= 3) {
    average[party.key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
}

const out = {
  updatedAt: new Date().toISOString(),
  source: `Wikipedia: Opinion polling for the next United Kingdom general election (CC BY-SA; aggregates published polls from all pollsters)`,
  ge2024: GE2024,
  averageWindow: window.length,
  average,
  polls: window,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`wrote ${OUT_PATH}: ${polls.length} polls parsed, ${window.length}-poll average:`, average);
