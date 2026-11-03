import { Panel } from './Panel';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';

interface PetitionRow {
  id: number;
  action: string;
  signatures: number;
  openedAt: number | null;
  state: string;
}

const REFRESH_MS = 15 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // "trending" = opened in the last 60 days
const MAX_ROWS = 8;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

function daysAgo(epochMs: number | null): string {
  if (!epochMs) return '';
  const days = Math.floor((Date.now() - epochMs) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d';
  return `${days}d`;
}

/**
 * Trending Petitions (politics variant): most-signed open petitions from the
 * UK Parliament petitions API (free, no key, CORS-open), preferring recently
 * opened ones so the list reads as "what the public is angry about now"
 * rather than a hall of fame of long-running mega-petitions.
 */
export class PetitionsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'petitions',
      title: 'Trending Petitions',
      infoTooltip: 'Most-signed open UK Parliament petitions, preferring those opened in the last 60 days. 10,000 signatures earns a government response; 100,000 a debate consideration.',
    });
    void this.fetchData();
    this.refreshTimer = setInterval(() => { void this.fetchData(); }, REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    super.destroy();
  }

  public async fetchData(): Promise<void> {
    try {
      const res = await fetch('https://petition.parliament.uk/petitions.json?state=open');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as {
        data?: Array<{ id: number; attributes?: { action?: string; signature_count?: number; opened_at?: string | null; state?: string } }>;
      };
      if (!this.element?.isConnected) return;

      const rows: PetitionRow[] = (body.data ?? []).map((p) => ({
        id: p.id,
        action: p.attributes?.action ?? '',
        signatures: p.attributes?.signature_count ?? 0,
        openedAt: p.attributes?.opened_at ? Date.parse(p.attributes.opened_at) : null,
        state: p.attributes?.state ?? 'open',
      })).filter(r => r.action);

      const cutoff = Date.now() - RECENT_WINDOW_MS;
      const recent = rows.filter(r => (r.openedAt ?? 0) >= cutoff).sort((a, b) => b.signatures - a.signatures);
      const picked = (recent.length >= 4 ? recent : rows.sort((a, b) => b.signatures - a.signatures)).slice(0, MAX_ROWS);
      this.renderRows(picked);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError('Petitions unavailable', () => void this.fetchData());
    }
  }

  private renderRows(rows: PetitionRow[]): void {
    if (rows.length === 0) {
      this.showError('No open petitions returned', () => void this.fetchData());
      return;
    }
    const max = rows[0]?.signatures || 1;
    const items = joinSafeHtml(rows.map((r): SafeHtml => safeHtml`
      <a class="petition-row" href="${safeUrlAttr(`https://petition.parliament.uk/petitions/${r.id}`)}" target="_blank" rel="noopener noreferrer">
        <div class="petition-action">${r.action}</div>
        <div class="petition-meta">
          <span class="petition-count">${formatCount(r.signatures)} signatures</span>
          <span class="petition-age">${daysAgo(r.openedAt)}</span>
        </div>
        <div class="petition-gauge"><span style="${safeHtml`width:${((r.signatures / max) * 100).toFixed(1)}%`}"></span></div>
      </a>`));
    this.setSafeContent(safeHtml`<div class="petitions-panel">${items}</div>`);
    this.setCount(rows.length);
  }
}
