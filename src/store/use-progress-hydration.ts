"use client";

import { create } from "zustand";

export type ProgressHydrationStatus = "idle" | "loading" | "ready" | "error";

interface ProgressHydrationState {
  status: ProgressHydrationStatus;
  error: string | null;
  setLoading: () => void;
  setReady: () => void;
  setError: (error: string) => void;
  reset: () => void;
}

/** Server workspace load — separate from Zustand IndexedDB hydration. */
export const useProgressHydration = create<ProgressHydrationState>((set) => ({
  status: "idle",
  error: null,
  setLoading: () => set({ status: "loading", error: null }),
  setReady: () => set({ status: "ready", error: null }),
  setError: (error) => set({ status: "error", error }),
  reset: () => set({ status: "idle", error: null }),
}));
