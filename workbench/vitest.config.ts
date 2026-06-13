import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // scripts/ 下的 .test.mjs 是 Node 独立可执行自检（用 node 直接跑），
    // 不走 vitest runner —— 排除避免 vitest 误捕获并因 process.exit 报错
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'scripts/**'],
  },
})
