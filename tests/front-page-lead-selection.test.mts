import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { selectLeadStories } from '../src/services/front-page-lead.ts';
import type { NewsItem } from '../src/types/index.ts';

// The politics front-page lead zone (src/components/FrontPageLead.ts) shows
// the day's top stories ACROSS news categories. Selection is a pure function
// over ctx.newsByCategory: importanceScore ranks (recency breaks ties), and
// three dedupe rules keep the slots distinct — one story per category, one
// per publisher, no near-duplicate headlines.

let linkCounter = 0;
function item(overrides: Partial<NewsItem> & { title: string }): NewsItem {
  linkCounter += 1;
  return {
    source: 'Test Source',
    link: `https://example.com/story-${linkCounter}`,
    pubDate: new Date('2026-11-06T10:00:00Z'),
    ...overrides,
  } as NewsItem;
}

describe('selectLeadStories', () => {
  it('ranks by importanceScore across categories and caps at the slot count', () => {
    const picked = selectLeadStories({
      politics: [
        item({ title: 'Summit collapses over treaty terms', importanceScore: 90 }),
        item({ title: 'Minor ministry reshuffle announced', importanceScore: 10 }),
      ],
      'uk-politics': [item({ title: 'Budget vote splits governing party', importanceScore: 80, source: 'Guardian Politics' })],
      'econ-news': [item({ title: 'Central bank holds rates steady', importanceScore: 70, source: 'FT Economics' })],
      europe: [item({ title: 'Coalition talks stall in Berlin', importanceScore: 60, source: 'DW News' })],
      us: [item({ title: 'Senate advances spending bill', importanceScore: 50, source: 'NPR Politics' })],
    });

    assert.equal(picked.length, 4);
    assert.deepEqual(
      picked.map((p) => p.category),
      ['politics', 'uk-politics', 'econ-news', 'europe'],
    );
  });

  it('takes at most one story per category', () => {
    const picked = selectLeadStories({
      politics: [
        item({ title: 'Alpha event shakes markets worldwide', importanceScore: 90 }),
        item({ title: 'Beta development in trade dispute', importanceScore: 85, source: 'Other Source' }),
      ],
      us: [item({ title: 'Gamma ruling reshapes election law', importanceScore: 40, source: 'PBS NewsHour' })],
    });

    assert.deepEqual(picked.map((p) => p.category), ['politics', 'us']);
  });

  it('takes at most one story per publisher', () => {
    const picked = selectLeadStories({
      politics: [item({ title: 'Alpha event shakes markets worldwide', importanceScore: 90, source: 'BBC World' })],
      europe: [item({ title: 'Beta development in trade dispute', importanceScore: 85, source: 'bbc world' })],
      us: [item({ title: 'Gamma ruling reshapes election law', importanceScore: 40, source: 'CBS News' })],
    });

    assert.deepEqual(picked.map((p) => p.item.source), ['BBC World', 'CBS News']);
  });

  it('drops near-duplicate headlines (the same wire story under two mastheads)', () => {
    const picked = selectLeadStories({
      politics: [item({ title: 'President signs sweeping sanctions package against regime', importanceScore: 90, source: 'Reuters World' })],
      us: [item({ title: 'President signs sweeping sanctions package targeting regime officials', importanceScore: 85, source: 'AP News' })],
      europe: [item({ title: 'Parliament debates fisheries accord', importanceScore: 40, source: 'EuroNews' })],
    });

    assert.deepEqual(picked.map((p) => p.category), ['politics', 'europe']);
  });

  it('falls back to recency when importanceScore is missing', () => {
    const picked = selectLeadStories({
      politics: [item({ title: 'Delegations resume border negotiations', pubDate: new Date('2026-11-06T08:00:00Z') })],
      us: [item({ title: 'Committee schedules oversight hearings', pubDate: new Date('2026-11-06T11:00:00Z'), source: 'NBC News' })],
    });

    assert.deepEqual(picked.map((p) => p.category), ['us', 'politics']);
  });

  it('skips items without a usable title or link and survives empty input', () => {
    assert.deepEqual(selectLeadStories({}), []);
    const picked = selectLeadStories({
      politics: [
        item({ title: '   ' }),
        { ...item({ title: 'Real headline about summit' }), link: '' } as NewsItem,
        item({ title: 'Usable headline on negotiations', source: 'Sky News' }),
      ],
    });
    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.item.title, 'Usable headline on negotiations');
  });
});
