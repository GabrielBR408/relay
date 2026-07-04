import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed at https://gabrielbr408.github.io/relay/
export default defineConfig({
  plugins: [react()],
  base: '/relay/',
})
