import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端开发服务器；/api 与 /images 代理到本地后端(8787)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      "/api": "http://localhost:8787",
      "/images": "http://localhost:8787",
    },
  },
});
