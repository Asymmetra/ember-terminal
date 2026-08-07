import { create } from "zustand";

export interface Toast {
  id: string;
  type: "success" | "error" | "info" | "loading";
  title: string;
  detail?: string;
  txid?: string;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (type: Toast["type"], title: string, detail?: string) => string;
  updateToast: (id: string, updates: Partial<Pick<Toast, "type" | "title" | "detail" | "txid">>) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, title, detail) => {
    const id = `toast-${nextId++}`;
    set((s) => {
      const updated = [...s.toasts, { id, type, title, detail }];
      // Max 3 visible toasts — drop oldest non-loading first, then oldest overall
      if (updated.length > 3) {
        const nonLoadingIdx = updated.findIndex((t) => t.type !== "loading");
        if (nonLoadingIdx >= 0) {
          updated.splice(nonLoadingIdx, 1);
        } else {
          updated.shift();
        }
      }
      return { toasts: updated };
    });
    return id;
  },
  updateToast: (id, updates) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id !== id ? t : { ...t, ...updates })),
    })),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
