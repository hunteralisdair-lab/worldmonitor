import { PANEL_CATEGORY_MAP, getVariantPanelCategories, getProPanelKeys } from '@/config/panels';
import { SITE_VARIANT } from '@/config';
import { t } from '@/services/i18n';
import type { PanelConfig } from '@/types';

// Synthetic chip key — must not collide with PANEL_CATEGORY_MAP keys.
const PRO_CATEGORY = '__pro__';

/**
 * Desktop vertical category nav docked left of the dashboard (politics
 * variant). Forked from MobilePanelNav rather than generalized so the
 * mobile bar stays untouched: same filtering contract — selecting a
 * category hides every grid panel outside it via `.mobile-cat-hidden`,
 * never touching Panel.toggle()'s `.hidden`, so the two compose.
 *
 * The desktop hiding rule is scoped by the `side-nav-scope` class this
 * component stamps on the grid, so a lingering `.mobile-cat-hidden` from
 * a phone rotation keeps its mobile-only behavior in other variants.
 */
export class SidePanelNav {
  private element: HTMLElement;
  private activeCategory = 'all';
  private proPanelKeys: Set<string> = new Set();
  private getPanelSettings: () => Record<string, PanelConfig>;
  // Consumers that navigate to a panel (e.g. breaking-alert click) dispatch
  // this so an active filter can't swallow their scrollIntoView.
  private boundRevealPanel = (e: Event): void => {
    const key = (e as CustomEvent<{ panelId?: string }>).detail?.panelId;
    if (!key) return;
    const allowed = this.allowedKeysForActiveCategory();
    if (allowed && !allowed.has(key)) this.select('all');
  };

  constructor(getPanelSettings: () => Record<string, PanelConfig>) {
    this.getPanelSettings = getPanelSettings;
    this.element = document.createElement('nav');
    this.element.className = 'side-panel-nav';
    this.element.setAttribute('aria-label', t('components.mobileNav.panelCategories'));
    this.element.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-category]');
      if (chip?.dataset.category) this.select(chip.dataset.category);
    });
    window.addEventListener('wm:reveal-panel', this.boundRevealPanel);
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  /** Rebuild chips from current panel settings, then re-apply the filter. */
  public refresh(): void {
    const settings = this.getPanelSettings();
    this.proPanelKeys = new Set(getProPanelKeys(settings, SITE_VARIANT));
    const categories = [
      { key: 'all', label: t('header.sourceRegionAll') },
      ...(this.proPanelKeys.size > 0
        ? [{ key: PRO_CATEGORY, label: `⚡ ${t('widgets.proBadge')}` }]
        : []),
      ...getVariantPanelCategories(settings, SITE_VARIANT)
        .map(({ key, labelKey }) => ({ key, label: t(labelKey) })),
    ];
    if (!categories.some((c) => c.key === this.activeCategory)) {
      this.activeCategory = 'all';
    }
    this.element.replaceChildren(...categories.map(({ key, label }) => {
      const chip = document.createElement('button');
      chip.className = key === PRO_CATEGORY
        ? 'side-panel-nav-chip side-panel-nav-chip-pro'
        : 'side-panel-nav-chip';
      chip.dataset.category = key;
      chip.textContent = label;
      this.setChipState(chip, key === this.activeCategory);
      return chip;
    }));
    this.applyFilter();
  }

  public destroy(): void {
    window.removeEventListener('wm:reveal-panel', this.boundRevealPanel);
    document.getElementById('panelsGrid')?.classList.remove('side-nav-scope');
    this.element.remove();
  }

  /** Stamp the active filter onto a panel mounted AFTER refresh() ran —
   *  lazy-loaded panels would otherwise leak into a filtered view. */
  public applyToNewPanel(el: HTMLElement): void {
    const allowed = this.allowedKeysForActiveCategory();
    const key = el.dataset.panel ?? '';
    el.classList.toggle('mobile-cat-hidden', !!allowed && !allowed.has(key));
  }

  private setChipState(chip: HTMLElement, active: boolean): void {
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  }

  private select(key: string): void {
    if (key === this.activeCategory) return;
    this.activeCategory = key;
    this.element.querySelectorAll<HTMLElement>('.side-panel-nav-chip').forEach((chip) => {
      this.setChipState(chip, chip.dataset.category === key);
    });
    this.applyFilter();
    this.scrollToPanels();
  }

  private allowedKeysForActiveCategory(): Set<string> | null {
    if (this.activeCategory === 'all') return null;
    if (this.activeCategory === PRO_CATEGORY) return this.proPanelKeys;
    const def = PANEL_CATEGORY_MAP[this.activeCategory];
    return def ? new Set(def.panelKeys) : null;
  }

  private applyFilter(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const allowed = this.allowedKeysForActiveCategory();
    grid.classList.add('side-nav-scope');
    grid.classList.toggle('mobile-cat-filtered', !!allowed);
    grid.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => {
      const panelKey = el.dataset.panel ?? '';
      el.classList.toggle('mobile-cat-hidden', !!allowed && !allowed.has(panelKey));
    });
    // Charts rendered while display:none come back at zero width — same
    // recalc nudge the mobile map toggle uses.
    window.dispatchEvent(new Event('resize'));
  }

  /** Bring the panels grid into view after a filter change: unlike the
   *  mobile bar, the nav is docked outside the scroll container, so target
   *  `.main-content` (the dashboard scrollport) explicitly. */
  private scrollToPanels(): void {
    const scroller = document.querySelector<HTMLElement>('.main-content');
    const grid = document.getElementById('panelsGrid');
    if (!scroller || !grid) return;
    const gridTop = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (gridTop < 0 || gridTop > scroller.clientHeight * 0.6) {
      scroller.scrollTo({ top: scroller.scrollTop + gridTop });
    }
  }
}
