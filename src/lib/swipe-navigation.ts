export type SwipeSample = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  elapsed: number;
  width: number;
};
export function swipeDirection(sample: SwipeSample): -1 | 0 | 1 {
  const dx = sample.endX - sample.startX,
    dy = sample.endY - sample.startY;
  // Leave the screen edges to Android/browser back gestures; never wrap at the ends.
  if (
    sample.startX < 24 ||
    sample.startX > sample.width - 24 ||
    sample.elapsed > 900 ||
    sample.elapsed < 0 ||
    Math.abs(dx) < 64 ||
    Math.abs(dx) < Math.abs(dy) * 1.7
  )
    return 0;
  return dx < 0 ? 1 : -1;
}
export function adjacentDestination(
  links: { href: string; current: boolean }[],
  direction: -1 | 0 | 1,
) {
  if (!direction) return null;
  const current = links.findIndex((link) => link.current);
  return current < 0 ? null : (links[current + direction]?.href ?? null);
}
