import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    allowedHosts: true, // 允许通过隧道/局域网域名访问（如 trycloudflare 临时链接）
    hmr: {
      port: 3000,
    },
    /* 本地对齐后端（backend/start.cmd）。没启动时代理报错，前端探测失败会退回启发式对齐 */
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
