import { defineConfig } from 'nitro'

export default defineConfig({
  vercel: {
    // The AI review of a delivery can take up to a minute.
    functions: { maxDuration: 120 },
  },
})
