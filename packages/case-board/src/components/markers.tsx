/**
 * SVG markers shared by every edge, rendered once per canvas. Colours come
 * from the board's CSS variables so they follow the theme.
 */
export function EdgeMarkers() {
  const arrow = (id: string, color: string) => (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M0,0 L10,5 L0,10 z" style={{ fill: color }} />
    </marker>
  );
  return (
    <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        {arrow("cb-arrow-system", "var(--cb-edge)")}
        {arrow("cb-arrow-ink", "var(--foreground)")}
        {arrow("cb-arrow-red", "var(--cb-contradicts)")}
        {arrow("cb-arrow-manual", "var(--cb-manual)")}
        {arrow("cb-arrow-select", "var(--cb-select)")}
      </defs>
    </svg>
  );
}
