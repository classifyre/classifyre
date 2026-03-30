export function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length === 0) return "";

  const d: (string | number)[] = [];
  const p0 = stroke[0];
  const p1 = stroke[1];

  if (!p0 || !p1 || p0[0] === undefined || p0[1] === undefined) return "";

  d.push("M", p0[0], p0[1], "Q");

  let currentP0 = p0;
  let currentP1 = p1;

  for (let i = 1; i < stroke.length; i++) {
    const x0 = currentP0[0];
    const y0 = currentP0[1];
    const x1 = currentP1[0];
    const y1 = currentP1[1];

    if (
      x0 === undefined ||
      y0 === undefined ||
      x1 === undefined ||
      y1 === undefined
    ) {
      continue;
    }

    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    currentP0 = currentP1;
    const nextPoint = stroke[i];
    if (nextPoint) {
      currentP1 = nextPoint;
    }
  }

  d.push("Z");
  return d.join(" ");
}
