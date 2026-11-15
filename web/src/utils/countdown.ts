export type CountdownAnchor = { remainingMs: number; receivedAt: number };

/**
 * Render a server-authoritative countdown without ever using Date.now().
 * Different laptop clock settings do not change the apparent seconds left.
 */
export function countdownSeconds(anchor: CountdownAnchor | null, monotonicNow: number): number {
  if (!anchor) return 0;
  const elapsed = Math.max(0, monotonicNow - anchor.receivedAt);
  return Math.max(0, Math.ceil((anchor.remainingMs - elapsed) / 1000));
}
