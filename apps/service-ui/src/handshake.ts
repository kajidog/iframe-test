export type HubInitMessage = {
  type: "hub:init";
  payload: {
    serviceId: string;
    appId?: string;
    hubToken: string;
  };
};

export type ServiceUiAckMessage = {
  type: "service-ui:ack";
  receivedAt: number;
};

export type ServiceUiReadyMessage = {
  type: "service-ui:ready";
  protocolVersion: 1;
};

export function getAllowedParentOrigins(): string[] {
  const raw = (import.meta.env.VITE_ALLOWED_PARENT_ORIGINS as string | undefined) ?? "";
  return raw
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

export function isHubInitMessage(data: unknown): data is HubInitMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  if (m.type !== "hub:init") return false;
  const p = m.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return false;
  if (typeof p.serviceId !== "string") return false;
  if (typeof p.hubToken !== "string") return false;
  if (p.appId !== undefined && typeof p.appId !== "string") return false;
  return true;
}
