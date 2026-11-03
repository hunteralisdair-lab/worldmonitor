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
 * Each constituency also carries a `towns` gazetteer: sizable settlements
 * (Natural Earth populated places, public domain) assigned by point-in-
 * polygon against the constituency boundaries, so the regional-stories
 * matcher can catch headlines that name a town rather than the seat or MP.
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

// ONS Index of Place Names (GB): built-up areas with population counts.
// 2016 vintage is fine for a gazetteer — towns don't move, and constituency
// assignment is our own point-in-polygon against the July-2024 boundaries.
const IPN_BASE =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/'
  + 'Index_of_Place_Names_in_Great_Britain_July_2016_2022/FeatureServer/0/query';
const TOWN_MIN_POPULATION = 10000;
const TOWN_MIN_NAME_LENGTH = 4; // "Ely"/"Rye" are headline-matching noise
const TOWNS_PER_CONSTITUENCY = 8;
// Towns whose names collide with world-famous places or capitalized common
// words, so even word-boundary case-sensitive matching false-positives:
// "talks with Washington", "trade Deal", "Downing Street", "for Sale",
// "in March", Boston/Perth/Hamilton abroad, "Wells Fargo".
const AMBIGUOUS_TOWN_NAMES = new Set([
  'Washington', 'Boston', 'Perth', 'Hamilton', 'Deal', 'Sale', 'March',
  'Street', 'Ware', 'Wells',
]);

/** UK settlements worth matching headlines against: name + point + population. */
async function fetchUkTowns() {
  const towns = [];
  const pageSize = 2000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      // BUA = built-up area (England/Wales): the settlement itself, not the
      // ward of the same name (wards like "Abbey" would be matching noise).
      // BUASD covers towns inside big conurbations (Oldham lives only as a
      // sub-division of the Greater Manchester BUA). Scottish settlements
      // carry populations on PAR rows instead; the population floor keeps
      // English micro-parishes out.
      where: "descnm IN ('BUA', 'BUASD', 'PAR')",
      outFields: 'place15nm,popcnt,lat,long_',
      returnGeometry: 'false',
      f: 'json',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      orderByFields: 'OBJECTID_1',
    });
    const page = await fetchJson(`${IPN_BASE}?${params}`);
    const rows = page.features ?? [];
    for (const row of rows) {
      const a = row.attributes ?? {};
      const pop = parseInt(a.popcnt, 10) || 0;
      const name = typeof a.place15nm === 'string' ? a.place15nm.replace(/\s*\(.*\)$/, '').trim() : '';
      if (pop < TOWN_MIN_POPULATION || name.length < TOWN_MIN_NAME_LENGTH) continue;
      if (typeof a.long_ !== 'number' || typeof a.lat !== 'number') continue;
      // Composite names ("Inverness and Bona") never appear verbatim in
      // headlines — emit the component settlements instead.
      const parts = / and |\s&\s/.test(name) ? name.split(/ and |\s&\s/) : [name];
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length < TOWN_MIN_NAME_LENGTH || AMBIGUOUS_TOWN_NAMES.has(trimmed)) continue;
        towns.push({ name: trimmed, lon: a.long_, lat: a.lat, pop });
      }
    }
    process.stdout.write(`places scanned: ${offset + rows.length}\r`);
    if (rows.length < pageSize) break;
  }
  console.log(`\ntowns (BUA, pop >= ${TOWN_MIN_POPULATION}): ${towns.length}`);
  return towns;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Outer rings only — constituency holes are negligible at BUC resolution. */
function featureContains(feature, lon, lat) {
  const geom = feature.geometry;
  if (!geom) return false;
  const polygons = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (outer && pointInRing(lon, lat, outer)) return true;
  }
  return false;
}

function featureBbox(feature) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  const geom = feature.geometry;
  const polygons = geom?.type === 'Polygon' ? [geom.coordinates]
    : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }
  return { west, south, east, north };
}

/** code -> town names (population-descending, capped). */
function assignTownsToConstituencies(boundaries, towns) {
  const bboxes = boundaries.map(featureBbox);
  const byCode = new Map();
  let assigned = 0;
  const add = (code, name) => {
    const list = byCode.get(code) ?? [];
    if (list.length < TOWNS_PER_CONSTITUENCY && !list.includes(name)) {
      list.push(name);
      byCode.set(code, list);
      assigned += 1;
    }
  };
  for (const town of towns.sort((a, b) => b.pop - a.pop)) {
    // Name pass first: "Milton Keynes" belongs to Milton Keynes North AND
    // Central even though its single BUA centroid falls in one (or, for
    // sprawling areas, drifts into a neighbour). Word-boundary match so
    // "Ely" never claims "Elysium".
    const townRe = new RegExp(`\\b${town.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    let namedHit = false;
    for (const feature of boundaries) {
      const constituencyName = feature.properties?.PCON24NM ?? '';
      if (townRe.test(constituencyName)) {
        add(feature.properties?.PCON24CD ?? '', town.name);
        namedHit = true;
      }
    }
    if (namedHit) continue;

    for (let i = 0; i < boundaries.length; i += 1) {
      const box = bboxes[i];
      if (town.lon < box.west || town.lon > box.east || town.lat < box.south || town.lat > box.north) continue;
      if (!featureContains(boundaries[i], town.lon, town.lat)) continue;
      add(boundaries[i].properties?.PCON24CD ?? '', town.name);
      break;
    }
  }
  console.log(`towns assigned to constituencies: ${assigned}`);
  return byCode;
}

const [boundaries, members, ukTowns] = await Promise.all([
  fetchBoundaries(),
  fetchCurrentMembers(),
  fetchUkTowns(),
]);
const townsByCode = assignTownsToConstituencies(boundaries, ukTowns);

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
      towns: townsByCode.get(code) ?? [],
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
    towns: 'Settlement gazetteer from the ONS Index of Place Names in Great Britain (built-up areas, OGL v3), assigned by point-in-polygon.',
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
