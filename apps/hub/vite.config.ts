import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function getServiceUiOrigin(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  const raw = env.VITE_SERVICE_UI_ORIGIN ?? "http://service.localtest.me:5174";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export default defineConfig(({ mode }) => {
  const serviceUiOrigin = getServiceUiOrigin(mode);

  // dev では Vite の HMR (websocket / inline script / eval) を許可するため
  // 'unsafe-inline' / 'unsafe-eval' / ws: を含める。
  // hub 自体は誰にも埋め込ませない (clickjacking 防止)。
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws://hub.localtest.me:5173 ws://localhost:5173 ws://127.0.0.1:5173",
    `frame-src ${serviceUiOrigin}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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
      port: 5173,
      strictPort: true,
      allowedHosts: ["hub.localtest.me", "localhost"],
    },
  };
});
