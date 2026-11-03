/**
 * UK party colors for the political-control map layer (politics variant).
 *
 * Keyed by the party name as the UK Parliament Members API reports it
 * (`latestParty.name`), with co-op/variant names normalized onto their
 * parent party. Hexes follow each party's customary brand color so the
 * map reads at a glance: Labour red, Conservative blue, Reform teal,
 * SNP yellow, Lib Dem amber.
 *
 * `ukPartyHex` falls back to the Parliament API's own party color (shipped
 * per-feature in the dataset) for any party missing here, then to a neutral
 * gray — new parties never render invisible.
 */

const PARTY_HEX: Record<string, string> = {
  'labour': '#e4003b',
  'conservative': '#0087dc',
  'liberal democrat': '#faa61a',
  'reform uk': '#12b6cf',
  'scottish national party': '#f5d948',
  'green party': '#02a95b',
  'plaid cymru': '#005b54',
  'sinn féin': '#326760',
  'democratic unionist party': '#d46a4c',
  'social democratic & labour party': '#2aa82c',
  'alliance': '#f6cb2f',
  'ulster unionist party': '#48a5ee',
  'traditional unionist voice': '#0c3a6a',
  'independent': '#8a8a8a',
  'speaker': '#6f6f6f',
  'vacant': '#555555',
};

function normalizeParty(party: string): string {
  const lower = party.trim().toLowerCase();
  // "Labour (Co-op)" and similar parenthetical variants map to the parent.
  if (lower.startsWith('labour')) return 'labour';
  if (lower.startsWith('conservative')) return 'conservative';
  if (lower.startsWith('independent')) return 'independent';
  return lower;
}

export function ukPartyHex(party: string, apiFallback?: string | null): string {
  return PARTY_HEX[normalizeParty(party)] ?? apiFallback ?? '#8a8a8a';
}

/** deck.gl RGBA for a party fill. */
export function ukPartyRgba(
  party: string,
  apiFallback?: string | null,
  alpha = 165,
): [number, number, number, number] {
  const hex = ukPartyHex(party, apiFallback);
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n) || hex.length !== 7) return [138, 138, 138, alpha];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
