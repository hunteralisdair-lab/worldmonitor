import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The store module loads under node:test with no localStorage — its storage
// reads are try/catch-guarded, so importing it here also proves that path.
import {
  DEFAULT_COUNTRY_FOCUS,
  normalizeCountryFocus,
  getFocusTerms,
} from '../src/services/country-focus-store.ts';
import { tokenizeForMatch, matchesAnyKeyword } from '../src/utils/keyword-match.ts';

describe('normalizeCountryFocus', () => {
  it('falls back to the UK default on junk', () => {
    for (const junk of [null, undefined, 42, 'FR', {}, { code: 'FR' }, { name: 'France' }, { code: '??', name: 'X' }, { code: 'FR', name: '   ' }]) {
      assert.deepEqual(normalizeCountryFocus(junk), DEFAULT_COUNTRY_FOCUS);
    }
  });

  it('normalizes codes through toIso2 (lowercase, aliases, iso3)', () => {
    assert.deepEqual(normalizeCountryFocus({ code: 'fr', name: 'France' }), { code: 'FR', name: 'France' });
    assert.deepEqual(normalizeCountryFocus({ code: 'uk', name: 'United Kingdom' }), { code: 'GB', name: 'United Kingdom' });
    assert.deepEqual(normalizeCountryFocus({ code: 'FRA', name: 'France' }), { code: 'FR', name: 'France' });
  });
});

describe('getFocusTerms', () => {
  it('unions curated keywords, aliases and names for GB, trimmed and deduped', () => {
    const terms = getFocusTerms(DEFAULT_COUNTRY_FOCUS);
    for (const expected of ['britain', 'uk', 'london', 'united kingdom', 'british']) {
      assert.ok(terms.includes(expected), `missing "${expected}" in ${terms.join(', ')}`);
    }
    assert.ok(!terms.some((t) => t !== t.trim() || t !== t.toLowerCase()), 'terms must be trimmed + lowercase');
    assert.equal(new Set(terms).size, terms.length, 'terms must be deduped');
  });

  it('falls back to the clicked name for a non-curated country', () => {
    const terms = getFocusTerms({ code: 'LU', name: 'Luxembourg' });
    assert.deepEqual(terms, ['luxembourg']);
  });
});

describe('focus matching via keyword-match', () => {
  const matches = (title: string, focus = DEFAULT_COUNTRY_FOCUS): boolean =>
    matchesAnyKeyword(tokenizeForMatch(title), getFocusTerms(focus));

  it('matches UK stories by alias, demonym, and multi-word phrase', () => {
    assert.ok(matches('UK inflation falls to 2.1% in October'));
    assert.ok(matches('British households brace for energy price rise'));
    assert.ok(matches('United Kingdom signs trade accord with Japan'));
    assert.ok(matches('Starmer reshuffles cabinet after by-election'));
  });

  it('does not match unrelated stories', () => {
    assert.ok(!matches('Brazil advances pension reform in lower house'));
    assert.ok(!matches('Ukraine grain corridor reopens after strikes'));
  });

  it('matches a non-curated focus by name only', () => {
    const lux = { code: 'LU', name: 'Luxembourg' };
    assert.ok(matches('Luxembourg hosts EU fiscal summit', lux));
    assert.ok(!matches('Belgium hosts EU fiscal summit', lux));
  });
});
