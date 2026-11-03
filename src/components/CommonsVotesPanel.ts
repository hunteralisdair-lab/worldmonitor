import { Panel } from './Panel';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';

interface DivisionRow {
  id: number;
  title: string;
  date: string;
  ayes: number;
  noes: number;
}

const REFRESH_MS = 30 * 60 * 1000;
const MAX_ROWS = 10;

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Commons Divisions (politics variant): the latest House of Commons votes
 * from the Commons Votes API (free, no key, CORS-open) — the daily pulse of
 * what Parliament actually decided, not just what it talked about.
 */
export class CommonsVotesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'commons-votes',
      title: 'Commons Divisions',
      infoTooltip: 'Latest House of Commons division results from the official Commons Votes API. Ayes beat Noes = motion passes.',
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
      const res = await fetch(`https://commonsvotes-api.parliament.uk/data/divisions.json/search?queryParameters.take=${MAX_ROWS}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as Array<{
        DivisionId?: number; Date?: string; Title?: string; AyeCount?: number; NoCount?: number;
      }>;
      if (!this.element?.isConnected) return;

      const rows: DivisionRow[] = (Array.isArray(body) ? body : []).map(d => ({
        id: d.DivisionId ?? 0,
        title: (d.Title ?? '').trim(),
        date: d.Date ?? '',
        ayes: d.AyeCount ?? 0,
        noes: d.NoCount ?? 0,
      })).filter(r => r.id && r.title);
      this.renderRows(rows);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError('Division data unavailable', () => void this.fetchData());
    }
  }

  private renderRows(rows: DivisionRow[]): void {
    if (rows.length === 0) {
      this.showError('No recent divisions returned', () => void this.fetchData());
      return;
    }
    const items = joinSafeHtml(rows.map((r): SafeHtml => {
      const passed = r.ayes > r.noes;
      return safeHtml`
      <a class="division-row" href="${safeUrlAttr(`https://votes.parliament.uk/Votes/Commons/Division/${r.id}`)}" target="_blank" rel="noopener noreferrer">
        <div class="division-title">${r.title}</div>
        <div class="division-meta">
          <span class="division-date">${shortDate(r.date)}</span>
          <span class="division-tally"><span class="division-ayes">${String(r.ayes)} Aye</span> &ndash; <span class="division-noes">${String(r.noes)} No</span></span>
          <span class="division-result ${passed ? 'passed' : 'rejected'}">${passed ? 'Passed' : 'Rejected'}</span>
        </div>
      </a>`;
    }));
    this.setSafeContent(safeHtml`<div class="commons-votes-panel">${items}</div>`);
    this.setCount(rows.length);
  }
}
