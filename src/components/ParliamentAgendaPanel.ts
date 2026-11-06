import { Panel } from './Panel';
import { safeHtml, joinSafeHtml, safeUrlAttr, type SafeHtml } from '@/utils/sanitize';

interface AgendaEvent {
  id: number;
  date: string;       // YYYY-MM-DD
  startTime: string;  // "14:30" or ''
  house: string;      // Commons | Lords
  type: string;       // Main Chamber | Westminster Hall | ...
  category: string;   // Oral questions | Debate | Legislation | ...
  title: string;
  billLink: string | null;
}

const REFRESH_MS = 60 * 60 * 1000;
const DAYS_AHEAD = 7;
const MAX_PER_DAY = 8;
// Chamber business only — committee sittings would triple the list and the
// user asked "what is being debated", not the full committee schedule.
const INCLUDED_TYPES = new Set(['Main Chamber', 'Westminster Hall']);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = isoDate(new Date());
  if (iso === today) return 'Today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Parliament This Week (politics variant): chamber business for the next
 * seven days from the UK Parliament What's On API (free, no key, CORS-open),
 * grouped into a date timeline — Commons and Lords, oral questions, debates
 * and legislation, with bill links where the event is attached to a bill.
 */
export class ParliamentAgendaPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'parliament-agenda',
      title: 'Parliament This Week',
      infoTooltip: 'Upcoming Commons and Lords chamber business (oral questions, debates, legislation) from the official Parliament What’s On calendar, grouped by sitting day.',
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
      const start = new Date();
      const end = new Date(Date.now() + DAYS_AHEAD * 86_400_000);
      const url = 'https://whatson-api.parliament.uk/calendar/events/list.json'
        + `?queryParameters.startDate=${isoDate(start)}&queryParameters.endDate=${isoDate(end)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as Array<{
        Id?: number; StartDate?: string; StartTime?: string; CancelledDate?: string | null;
        Type?: string; House?: string; Category?: string; Description?: string;
        BillPageLink?: string | null;
      }>;
      if (!this.element?.isConnected) return;

      const events: AgendaEvent[] = (Array.isArray(body) ? body : [])
        .filter(e => !e.CancelledDate && INCLUDED_TYPES.has(e.Type ?? '') && (e.Description ?? '').trim())
        .map(e => ({
          id: e.Id ?? 0,
          date: (e.StartDate ?? '').slice(0, 10),
          startTime: e.StartTime ?? '',
          house: e.House ?? '',
          type: e.Type ?? '',
          category: e.Category ?? '',
          title: (e.Description ?? '').trim(),
          billLink: e.BillPageLink || null,
        }))
        .filter(e => e.date);
      this.renderTimeline(events);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError('Parliamentary calendar unavailable', () => void this.fetchData());
    }
  }

  private renderTimeline(events: AgendaEvent[]): void {
    if (events.length === 0) {
      this.setSafeContent(safeHtml`<div class="agenda-empty">No chamber business scheduled in the next week &mdash; Parliament may be in recess.</div>`);
      this.setCount(0);
      return;
    }

    const byDate = new Map<string, AgendaEvent[]>();
    for (const e of events) {
      const list = byDate.get(e.date) ?? [];
      list.push(e);
      byDate.set(e.date, list);
    }

    const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
    const sections = joinSafeHtml(days.map(([date, dayEvents]): SafeHtml => {
      const sorted = dayEvents.sort((a, b) =>
        a.startTime.localeCompare(b.startTime) || a.house.localeCompare(b.house));
      const rows = joinSafeHtml(sorted.slice(0, MAX_PER_DAY).map((e): SafeHtml => {
        const inner = safeHtml`
          <span class="agenda-time">${e.startTime || '—'}</span>
          <span class="agenda-house ${e.house === 'Commons' ? 'commons' : 'lords'}">${e.house}</span>
          <span class="agenda-detail">
            <span class="agenda-title-text">${e.title}</span>
            <span class="agenda-cat">${e.category}${e.type === 'Westminster Hall' ? ' · Westminster Hall' : ''}</span>
          </span>`;
        return e.billLink
          ? safeHtml`<a class="agenda-row" href="${safeUrlAttr(e.billLink)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
          : safeHtml`<div class="agenda-row">${inner}</div>`;
      }));
      const overflow = sorted.length - MAX_PER_DAY;
      return safeHtml`
        <div class="agenda-day">
          <div class="agenda-day-header">${dayLabel(date)}</div>
          ${rows}
          ${overflow > 0 ? safeHtml`<div class="agenda-overflow">+${String(overflow)} more items</div>` : ''}
        </div>`;
    }));

    this.setSafeContent(safeHtml`<div class="parliament-agenda-panel">${sections}</div>`);
    this.setCount(events.length);
  }
}
