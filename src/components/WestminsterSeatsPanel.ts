import { Panel } from './Panel';
import { escapeHtml, safeHtml, joinSafeHtml, unsafeRawHtml, type SafeHtml } from '@/utils/sanitize';
import { ukPartyHex } from '@/config/uk-party-colors';

interface SeatRow {
  party: string;
  seats: number;
  hex: string;
}

const MAJORITY = 326;

/**
 * Westminster Seats (politics variant): House of Commons composition from the
 * fork's own political-control dataset, so it reflects defections and
 * by-elections the same way the map layer does. Self-driving: the dataset is
 * a static file, so one fetch per mount is enough.
 */
export class WestminsterSeatsPanel extends Panel {
  constructor() {
    super({
      id: 'westminster',
      title: 'Westminster Seats',
      infoTooltip: 'Current House of Commons composition by party, from the same constituency dataset as the map layer. Reflects defections and by-elections, not the 2024 result. Majority threshold: 326.',
    });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    try {
      const res = await fetch('/data/uk-political-control.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { features?: Array<{ properties?: { party?: string; partyColor?: string | null } }> };
      if (!this.element?.isConnected) return;
      this.renderSeats(data.features ?? []);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError('Seat data unavailable', () => void this.fetchData());
    }
  }

  private renderSeats(features: Array<{ properties?: { party?: string; partyColor?: string | null } }>): void {
    if (features.length === 0) {
      this.showError('Seat data unavailable', () => void this.fetchData());
      return;
    }

    // "Labour (Co-op)" and friends fold into their parent for the headline
    // count, matching how the Commons itself reports its composition.
    const counts = new Map<string, { seats: number; color: string | null }>();
    for (const f of features) {
      const raw = f.properties?.party ?? 'Unknown';
      const party = raw.startsWith('Labour') ? 'Labour' : raw;
      const entry = counts.get(party) ?? { seats: 0, color: f.properties?.partyColor ?? null };
      entry.seats += 1;
      counts.set(party, entry);
    }
    const rows: SeatRow[] = [...counts.entries()]
      .map(([party, { seats, color }]) => ({ party, seats, hex: ukPartyHex(party, color) }))
      .sort((a, b) => b.seats - a.seats);
    const total = features.length;

    const bar = joinSafeHtml(rows.map(r => unsafeRawHtml(
      `<span class="ws-bar-seg" style="width:${((r.seats / total) * 100).toFixed(2)}%;background:${r.hex}" title="${escapeHtml(r.party)}: ${r.seats}"></span>`,
      'widths/colors are computed numbers and ukPartyHex output; party name escaped',
    )));

    const list = joinSafeHtml(rows.map((r): SafeHtml => safeHtml`
      <div class="ws-row">
        <span class="ws-dot" style="${unsafeRawHtml(`background:${r.hex}`, 'ukPartyHex output')}"></span>
        <span class="ws-party">${r.party}</span>
        <span class="ws-seats${r.seats >= MAJORITY ? ' ws-majority' : ''}">${String(r.seats)}</span>
      </div>`));

    this.setSafeContent(safeHtml`
      <div class="westminster-panel">
        <div class="ws-bar">${bar}</div>
        <div class="ws-majority-note">${String(total)} seats &middot; majority ${String(MAJORITY)}</div>
        <div class="ws-list">${list}</div>
        <div class="ws-footnote">Current sitting MPs (UK Parliament Members API) &mdash; reflects defections and by-elections.</div>
      </div>`);
  }
}
