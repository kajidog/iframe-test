const API_BASE = import.meta.env.VITE_API_BASE as string;

export type AuthInput =
  | { kind: "apikey"; serviceId: string; apiKey: string; appId?: string }
  | { kind: "hub-token"; serviceId: string; hubToken: string; appId?: string };

export type ApiCallResult = {
  ok: boolean;
  status: number;
  url: string;
  sentHeaders: Record<string, string>;
  body: unknown;
};

export async function callApi(
  path: "/api/me" | "/api/items",
  auth: AuthInput,
): Promise<ApiCallResult> {
  const headers: Record<string, string> = {
    "X-Service-Id": auth.serviceId,
  };
  if (auth.appId) headers["X-App-Id"] = auth.appId;
  if (auth.kind === "apikey") {
    headers["X-Api-Key"] = auth.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${auth.hubToken}`;
  }
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { ok: res.ok, status: res.status, url, sentHeaders: headers, body };
}
