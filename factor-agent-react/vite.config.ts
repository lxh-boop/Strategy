import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 开发期跨域代理：前端所有 /api 请求转发到本地 NestJS 后端（factor-agent-server）
    proxy: { "/api": "http://localhost:3000" },
  },
});
