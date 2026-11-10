import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスで出力し、GitHub Pages のリポジトリ名に依存しないようにする
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
