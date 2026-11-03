import type { SourceBias } from '@/types';

/**
 * Editorial perspective ratings for politics-variant news sources.
 *
 * These are OUR OWN editorial judgments on a 5-point scale
 * (left / center-left / center / center-right / right) — deliberately not
 * copied from AllSides, MBFC or any other third-party dataset. They rate the
 * overall editorial lean of the OUTLET, not individual stories. Sources
 * without an entry render as unrated (hollow dot) and never participate in
 * perspective re-ranking.
 *
 * Keys are matched against the source name shown on news items (feed `name`
 * fields in src/config/feeds.ts, or digest source names), normalized by
 * `normalizeSourceName()` below: lowercased, trimmed, aggregator suffixes
 * ("… - Google News") stripped. Section feeds of one outlet (e.g. "Guardian
 * Politics" / "Guardian Environment") each get an entry plus a bare-outlet
 * alias so digest items that carry only the masthead name still resolve.
 */
const SOURCE_BIAS: Record<string, SourceBias> = {
  // --- Wires & global broadcasters: center ---
  'bbc world': 'center',
  'bbc politics': 'center',
  'bbc business': 'center',
  'bbc health': 'center',
  'bbc education': 'center',
  'bbc science & environment': 'center',
  'bbc middle east': 'center',
  'bbc africa': 'center',
  'bbc news': 'center',
  'bbc': 'center',
  'reuters world': 'center',
  'reuters us': 'center',
  'reuters business': 'center',
  'reuters': 'center',
  'ap news': 'center',
  'associated press': 'center',
  'sky news politics': 'center',
  'sky news': 'center',
  'politico europe': 'center',
  'politico': 'center',
  'the hill': 'center',
  'axios': 'center',
  'abc news': 'center',
  'cbs news': 'center',
  'pbs newshour': 'center',
  'wall street journal': 'center',

  // --- Finance / economics desks: center ---
  'cnbc economy': 'center',
  'cnbc': 'center',
  'ft economics': 'center',
  'financial times': 'center',
  'ft': 'center',
  'marketwatch': 'center',

  // --- Center-left ---
  'guardian world': 'center-left',
  'guardian politics': 'center-left',
  'guardian society': 'center-left',
  'guardian education': 'center-left',
  'guardian environment': 'center-left',
  'guardian economics': 'center-left',
  'guardian me': 'center-left',
  'the guardian': 'center-left',
  'guardian': 'center-left',
  'independent politics': 'center-left',
  'independent uk': 'center-left',
  'the independent': 'center-left',
  'independent': 'center-left',
  'npr news': 'center-left',
  'npr politics': 'center-left',
  'npr': 'center-left',
  'al jazeera': 'center-left',
  'cnn world': 'center-left',
  'cnn': 'center-left',
  'nbc news': 'center-left',

  // --- Left ---
  'new statesman': 'left',
  'new yorker': 'left',
  'the new yorker': 'left',
  'novara media': 'left',
  'novara': 'left',

  // --- Center-right ---
  'the times politics': 'center-right',
  'the times': 'center-right',
  'telegraph politics': 'center-right',
  'the telegraph': 'center-right',
  'telegraph': 'center-right',
  'economist': 'center-right',
  'the economist': 'center-right',

  // --- Right ---
  'daily mail news': 'right',
  'daily mail': 'right',
  'spectator politics': 'right',
  'the spectator': 'right',
  'spectator': 'right',
  'gb news': 'right',
  'fox news': 'right',
  'trump - truth social': 'right',
};

/**
 * Outlet-family fallback: a section feed we didn't enumerate ("Guardian
 * Americas", "BBC Latin America", "Reuters LatAm", "CNBC Markets") still
 * carries its masthead's rating. Checked only after the exact map misses.
 * "The Times" is deliberately NOT here: "The Times of Central Asia",
 * "Moscow Times" and "Military Times" are unrelated outlets, so The Times
 * resolves through its exact entries alone.
 */
const OUTLET_PREFIX_BIAS: ReadonlyArray<readonly [string, SourceBias]> = [
  ['bbc ', 'center'],
  ['reuters ', 'center'],
  ['sky news', 'center'],
  ['politico', 'center'],
  ['cnbc', 'center'],
  ['ft ', 'center'],
  ['marketwatch', 'center'],
  ['guardian ', 'center-left'],
  ['the guardian', 'center-left'],
  ['independent ', 'center-left'],
  ['npr ', 'center-left'],
  ['cnn ', 'center-left'],
  ['telegraph ', 'center-right'],
  ['spectator', 'right'],
  ['daily mail', 'right'],
  ['fox news', 'right'],
];

/**
 * Normalize a source name as it appears on a news item into a lookup key:
 * lowercase, trimmed, with aggregator suffixes ("Outlet - Google News",
 * "Outlet | Google News") stripped.
 */
function normalizeSourceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-–—|]\s*google news\s*$/, '')
    .trim();
}

/**
 * Look up the 5-point bias rating for a source name (case-insensitive).
 * Returns undefined for unrated sources — callers render those as unrated
 * and exclude them from perspective re-ranking.
 */
export function getSourceBias(sourceName: string): SourceBias | undefined {
  if (!sourceName) return undefined;
  const normalized = normalizeSourceName(sourceName);
  const exact = SOURCE_BIAS[normalized];
  if (exact) return exact;
  for (const [prefix, bias] of OUTLET_PREFIX_BIAS) {
    if (normalized.startsWith(prefix)) return bias;
  }
  return undefined;
}
