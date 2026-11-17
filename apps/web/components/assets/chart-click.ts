/**
 * Which row an ECharts click on a horizontal bar chart meant: the bar's own
 * index, or — when the axis label was clicked — the row with that label.
 * -1 when neither.
 */
export function clickedIndex(
  event: unknown,
  labels: readonly string[],
): number {
  if (typeof event !== "object" || event === null) return -1;
  const params = event as {
    dataIndex?: unknown;
    componentType?: unknown;
    value?: unknown;
  };
  if (typeof params.dataIndex === "number" && params.componentType !== "yAxis")
    return params.dataIndex;
  if (params.componentType === "yAxis" && typeof params.value === "string")
    return labels.indexOf(params.value);
  return -1;
}
