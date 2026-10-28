import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** ANotes 全量 Web UI bundle:IIFE 单文件 → ANotes/android assets。 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../android/app/src/main/assets/editor'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/app/main.ts'),
      name: 'AmooNotesLib',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'editor.css' : '[name][extname]'),
      },
    },
  },
})
