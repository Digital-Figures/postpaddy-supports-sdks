import React, { createContext, useContext, useMemo } from "react";
import { createSupportsClient } from "./client";
import type { SupportsClient, SupportsClientOptions } from "./types";

export type NotificationMode = "ask" | "on" | "off";
export type SupportsNotificationOptions = {
  /** Show the floating "new message" peek bubble over the launcher. Default: true. */
  peek?: boolean;
  /** Play a sound on new messages. Default: "ask" (prompt the visitor once). */
  sound?: NotificationMode;
  /** Vibrate on new messages (RN only — no-op on web). Default: "ask". */
  haptic?: NotificationMode;
};

export type SupportsProviderOptions = SupportsClientOptions & {
  notifications?: SupportsNotificationOptions;
};

type Ctx = {
  client: SupportsClient;
  options: SupportsProviderOptions;
  notifications: Required<SupportsNotificationOptions>;
};
const SupportsCtx = createContext<Ctx | null>(null);

const NOTIFICATION_DEFAULTS: Required<SupportsNotificationOptions> = {
  peek: true,
  sound: "ask",
  haptic: "ask",
};

export function SupportsProvider({
  options,
  children,
}: {
  options: SupportsProviderOptions;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(() => ({
    client: createSupportsClient(options),
    options,
    notifications: { ...NOTIFICATION_DEFAULTS, ...(options.notifications ?? {}) },
  }), [options.widgetId]); // eslint-disable-line
  return <SupportsCtx.Provider value={value}>{children}</SupportsCtx.Provider>;
}

export function useSupports(): SupportsClient {
  const v = useContext(SupportsCtx);
  if (!v) throw new Error("useSupports() must be used inside <SupportsProvider>");
  return v.client;
}

export function useSupportsNotifications(): Required<SupportsNotificationOptions> {
  const v = useContext(SupportsCtx);
  if (!v) throw new Error("useSupportsNotifications() must be used inside <SupportsProvider>");
  return v.notifications;
}
