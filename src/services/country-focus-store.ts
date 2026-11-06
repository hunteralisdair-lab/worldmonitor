import { CURATED_COUNTRIES } from '@/config/countries';
import { toIso2 } from '@/utils/country-codes';
import { tokenizeForMatch, matchesAnyKeyword } from '@/utils/keyword-match';

/**
 * Country focus (politics variant).
 *
 * The map is the navigator: clicking a country re-focuses the whole page —
 * the front-page lead re-selects and the news panels stable-re-rank
 * matching stories first. LENS semantics, same contract as the perspective
 * lens: focus re-ranks, it never hides a story. The default focus is the
 * United Kingdom; "Back to United Kingdom" restores it.
 *
 * Matching is text-based (news items carry no country field): a focused
 * country's terms come from its CURATED_COUNTRIES entry (scoringKeywords +
 * searchAliases + name) or, for non-curated countries, just the clicked
 * name. v1 is simple matching — a headline mentioning two countries ranks
 * into both. If that proves noisy, the upgrade path is first-mention-wins
 * disambiguation (see CountryIntelManager.firstMentionPosition).
 */
export interface CountryFocus {
  /** ISO-3166 alpha-2, uppercase. */
  code: string;
  name: string;
}

export const DEFAULT_COUNTRY_FOCUS: CountryFocus = { code: 'GB', name: 'United Kingdom' };

export const COUNTRY_FOCUS_STORAGE_KEY = 'worldmonitor-country-focus';

export function normalizeCountryFocus(value: unknown): CountryFocus {
  if (typeof value !== 'object' || value === null) return DEFAULT_COUNTRY_FOCUS;
  const { code, name } = value as { code?: unknown; name?: unknown };
  if (typeof code !== 'string' || typeof name !== 'string') return DEFAULT_COUNTRY_FOCUS;
  const iso2 = toIso2(code);
  if (!iso2 || name.trim().length === 0) return DEFAULT_COUNTRY_FOCUS;
  return { code: iso2, name: name.trim() };
}

function loadStoredFocus(): CountryFocus {
  try {
    const raw = localStorage.getItem(COUNTRY_FOCUS_STORAGE_KEY);
    return raw ? normalizeCountryFocus(JSON.parse(raw)) : DEFAULT_COUNTRY_FOCUS;
  } catch {
    // Storage unavailable (private mode, node test runtime) or bad JSON.
    return DEFAULT_COUNTRY_FOCUS;
  }
}

type FocusListener = (focus: CountryFocus) => void;

let currentFocus: CountryFocus = loadStoredFocus();
let cachedMatcher: { code: string; match: (title: string) => boolean } | null = null;
const listeners = new Set<FocusListener>();

export function getCountryFocus(): CountryFocus {
  return currentFocus;
}

export function isDefaultFocus(focus: CountryFocus = currentFocus): boolean {
  return focus.code === DEFAULT_COUNTRY_FOCUS.code;
}

export function setCountryFocus(focus: CountryFocus): void {
  const next = normalizeCountryFocus(focus);
  if (next.code === currentFocus.code && next.name === currentFocus.name) return;
  currentFocus = next;
  cachedMatcher = null;
  try {
    localStorage.setItem(COUNTRY_FOCUS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private mode. Keep the live focus.
  }
  for (const listener of listeners) listener(next);
}

export function subscribeCountryFocus(listener: FocusListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * The focused country's match terms, lowercased and deduped. Curated
 * countries get their full keyword/alias sets ('uk ' trailing-space alias
 * trims to 'uk' — matchKeyword is word-tokenized, so a 2-char term stays an
 * exact-word match with no suffix expansion); non-curated countries match
 * on the clicked name alone.
 */
export function getFocusTerms(focus: CountryFocus = currentFocus): string[] {
  const curated = CURATED_COUNTRIES[focus.code];
  const raw = [
    ...(curated?.scoringKeywords ?? []),
    ...(curated?.searchAliases ?? []),
    curated?.name ?? '',
    focus.name,
  ];
  const terms = new Set<string>();
  for (const term of raw) {
    const trimmed = term.trim().toLowerCase();
    if (trimmed.length >= 2) terms.add(trimmed);
  }
  return [...terms];
}

/** Cached title matcher for the CURRENT focus; invalidated on focus change. */
export function getFocusMatcher(): (title: string) => boolean {
  if (cachedMatcher?.code === currentFocus.code) return cachedMatcher.match;
  const terms = getFocusTerms(currentFocus);
  const match = (title: string): boolean =>
    matchesAnyKeyword(tokenizeForMatch(title), terms);
  cachedMatcher = { code: currentFocus.code, match };
  return match;
}
