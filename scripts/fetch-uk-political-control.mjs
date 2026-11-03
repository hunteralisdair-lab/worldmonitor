#!/usr/bin/env node
/**
 * Build public/data/uk-political-control.json: Westminster constituency
 * boundaries colored by CURRENT party control.
 *
 * Sources (both open, no keys):
 * - Boundaries: ONS Open Geography Portal, Westminster Parliamentary
 *   Constituencies (July 2024) UK BUC (ultra-generalised 500m), via the
 *   ArcGIS REST API with geometryPrecision to keep the payload small.
 *   Licence: Open Government Licence v3.0 (attribution in output meta).
 * - Current party per constituency: UK Parliament Members API
 *   (members-api.parliament.uk). "Current" means it reflects defections
 *   and by-elections, not the general-election result.
 *
 * Join is by normalized constituency name (both sides use the official
 * July-2024 names); the script fails loudly if any constituency cannot
 * be matched so stale output is never written silently.
 *
 * Usage: node scripts/fetch-uk-political-control.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = resolve(ROOT, 'public/data/uk-political-control.json');

const BOUNDARIES_BASE =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/'
  + 'Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BUC/FeatureServer/0/query';
const MEMBERS_BASE = 'https://members-api.parliament.uk/api/Location/Constituency/Search';

const UA = 'worldmonitor-politics-fork/1.0 (build script; one-off dataset fetch)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchBoundaries() {
  const features = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'PCON24CD,PCON24NM',
      outSR: '4326',
      f: 'geojson',
      geometryPrecision: '3', // ~110 m — plenty for BUC (already generalised to 500 m)
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      orderByFields: 'PCON24CD',
    });
    const page = await fetchJson(`${BOUNDARIES_BASE}?${params}`);
    const got = page.features ?? [];
    features.push(...got);
    process.stdout.write(`boundaries: ${features.length}\r`);
    if (got.length < pageSize) break;
  }
  console.log(`\nboundaries fetched: ${features.length}`);
  return features;
}

async function fetchCurrentMembers() {
  const byName = new Map();
  const take = 20;
  for (let skip = 0; ; skip += take) {
    const page = await fetchJson(`${MEMBERS_BASE}?skip=${skip}&take=${take}`);
    const items = page.items ?? [];
    for (const item of items) {
      const c = item.value;
      const member = c?.currentRepresentation?.member?.value;
      if (!c?.name) continue;
      byName.set(normalizeName(c.name), {
        constituency: c.name,
        mp: member?.nameDisplayAs ?? null,
        party: member?.latestParty?.name ?? 'Vacant',
        partyAbbr: member?.latestParty?.abbreviation ?? null,
        // Parliament's own party colour — used as the fallback fill when a
        // party is missing from the client-side palette.
        partyColor: member?.latestParty?.backgroundColour
          ? `#${member.latestParty.backgroundColour}`
          : null,
      });
    }
    process.stdout.write(`members: ${byName.size}\r`);
    if (items.length < take) break;
  }
  console.log(`\nconstituencies with current representation: ${byName.size}`);
  return byName;
}

const [boundaries, members] = await Promise.all([fetchBoundaries(), fetchCurrentMembers()]);

const unmatched = [];
const features = boundaries.map((f) => {
  const code = f.properties?.PCON24CD ?? '';
  const name = f.properties?.PCON24NM ?? '';
  const rep = members.get(normalizeName(name));
  if (!rep) unmatched.push(name);
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      code,
      name,
      party: rep?.party ?? 'Unknown',
      partyAbbr: rep?.partyAbbr ?? null,
      mp: rep?.mp ?? null,
      partyColor: rep?.partyColor ?? null,
    },
  };
});

if (unmatched.length > 0) {
  console.error(`UNMATCHED constituencies (${unmatched.length}):\n  ${unmatched.join('\n  ')}`);
  process.exit(1);
}

const collection = {
  type: 'FeatureCollection',
  meta: {
    generatedAt: new Date().toISOString(),
    boundaries:
      'Westminster Parliamentary Constituencies (July 2024) Boundaries UK BUC. '
      + 'Source: Office for National Statistics licensed under the Open Government Licence v.3.0. '
      + 'Contains OS data (C) Crown copyright and database right 2024.',
    control: 'Current MP party per constituency from the UK Parliament Members API (members-api.parliament.uk).',
  },
  features,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
const json = JSON.stringify(collection);
writeFileSync(OUT_PATH, json);

const parties = new Map();
for (const f of features) parties.set(f.properties.party, (parties.get(f.properties.party) ?? 0) + 1);
console.log(`wrote ${OUT_PATH} (${(json.length / 1024 / 1024).toFixed(2)} MB, ${features.length} constituencies)`);
console.log('seats by party:', Object.fromEntries([...parties.entries()].sort((a, b) => b[1] - a[1])));
