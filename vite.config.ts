import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Aislamiento entre orígenes: habilita SharedArrayBuffer para que ONNX Runtime
// use varios hilos en WebAssembly. "credentialless" permite seguir descargando
// los modelos del Hub de Hugging Face (respuestas CORS sin credenciales).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { headers: isolation },
  preview: { headers: isolation },
})
