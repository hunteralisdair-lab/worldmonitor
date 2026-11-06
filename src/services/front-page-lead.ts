import type { NewsItem } from '@/types';
import { tokenizeForMatch, matchesAnyKeyword } from '@/utils/keyword-match';

/**
 * Front-page lead selection (politics variant).
 *
 * Picks the day's lead stories ACROSS news categories — the one thing a
 * single enlarged panel cannot do. Ranking rides the server-computed
 * importanceScore that every digest item already carries (recency breaks
 * ties), so selection adds no fetches and no worker work. Three dedupe
 * rules keep the four slots genuinely distinct: one story per category,
 * one per publisher, and no near-duplicate headlines (the same wire story
 * arrives under several mastheads with lightly edited titles).
 */
export interface LeadStory {
  item: NewsItem;
  category: string;
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

/** Share of the smaller title's tokens that also appear in the other title. */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const token of small) {
    if (large.has(token)) shared += 1;
  }
  return shared / small.size;
}

const NEAR_DUPLICATE_OVERLAP = 0.5;

export interface SelectLeadStoriesOptions {
  /**
   * Country-focus terms (lowercased): candidates whose titles match are
   * stable-partitioned FIRST, so a focused country's stories fill the slots
   * before global ones backfill. Selection rules (one per category, one per
   * publisher, no near-duplicates) apply across the whole ordering.
   */
  focusTerms?: string[];
  maxStories?: number;
}

export function selectLeadStories(
  newsByCategory: Record<string, NewsItem[]>,
  options: SelectLeadStoriesOptions = {},
): LeadStory[] {
  const maxStories = options.maxStories ?? 4;
  const candidates: LeadStory[] = [];
  for (const [category, items] of Object.entries(newsByCategory)) {
    for (const item of items) {
      if (typeof item.title === 'string' && item.title.trim().length > 0 && item.link) {
        candidates.push({ item, category });
      }
    }
  }

  candidates.sort((a, b) => {
    const sa = a.item.importanceScore ?? 0;
    const sb = b.item.importanceScore ?? 0;
    if (sb !== sa) return sb - sa;
    return new Date(b.item.pubDate).getTime() - new Date(a.item.pubDate).getTime();
  });

  const focusTerms = options.focusTerms ?? [];
  if (focusTerms.length > 0) {
    const matching: LeadStory[] = [];
    const rest: LeadStory[] = [];
    for (const candidate of candidates) {
      (matchesAnyKeyword(tokenizeForMatch(candidate.item.title), focusTerms) ? matching : rest)
        .push(candidate);
    }
    candidates.length = 0;
    candidates.push(...matching, ...rest);
  }

  const chosen: LeadStory[] = [];
  const usedCategories = new Set<string>();
  const usedSources = new Set<string>();
  const chosenTitleTokens: Array<Set<string>> = [];

  for (const candidate of candidates) {
    if (chosen.length >= maxStories) break;
    if (usedCategories.has(candidate.category)) continue;
    const sourceKey = candidate.item.source.trim().toLowerCase();
    if (usedSources.has(sourceKey)) continue;
    const tokens = titleTokens(candidate.item.title);
    if (chosenTitleTokens.some((prev) => tokenOverlap(prev, tokens) >= NEAR_DUPLICATE_OVERLAP)) continue;

    chosen.push(candidate);
    usedCategories.add(candidate.category);
    usedSources.add(sourceKey);
    chosenTitleTokens.push(tokens);
  }

  return chosen;
}
