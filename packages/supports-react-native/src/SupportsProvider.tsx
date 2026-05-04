import React, { createContext, useContext, useMemo } from "react";
import { createSupportsClient } from "./client";
import type { SupportsClient, SupportsClientOptions } from "./types";

type Ctx = { client: SupportsClient; options: SupportsClientOptions };
const SupportsCtx = createContext<Ctx | null>(null);

export function SupportsProvider({
  options,
  children,
}: {
  options: SupportsClientOptions;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(() => ({
    client: createSupportsClient(options),
    options,
  }), [options.widgetId]); // eslint-disable-line
  return <SupportsCtx.Provider value={value}>{children}</SupportsCtx.Provider>;
}

export function useSupports(): SupportsClient {
  const v = useContext(SupportsCtx);
  if (!v) throw new Error("useSupports() must be used inside <SupportsProvider>");
  return v.client;
}
