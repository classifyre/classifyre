/**
 * Edges sharing a pair of nodes bow apart instead of drawing over each other:
 * the first stays straight, the rest alternate sides. The sign is taken
 * against one fixed direction per pair, so A→B and B→A separate too.
 */
export function bendParallel<E extends { source: string; target: string; data?: { bend?: number } }>(edges: E[]): E[] {
  const byPair = new Map<string, E[]>();
  for (const e of edges) {
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    const group = byPair.get(key);
    if (group) group.push(e);
    else byPair.set(key, [e]);
  }
  for (const group of byPair.values()) {
    if (group.length < 2) continue;
    group.forEach((e, i) => {
      const magnitude = Math.ceil(i / 2);
      const step = magnitude === 0 ? 0 : i % 2 === 1 ? magnitude : -magnitude;
      const forward = e.source < e.target;
      e.data = { ...e.data, bend: step === 0 || forward ? step : -step } as E["data"];
    });
  }
  return edges;
}
