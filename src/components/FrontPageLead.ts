import type { ClusteredEvent } from '@/types';
import { getSourceBias } from '@/config/source-bias';
import { getPerspectiveLens, subscribePerspective, lensMatchesBias } from '@/services/perspective-store';
import { getCountryFocus, setCountryFocus, subscribeCountryFocus, isDefaultFocus, DEFAULT_COUNTRY_FOCUS } from '@/services/country-focus-store';
import type { LeadStory } from '@/services/front-page-lead';
import { t } from '@/services/i18n';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';

/** Locale key suffixes for the 5-point bias scale (keys use camelCase). */
const BIAS_LABEL_KEYS: Record<string, string> = {
  'left': 'left',
  'center-left': 'centerLeft',
  'center': 'center',
  'center-right': 'centerRight',
  'right': 'right',
};

/**
 * Politics-variant front-page lead zone (NOT a Panel — it lives above the
 * map band in <main>, outside the panels grid, and never participates in
 * tabs, drag ordering or the panel cap).
 *
 * CLS contract: the mount keeps a fixed height (main.css politics block,
 * mirrored by the boot skeleton's reserve), and every state — shimmer,
 * stories, empty — renders inside that box. Never collapse it.
 *
 * Lens contract: the perspective lens re-ranks the already-selected leads
 * matching-side-first; it never changes WHICH stories were selected, so a
 * lens switch can never hide a story.
 */
export class FrontPageLead {
  private readonly mount: HTMLElement;
  private stories: LeadStory[] = [];
  private hasData = false;
  /** link → unique publisher count, upgraded once clustering settles. */
  private publisherCounts = new Map<string, number>();
  private unsubscribePerspective: (() => void) | null = null;
  private unsubscribeFocus: (() => void) | null = null;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.mount.setAttribute('aria-label', t('components.frontPage.ariaLabel'));
    this.renderLoading();

    this.unsubscribePerspective = subscribePerspective(() => {
      if (this.hasData) this.render();
    });
    // Re-render the focus bar immediately on a focus change; the re-selected
    // stories arrive a beat later via data-loader's pushFrontPageLead.
    this.unsubscribeFocus = subscribeCountryFocus(() => {
      if (this.hasData) this.render();
      else this.renderLoading();
    });

    // Clicking a story's "More coverage" link reveals its section panel:
    // the event clears any active category filter hiding it (SidePanelNav /
    // MobilePanelNav listen), and the scroll brings it into view — the event
    // alone is invisible when no filter is active.
    this.mount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.lead-focus-back')) {
        setCountryFocus(DEFAULT_COUNTRY_FOCUS);
        return;
      }
      const btn = target.closest<HTMLButtonElement>('.lead-story-more');
      if (!btn?.dataset.category) return;
      const category = btn.dataset.category;
      window.dispatchEvent(new CustomEvent('wm:reveal-panel', { detail: { panelId: category } }));
      document.querySelector(`#panelsGrid > [data-panel="${CSS.escape(category)}"]`)
        ?.scrollIntoView({ block: 'start' });
    });
  }

  public setStories(stories: LeadStory[]): void {
    this.stories = stories;
    this.hasData = true;
    this.render();
  }

  /**
   * Corroboration arrives later than the stories themselves: digest items
   * render immediately, the cluster pass settles seconds after. Counts fail
   * closed — no cluster match means no badge (#6428 convention).
   */
  public upgradeCorroboration(clusters: ClusteredEvent[]): void {
    if (!this.hasData || this.stories.length === 0) return;
    const links = new Set(this.stories.map((s) => s.item.link));
    let changed = false;
    for (const cluster of clusters) {
      const count = cluster.uniquePublisherCount ?? 0;
      if (count < 2) continue;
      const match = links.has(cluster.primaryLink)
        ? cluster.primaryLink
        : cluster.allItems.find((i) => links.has(i.link))?.link;
      if (match && this.publisherCounts.get(match) !== count) {
        this.publisherCounts.set(match, count);
        changed = true;
      }
    }
    if (changed) this.render();
  }

  private renderBiasDot(sourceName: string): string {
    const bias = getSourceBias(sourceName);
    const label = bias
      ? t(`components.perspective.bias.${BIAS_LABEL_KEYS[bias]}`)
      : t('components.perspective.bias.unrated');
    return `<span class="bias-dot ${bias ? `bias-${bias}` : 'bias-unrated'}" title="${escapeHtml(label)}"></span>`;
  }

  /**
   * The focus bar renders in EVERY state (fixed strip — CLS contract):
   * default focus reads as the masthead; any other country shows the
   * "Viewing" state with a Back control.
   */
  private renderFocusBar(): string {
    const focus = getCountryFocus();
    if (isDefaultFocus(focus)) {
      return `
        <div class="lead-focus-bar">
          <span class="lead-focus-label">${escapeHtml(t('components.frontPage.masthead', { country: focus.name }))}</span>
        </div>
      `;
    }
    return `
      <div class="lead-focus-bar lead-focus-bar-active">
        <span class="lead-focus-label">${escapeHtml(t('components.frontPage.viewing', { country: focus.name }))}</span>
        <button class="lead-focus-back" type="button">${escapeHtml(t('components.frontPage.backTo', { country: DEFAULT_COUNTRY_FOCUS.name }))}</button>
      </div>
    `;
  }

  private renderLoading(): void {
    this.mount.setAttribute('aria-busy', 'true');
    setTrustedHtml(this.mount, trustedHtml(`
      ${this.renderFocusBar()}
      <div class="front-page-lead-inner" data-state="loading">
        ${Array.from({ length: 4 }, () => `
          <article class="lead-story lead-story-shimmer" aria-hidden="true">
            <div class="lead-shimmer-line w40"></div>
            <div class="lead-shimmer-line"></div>
            <div class="lead-shimmer-line w75"></div>
          </article>
        `).join('')}
      </div>
    `, 'front-page lead shimmer: focus bar is localized copy, escaped'));
  }

  private render(): void {
    this.mount.removeAttribute('aria-busy');

    if (this.stories.length === 0) {
      setTrustedHtml(this.mount, trustedHtml(`
        ${this.renderFocusBar()}
        <div class="front-page-lead-inner" data-state="empty">
          <p class="lead-empty">${escapeHtml(t('components.frontPage.empty'))}</p>
        </div>
      `, 'front-page lead empty state: localized copy, escaped'));
      return;
    }

    // Stable matching-side-first re-rank; 'balanced' keeps selection order.
    const lens = getPerspectiveLens();
    let ordered = this.stories;
    if (lens !== 'balanced') {
      const matching: LeadStory[] = [];
      const rest: LeadStory[] = [];
      for (const story of this.stories) {
        (lensMatchesBias(lens, getSourceBias(story.item.source)) ? matching : rest).push(story);
      }
      ordered = [...matching, ...rest];
    }

    const html = ordered.map((story, index) => {
      const { item } = story;
      const publisherCount = this.publisherCounts.get(item.link) ?? 0;
      const snippet = typeof item.snippet === 'string' && item.snippet.trim().length > 0
        ? `<p class="lead-story-snippet">${escapeHtml(item.snippet.length > 160 ? item.snippet.slice(0, 160).replace(/\s+\S*$/, '') + '…' : item.snippet)}</p>`
        : '';
      return `
        <article class="lead-story${index === 0 ? ' lead-story-first' : ''}">
          <div class="lead-story-meta">
            ${this.renderBiasDot(item.source)}<span class="lead-story-source">${escapeHtml(item.source)}</span>
            <span class="lead-story-time">${formatTime(item.pubDate)}</span>
          </div>
          <a class="lead-story-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
          ${snippet}
          <div class="lead-story-foot">
            ${publisherCount >= 2 ? `<span class="lead-story-sources">${escapeHtml(t('components.newsPanel.sources', { count: String(publisherCount) }))}</span>` : ''}
            <button class="lead-story-more" type="button" data-category="${escapeHtml(story.category)}">${escapeHtml(t('components.frontPage.more'))}</button>
          </div>
        </article>
      `;
    }).join('');

    setTrustedHtml(this.mount, trustedHtml(
      `${this.renderFocusBar()}<div class="front-page-lead-inner" data-state="ready">${html}</div>`,
      'front-page lead stories: all feed-derived fields escaped/sanitized above',
    ));
  }

  public destroy(): void {
    this.unsubscribePerspective?.();
    this.unsubscribePerspective = null;
    this.unsubscribeFocus?.();
    this.unsubscribeFocus = null;
    setTrustedHtml(this.mount, trustedHtml('', 'front-page lead teardown'));
  }
}
