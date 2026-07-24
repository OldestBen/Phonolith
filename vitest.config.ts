import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // Only pick up our unit tests; never traverse node_modules or .next
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Mirror the tsconfig "@/*" -> "src/*" path alias so tests import the
    // same way application code does.
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
