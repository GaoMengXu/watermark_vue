import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 部署到子路径时：VITE_BASE=/tools/ npm run build
  // 无法配置 history 回退的纯静态托管：VITE_BASE=./ VITE_ROUTER_MODE=hash npm run build
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5173 },
})
