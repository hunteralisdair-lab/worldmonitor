/**
 * Shared yellow → orange → red ramp for intel-hotspot severity (politics
 * fork). One source of truth for every renderer — DeckGL fill/pulse, globe
 * markers, SVG fallback and the map legend — graded on the 1–5 escalation
 * score (live `combinedScore` when the escalation service has one, curated
 * baseline otherwise). Bands mirror MapPopup's escalation labels.
 */
export type HotspotSeverityLevel = 'stable' | 'watch' | 'elevated' | 'high' | 'critical';

export function hotspotSeverityLevel(score: number): HotspotSeverityLevel {
  if (score >= 4.5) return 'critical';
  if (score >= 3.5) return 'high';
  if (score >= 2.5) return 'elevated';
  if (score >= 1.5) return 'watch';
  return 'stable';
}

export const HOTSPOT_SEVERITY_RGB: Record<HotspotSeverityLevel, [number, number, number]> = {
  stable:   [255, 224, 102],
  watch:    [255, 221, 0],
  elevated: [255, 170, 0],
  high:     [255, 102, 0],
  critical: [255, 32, 32],
};

export const HOTSPOT_SEVERITY_HEX: Record<HotspotSeverityLevel, string> = {
  stable:   '#ffe066',
  watch:    '#ffdd00',
  elevated: '#ffaa00',
  high:     '#ff6600',
  critical: '#ff2020',
};

export function hotspotSeverityRgb(score: number): [number, number, number] {
  return HOTSPOT_SEVERITY_RGB[hotspotSeverityLevel(score)];
}

export function hotspotSeverityHex(score: number): string {
  return HOTSPOT_SEVERITY_HEX[hotspotSeverityLevel(score)];
}

/** The score a renderer should grade on: live blend first, curated fallback. */
export function effectiveHotspotScore(h: { liveEscalationScore?: number; escalationScore?: number }): number {
  return h.liveEscalationScore ?? h.escalationScore ?? 1;
}
