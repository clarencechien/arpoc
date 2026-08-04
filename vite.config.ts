import { defineConfig } from 'vite'

// GitHub Pages 專案站台會掛在 /<repo>/ 底下。
// 用 BASE_PATH 覆寫可讓自訂網域或 user site（掛在 /）也能建置。
const base = process.env.BASE_PATH ?? '/arpoc/'

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    // WebXR 需要 secure context；區網手機測試請用 https 或 chrome://flags 的
    // "Insecure origins treated as secure" 加上 http://<你的內網 IP>:5173
    host: true,
  },
})
