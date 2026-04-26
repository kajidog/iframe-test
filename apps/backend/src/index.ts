import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

type Variables = {
  authMethod: "apikey" | "hub-token";
  serviceId: string;
  appId: string | null;
  requestOrigin: string | null;
  tokenPayload: Record<string, unknown> | null;
};

const app = new Hono<{ Variables: Variables }>();

const ALLOWED_ORIGINS = ["http://service.localtest.me:5174"];
const MOCK_API_KEY = "mock-api-key-123";

app.use(
  "*",
  cors({
    origin: ALLOWED_ORIGINS,
    allowHeaders: [
      "Authorization",
      "X-Service-Id",
      "X-Api-Key",
      "X-App-Id",
      "Content-Type",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

// 学習用: Origin をログに出す
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "(none)";
  console.log(`[${c.req.method}] ${c.req.path}  Origin=${origin}`);
  await next();
});

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf-8");
    const obj = JSON.parse(json);
    return typeof obj === "object" && obj !== null ? obj : null;
  } catch {
    return null;
  }
}

app.use("/api/*", async (c, next) => {
  const serviceId = c.req.header("X-Service-Id");
  const apiKey = c.req.header("X-Api-Key");
  const auth = c.req.header("Authorization");
  const appId = c.req.header("X-App-Id") ?? null;
  const origin = c.req.header("Origin") ?? null;

  if (!serviceId) {
    return c.json({ error: "X-Service-Id required" }, 401);
  }

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const payload = decodeJwtPayload(token);
    if (!payload) return c.json({ error: "invalid token" }, 401);
    // 注意: 実運用では jose 等で署名 + JWKS 検証が必要。ここは学習用にデコードのみ。
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return c.json({ error: "expired token" }, 401);
    }
    if (
      typeof payload.serviceId === "string" &&
      payload.serviceId !== serviceId
    ) {
      return c.json({ error: "serviceId mismatch" }, 403);
    }
    c.set("authMethod", "hub-token");
    c.set("tokenPayload", payload);
  } else if (apiKey) {
    if (apiKey !== MOCK_API_KEY) {
      return c.json({ error: "invalid api key" }, 401);
    }
    c.set("authMethod", "apikey");
    c.set("tokenPayload", null);
  } else {
    return c.json({ error: "auth required" }, 401);
  }

  c.set("serviceId", serviceId);
  c.set("appId", appId);
  c.set("requestOrigin", origin);
  await next();
});

app.get("/api/me", (c) => {
  return c.json({
    authMethod: c.get("authMethod"),
    requestOrigin: c.get("requestOrigin"),
    serviceId: c.get("serviceId"),
    appId: c.get("appId"),
    tokenPayload: c.get("tokenPayload"),
  });
});

app.get("/api/items", (c) => {
  return c.json({
    authMethod: c.get("authMethod"),
    requestOrigin: c.get("requestOrigin"),
    serviceId: c.get("serviceId"),
    appId: c.get("appId"),
    items: [
      { id: 1, name: "Item Alpha" },
      { id: 2, name: "Item Beta" },
      { id: 3, name: "Item Gamma" },
    ],
  });
});

app.get("/", (c) => c.text("backend ok"));

const port = 8787;
console.log(`backend listening on http://api.localtest.me:${port}`);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
