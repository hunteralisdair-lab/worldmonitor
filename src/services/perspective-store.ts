import type { SourceBias } from '@/types';

/**
 * Political perspective lens (politics variant).
 *
 * A LENS, not a filter: switching the lens re-ranks news lists so
 * matching-side sources surface first — nothing is ever hidden. 'balanced'
 * (the default) applies no re-rank at all.
 */
export type PerspectiveLens = 'balanced' | 'left' | 'center' | 'right';

export const PERSPECTIVE_LENSES = ['balanced', 'left', 'center', 'right'] as const satisfies readonly PerspectiveLens[];

export const PERSPECTIVE_STORAGE_KEY = 'worldmonitor-perspective';

export function normalizePerspectiveLens(value: string | null | undefined): PerspectiveLens {
  return (PERSPECTIVE_LENSES as readonly string[]).includes(value ?? '')
    ? value as PerspectiveLens
    : 'balanced';
}

function loadStoredLens(): PerspectiveLens {
  try {
    return normalizePerspectiveLens(localStorage.getItem(PERSPECTIVE_STORAGE_KEY));
  } catch {
    return 'balanced';
  }
}

type PerspectiveListener = (lens: PerspectiveLens) => void;

let currentLens: PerspectiveLens = loadStoredLens();
const listeners = new Set<PerspectiveListener>();

export function getPerspectiveLens(): PerspectiveLens {
  return currentLens;
}

export function setPerspectiveLens(lens: PerspectiveLens): void {
  const next = normalizePerspectiveLens(lens);
  if (next === currentLens) return;
  currentLens = next;
  try {
    localStorage.setItem(PERSPECTIVE_STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable in private mode. Keep the live preference.
  }
  for (const listener of listeners) listener(next);
}

export function subscribePerspective(listener: PerspectiveListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Whether a source's 5-point bias rating falls on the lens's side.
 * 'left' matches left + center-left, 'right' matches right + center-right,
 * 'center' matches center only; 'balanced' (and unrated sources) never match.
 */
export function lensMatchesBias(lens: PerspectiveLens, bias: SourceBias | undefined): boolean {
  if (!bias) return false;
  switch (lens) {
    case 'left': return bias === 'left' || bias === 'center-left';
    case 'right': return bias === 'right' || bias === 'center-right';
    case 'center': return bias === 'center';
    default: return false;
  }
}
