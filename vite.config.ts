import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base: works on Supabase Storage hosting and GitHub Pages alike.
export default defineConfig({
  plugins: [react()],
  base: './',
})
