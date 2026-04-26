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

export default defineConfig(({ mode }) => {
  const allowedParents = getAllowedParents(mode);
  const frameAncestors = ["'self'", ...allowedParents].join(" ");

  return {
    plugins: [
      react(),
      {
        name: "csp-frame-ancestors",
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            // 許可した親以外からの埋め込みを拒否（"self" は単独表示用）
            res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
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
