import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Phone-testing config: HTTPS (self-signed) on the local network so the mic
// works on other devices. Run: npm run lan  → open https://<this-pc-ip>:4443
// on your phone and accept the certificate warning.
export default defineConfig({
  plugins: [react(), basicSsl()],
  base: './',
  preview: {
    host: true,
    port: 4443,
    strictPort: true,
  },
})
