"use client";

import * as React from "react";
import { useStore } from "zustand";
import type { BoardState, BoardStore } from "./board-store";
import type { UiState, UiStore } from "./ui-store";

const BoardStoreContext = React.createContext<BoardStore | null>(null);
const UiStoreContext = React.createContext<UiStore | null>(null);

export function BoardProviders({
  board,
  ui,
  children,
}: {
  board: BoardStore;
  ui: UiStore;
  children: React.ReactNode;
}) {
  return (
    <BoardStoreContext.Provider value={board}>
      <UiStoreContext.Provider value={ui}>{children}</UiStoreContext.Provider>
    </BoardStoreContext.Provider>
  );
}

export function useBoardStore(): BoardStore {
  const store = React.useContext(BoardStoreContext);
  if (!store) throw new Error("useBoardStore must be used inside <BoardProviders>");
  return store;
}

export function useUiStore(): UiStore {
  const store = React.useContext(UiStoreContext);
  if (!store) throw new Error("useUiStore must be used inside <BoardProviders>");
  return store;
}

/**
 * Narrow subscription to the board store. Select the smallest thing a
 * component needs (one item, one bubble) so unrelated changes do not
 * re-render it; wrap array/object selectors in `useShallow`.
 */
export function useBoard<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardStore(), selector);
}

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(useUiStore(), selector);
}
