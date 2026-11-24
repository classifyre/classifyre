"use client";

import * as React from "react";
import { useStore } from "zustand";
import type { RequestStoreApi, RequestStoreState } from "./request-store";

const RequestStoreContext = React.createContext<RequestStoreApi | null>(null);

export function RequestStoreProvider({
  store,
  children,
}: {
  store: RequestStoreApi;
  children: React.ReactNode;
}) {
  return (
    <RequestStoreContext.Provider value={store}>
      {children}
    </RequestStoreContext.Provider>
  );
}

export function useRequestStore(): RequestStoreApi {
  const store = React.useContext(RequestStoreContext);
  if (!store) {
    throw new Error("useRequestStore must be used inside RequestStoreProvider");
  }
  return store;
}

export function useRequest<T>(selector: (state: RequestStoreState) => T): T {
  const store = useRequestStore();
  return useStore(store, selector);
}
