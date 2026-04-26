import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function getAllowedParents(mode: string): string[] {
  const env = loadEnv(mode, process.cwd(), "");
  const raw = env.VITE_ALLOWED_PARENT_ORIGINS ?? "http://hub.localtest.me:5173";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getApiOrigin(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  const raw = env.VITE_API_BASE ?? "http://api.localtest.me:8787";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export default defineConfig(({ mode }) => {
  const allowedParents = getAllowedParents(mode);
  const frameAncestors = ["'self'", ...allowedParents].join(" ");
  const apiOrigin = getApiOrigin(mode);

  // dev では Vite の HMR (websocket / inline script / eval) を許可するため
  // 'unsafe-inline' / 'unsafe-eval' / ws: を含める。
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ws://service.localtest.me:5174 ws://localhost:5174 ws://127.0.0.1:5174`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");

  return {
    plugins: [
      react(),
      {
        name: "security-headers",
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            res.setHeader("Content-Security-Policy", csp);
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Referrer-Policy", "no-referrer");
            res.setHeader(
              "Permissions-Policy",
              "camera=(), microphone=(), geolocation=(), payment=()",
            );
            next();
          });
        },
      },
    ],
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      allowedHosts: ["service.localtest.me", "hub.localtest.me", "localhost", "127.0.0.1"],
    },
  };
});
