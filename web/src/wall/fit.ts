export interface ColumnLayout {
  /** Column width in px. */
  width: number;
  /** Squares per row in this column. */
  cols: number;
  shown: number;
  overflow: number;
}

export interface BoardLayout {
  /** One square size (px) for the whole wall, so it reads as an orderly grid. */
  size: number;
  columns: ColumnLayout[];
}

/**
 * Lay out the wall's columns inside a W×H area (px). Every square gets the same size;
 * a column with many notes gets extra sub-columns instead of smaller squares. The size
 * is the largest (up to 16u) that lets all columns sit side by side. If nothing fits
 * even at 8u, the fullest columns show a "+N more" tile.
 */
export function layoutBoard(W: number, H: number, counts: number[], u: number): BoardLayout {
  const gap = 0.9 * u;
  const colGap = 1.5 * u;
  const minColW = 13 * u;
  const maxS = 16 * u;
  const minS = 8 * u;

  const measure = (size: number) => {
    const rows = Math.max(1, Math.floor((H + gap) / (size + gap)));
    const columns = counts.map(count => {
      const cols = Math.max(1, Math.ceil(count / rows));
      return { cols, width: Math.max(minColW, cols * size + (cols - 1) * gap), shown: count, overflow: 0 };
    });
    return { rows, columns };
  };
  const totalWidth = (columns: ColumnLayout[]) =>
    columns.reduce((sum, c) => sum + c.width, 0) + colGap * Math.max(0, columns.length - 1);

  if (W <= 0 || H <= 0 || counts.length === 0) {
    return { size: Math.floor(maxS), columns: measure(maxS).columns };
  }

  for (let size = maxS; size >= minS; size -= u / 4) {
    const { columns } = measure(size);
    if (totalWidth(columns) <= W) return spread({ size: Math.floor(size), columns }, W, colGap);
  }

  // Too many notes: narrow the widest columns, then cap each column at what fits.
  const { rows, columns } = measure(minS);
  while (totalWidth(columns) > W) {
    let widest = -1;
    columns.forEach((c, i) => {
      if (c.cols > 1 && (widest < 0 || c.cols > (columns[widest]?.cols ?? 0))) widest = i;
    });
    const col = columns[widest];
    if (!col) break;
    col.cols -= 1;
    col.width = Math.max(minColW, col.cols * minS + (col.cols - 1) * gap);
  }
  columns.forEach((col, i) => {
    const count = counts[i] ?? 0;
    const capacity = col.cols * rows;
    if (count > capacity) {
      col.shown = Math.max(0, capacity - 1);
      col.overflow = count - col.shown;
    }
  });
  return spread({ size: Math.floor(minS), columns }, W, colGap);
}

/** Share leftover width between the columns so the wall doesn't bunch up on the left. */
function spread(layout: BoardLayout, W: number, colGap: number): BoardLayout {
  const used = layout.columns.reduce((sum, c) => sum + c.width, 0) + colGap * (layout.columns.length - 1);
  const extra = Math.max(0, W - used) / layout.columns.length;
  return { ...layout, columns: layout.columns.map(c => ({ ...c, width: Math.floor(c.width + extra) })) };
}
