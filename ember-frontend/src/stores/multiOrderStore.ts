import { create } from "zustand";

export interface MultiOrderRow {
  id: string;
  side: "bid" | "ask";
  price: string;
  sizeLots: string;
}

interface GridParams {
  centerPrice: string;
  spreadPct: string;
  ordersPerSide: number;
  sizePerOrder: string;
}

interface MultiOrderStore {
  rows: MultiOrderRow[];
  gridParams: GridParams;
  focusedRowId: string | null;

  addRow: (side?: "bid" | "ask") => void;
  removeRow: (id: string) => void;
  updateRow: (id: string, updates: Partial<Omit<MultiOrderRow, "id">>) => void;
  setRows: (rows: MultiOrderRow[]) => void;
  clearRows: () => void;
  setFocusedRowId: (id: string | null) => void;
  setGridParams: (params: Partial<GridParams>) => void;
  generateGrid: (markPrice: number, lotSize: number) => void;
  fillPrice: (price: number) => void;
}

let nextRowId = 0;
function makeId(): string {
  return `mr-${nextRowId++}`;
}

const DEFAULT_GRID: GridParams = {
  centerPrice: "",
  spreadPct: "1",
  ordersPerSide: 3,
  sizePerOrder: "",
};

export const useMultiOrderStore = create<MultiOrderStore>((set, get) => ({
  rows: [],
  gridParams: { ...DEFAULT_GRID },
  focusedRowId: null,

  addRow: (side = "bid") => {
    if (get().rows.length >= 10) return;
    set((s) => ({
      rows: [...s.rows, { id: makeId(), side, price: "", sizeLots: "" }],
    }));
  },

  removeRow: (id) =>
    set((s) => ({
      rows: s.rows.filter((r) => r.id !== id),
      focusedRowId: s.focusedRowId === id ? null : s.focusedRowId,
    })),

  updateRow: (id, updates) =>
    set((s) => ({
      rows: s.rows.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),

  setRows: (rows) => set({ rows }),
  clearRows: () => set({ rows: [], focusedRowId: null }),

  setFocusedRowId: (id) => set({ focusedRowId: id }),

  setGridParams: (params) =>
    set((s) => ({ gridParams: { ...s.gridParams, ...params } })),

  generateGrid: (markPrice, lotSize) => {
    const { gridParams } = get();
    const center = parseFloat(gridParams.centerPrice) || markPrice;
    const spreadPct = parseFloat(gridParams.spreadPct) || 1;
    const perSide = Math.max(1, Math.min(5, gridParams.ordersPerSide));
    const sizeLots = gridParams.sizePerOrder;

    if (center <= 0 || !sizeLots) return;

    const rows: MultiOrderRow[] = [];
    const step = (center * (spreadPct / 100)) / perSide;

    // Bids below center
    for (let i = 1; i <= perSide; i++) {
      const p = center - step * i;
      if (p > 0) {
        rows.push({ id: makeId(), side: "bid", price: p.toFixed(2), sizeLots });
      }
    }
    // Asks above center
    for (let i = 1; i <= perSide; i++) {
      const p = center + step * i;
      rows.push({ id: makeId(), side: "ask", price: p.toFixed(2), sizeLots });
    }

    // Sort: asks descending then bids descending (visual order)
    rows.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    set({ rows });
  },

  fillPrice: (price) => {
    const { rows, focusedRowId } = get();

    // Try focused row first
    if (focusedRowId) {
      const focused = rows.find((r) => r.id === focusedRowId);
      if (focused && !focused.price) {
        get().updateRow(focusedRowId, { price: price.toString() });
        return;
      }
    }

    // Try first empty-price row
    const emptyRow = rows.find((r) => !r.price);
    if (emptyRow) {
      get().updateRow(emptyRow.id, { price: price.toString() });
      return;
    }

    // All rows full — append new row if under limit
    if (rows.length < 10) {
      const id = makeId();
      const side = rows.length > 0 ? rows[rows.length - 1].side : "bid";
      set((s) => ({
        rows: [...s.rows, { id, side, price: price.toString(), sizeLots: "" }],
      }));
    }
  },
}));
