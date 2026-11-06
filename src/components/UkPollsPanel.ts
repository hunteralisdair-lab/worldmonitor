import { Panel } from './Panel';
import { safeHtml, joinSafeHtml, unsafeRawHtml, type SafeHtml } from '@/utils/sanitize';
import { ukPartyHex } from '@/config/uk-party-colors';

interface PollsFile {
  updatedAt?: string;
  ge2024?: Record<string, number>;
  averageWindow?: number;
  average?: Record<string, number>;
  polls?: Array<Record<string, string | number>>;
}

const PARTY_META: Array<{ key: string; label: string; colorParty: string }> = [
  { key: 'lab',    label: 'Labour',       colorParty: 'Labour' },
  { key: 'con',    label: 'Conservative', colorParty: 'Conservative' },
  { key: 'reform', label: 'Reform UK',    colorParty: 'Reform UK' },
  { key: 'libdem', label: 'Lib Dem',      colorParty: 'Liberal Democrat' },
  { key: 'green',  label: 'Green',        colorParty: 'Green Party' },
  { key: 'snp',    label: 'SNP',          colorParty: 'Scottish National Party' },
];

/**
 * UK Poll Tracker (politics variant): rolling poll-of-polls built at
 * build-time by scripts/fetch-uk-polls.mjs from Wikipedia's aggregation of
 * every published Westminster voting-intention poll. Static file — re-run
 * the script to refresh; deltas are vs the 2024 general election result.
 */
export class UkPollsPanel extends Panel {
  constructor() {
    super({
      id: 'uk-polls',
      title: 'UK Poll Tracker',
      infoTooltip: 'Rolling average of the latest published Westminster voting-intention polls (all pollsters, via Wikipedia’s cited aggregation). Delta is percentage points vs the 2024 general election.',
    });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    try {
      const res = await fetch('/data/uk-polls.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as PollsFile;
      if (!this.element?.isConnected) return;
      this.renderPolls(data);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError('Poll data unavailable', () => void this.fetchData());
    }
  }

  private renderPolls(data: PollsFile): void {
    const average = data.average ?? {};
    const parties = PARTY_META
      .map(meta => ({ ...meta, share: average[meta.key], hex: ukPartyHex(meta.colorParty) }))
      .filter((p): p is typeof p & { share: number } => Number.isFinite(p.share))
      .sort((a, b) => b.share - a.share);
    if (parties.length === 0) {
      this.showError('Poll data unavailable', () => void this.fetchData());
      return;
    }

    const maxShare = parties[0]?.share ?? 1;
    const rows = joinSafeHtml(parties.map((p): SafeHtml => {
      const baseline = data.ge2024?.[p.key];
      const delta = Number.isFinite(baseline) ? p.share - (baseline as number) : null;
      const deltaText = delta === null ? '' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
      const deltaClass = delta === null ? '' : delta >= 0 ? 'up' : 'down';
      return safeHtml`
        <div class="poll-row">
          <span class="poll-party">${p.label}</span>
          <span class="poll-bar"><span style="${unsafeRawHtml(`width:${((p.share / maxShare) * 100).toFixed(1)}%;background:${p.hex}`, 'computed width + ukPartyHex output')}"></span></span>
          <span class="poll-share">${p.share.toFixed(1)}%</span>
          <span class="poll-delta ${deltaClass}">${deltaText}</span>
        </div>`;
    }));

    const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const latest = (data.polls ?? [])[0];
    const latestLine = latest
      ? `Latest: ${String(latest.pollster ?? '')} (${String(latest.dates ?? '')})`
      : '';

    this.setSafeContent(safeHtml`
      <div class="uk-polls-panel">
        <div class="poll-rows">${rows}</div>
        <div class="poll-footnote">
          ${String(data.averageWindow ?? '')}-poll average &middot; Δ vs GE 2024 &middot; updated ${updated}
          ${latestLine ? safeHtml`<br>${latestLine}` : ''}
        </div>
      </div>`);
  }
}
