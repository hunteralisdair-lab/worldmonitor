/**
 * UK political findings for the Intelligence Findings badge (politics
 * variant). Three sources, all deltas against a persisted snapshot so a
 * reload does not reset the badge to zero knowledge:
 *
 *  - petition_surge: an open UK Parliament petition crossing the 10k
 *    (government must respond) or 100k (debate consideration) threshold,
 *    or adding 15k+ signatures between checks.
 *  - division_upset: a new Commons division that is knife-edge (margin
 *    <= 15) or an opposition-day motion that PASSED.
 *  - poll_shift: a party's poll-of-polls average moving >= 1.5 points
 *    since the last snapshot (fires when scripts/fetch-uk-polls.mjs
 *    refreshes the static dataset).
 *
 * Signals go through the same addToSignalHistory() pipeline as the
 * correlation engine, so the badge, dropdown and modal inherit them.
 * First run on a fresh profile only baselines — it never fires a backlog.
 */

import { addToSignalHistory, type CorrelationSignal } from '@/services/correlation';

const SNAPSHOT_KEY = 'wm-uk-signals-v1';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const PETITION_VELOCITY_THRESHOLD = 15_000;
const PETITION_THRESHOLDS = [10_000, 100_000];
const KNIFE_EDGE_MARGIN = 15;
const POLL_SHIFT_POINTS = 1.5;

interface Snapshot {
  petitions: Record<string, number>;
  divisionsSeen: number[];
  pollAverages: Record<string, number>;
  baselined: boolean;
}

let timer: ReturnType<typeof setInterval> | null = null;

function loadSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      return {
        petitions: parsed.petitions ?? {},
        divisionsSeen: Array.isArray(parsed.divisionsSeen) ? parsed.divisionsSeen : [],
        pollAverages: parsed.pollAverages ?? {},
        baselined: parsed.baselined === true,
      };
    }
  } catch { /* corrupt or blocked storage — start fresh */ }
  return { petitions: {}, divisionsSeen: [], pollAverages: {}, baselined: false };
}

function saveSnapshot(snapshot: Snapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch { /* per-session only, still functional */ }
}

function signal(
  type: CorrelationSignal['type'],
  id: string,
  title: string,
  description: string,
  confidence: number,
): CorrelationSignal {
  return {
    id,
    type,
    title,
    description,
    confidence,
    timestamp: new Date(),
    data: {},
  };
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

async function checkPetitions(snapshot: Snapshot, emit: CorrelationSignal[]): Promise<void> {
  const res = await fetch('https://petition.parliament.uk/petitions.json?state=open');
  if (!res.ok) return;
  const body = await res.json() as {
    data?: Array<{ id: number; attributes?: { action?: string; signature_count?: number } }>;
  };
  const next: Record<string, number> = {};
  for (const p of body.data ?? []) {
    const action = p.attributes?.action ?? '';
    const count = p.attributes?.signature_count ?? 0;
    const key = String(p.id);
    next[key] = count;
    if (!snapshot.baselined || !action) continue;
    const prev = snapshot.petitions[key];
    if (prev === undefined) continue; // new to the first page; baseline it silently
    for (const threshold of PETITION_THRESHOLDS) {
      if (prev < threshold && count >= threshold) {
        emit.push(signal(
          'petition_surge',
          `petition-${key}-${threshold}`,
          `Petition passes ${formatCount(threshold)} signatures`,
          `"${action}" has reached ${formatCount(count)} signatures${threshold >= 100_000 ? ' — Parliament must consider it for debate' : ' — the government must respond'}.`,
          threshold >= 100_000 ? 0.8 : 0.6,
        ));
      }
    }
    if (count - prev >= PETITION_VELOCITY_THRESHOLD) {
      emit.push(signal(
        'petition_surge',
        `petition-${key}-vel-${Math.floor(count / PETITION_VELOCITY_THRESHOLD)}`,
        'Petition gaining signatures fast',
        `"${action}" added ${formatCount(count - prev)} signatures since the last check (now ${formatCount(count)}).`,
        0.65,
      ));
    }
  }
  snapshot.petitions = next;
}

async function checkDivisions(snapshot: Snapshot, emit: CorrelationSignal[]): Promise<void> {
  const res = await fetch('https://commonsvotes-api.parliament.uk/data/divisions.json/search?queryParameters.take=10');
  if (!res.ok) return;
  const body = await res.json() as Array<{
    DivisionId?: number; Title?: string; AyeCount?: number; NoCount?: number;
  }>;
  const seen = new Set(snapshot.divisionsSeen);
  for (const d of Array.isArray(body) ? body : []) {
    const id = d.DivisionId ?? 0;
    const title = (d.Title ?? '').trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    if (!snapshot.baselined) continue;
    const ayes = d.AyeCount ?? 0;
    const noes = d.NoCount ?? 0;
    const margin = Math.abs(ayes - noes);
    const oppositionWin = /opposition day/i.test(title) && ayes > noes;
    if (oppositionWin) {
      emit.push(signal(
        'division_upset',
        `division-${id}`,
        'Opposition day motion passes',
        `"${title}" passed ${ayes}–${noes} — opposition motions rarely pass against a working majority.`,
        0.8,
      ));
    } else if (margin <= KNIFE_EDGE_MARGIN) {
      emit.push(signal(
        'division_upset',
        `division-${id}`,
        `Knife-edge Commons division (margin ${margin})`,
        `"${title}" divided ${ayes}–${noes}.`,
        0.7,
      ));
    }
  }
  snapshot.divisionsSeen = [...seen].slice(-100);
}

async function checkPolls(snapshot: Snapshot, emit: CorrelationSignal[]): Promise<void> {
  const res = await fetch('/data/uk-polls.json');
  if (!res.ok) return;
  const body = await res.json() as { average?: Record<string, number> };
  const next = body.average ?? {};
  const labels: Record<string, string> = {
    con: 'Conservative', lab: 'Labour', libdem: 'Lib Dem', snp: 'SNP', green: 'Green', reform: 'Reform UK',
  };
  for (const [party, avg] of Object.entries(next)) {
    const prev = snapshot.pollAverages[party];
    if (snapshot.baselined && prev !== undefined && Math.abs(avg - prev) >= POLL_SHIFT_POINTS) {
      const delta = avg - prev;
      emit.push(signal(
        'poll_shift',
        `poll-${party}-${avg.toFixed(1)}`,
        `${labels[party] ?? party} ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)}pts in the polls`,
        `Poll-of-polls average moved from ${prev.toFixed(1)}% to ${avg.toFixed(1)}%.`,
        0.65,
      ));
    }
  }
  snapshot.pollAverages = next;
}

async function runCheck(): Promise<void> {
  const snapshot = loadSnapshot();
  const emit: CorrelationSignal[] = [];
  const results = await Promise.allSettled([
    checkPetitions(snapshot, emit),
    checkDivisions(snapshot, emit),
    checkPolls(snapshot, emit),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.warn('[UKSignals] check failed:', r.reason);
  }
  snapshot.baselined = true;
  saveSnapshot(snapshot);
  if (emit.length > 0) addToSignalHistory(emit);
}

/** Idempotent; the politics data loader calls this once per session. */
export function startUkPoliticalSignals(): void {
  if (timer) return;
  void runCheck();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void runCheck();
  }, CHECK_INTERVAL_MS);
}

export function stopUkPoliticalSignals(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
