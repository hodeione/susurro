export type Device = 'webgpu' | 'wasm'

export interface ModelOption {
  id: string
  repo: string
  name: string
  hint: string
  /** MB aproximados que se descargan la primera vez. */
  sizeMb: Record<Device, number>
  webgpuOnly?: boolean
}

export const MODELS: ModelOption[] = [
  { id: 'tiny', repo: 'onnx-community/whisper-tiny', name: 'Rápido', hint: 'Notas de voz y audios cortos.', sizeMb: { wasm: 41, webgpu: 96 } },
  { id: 'base', repo: 'onnx-community/whisper-base', name: 'Equilibrado', hint: 'Buena calidad en casi cualquier equipo.', sizeMb: { wasm: 77, webgpu: 142 } },
  { id: 'small', repo: 'onnx-community/whisper-small', name: 'Calidad', hint: 'Más preciso con acentos y ruido.', sizeMb: { wasm: 249, webgpu: 299 } },
  {
    id: 'turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    name: 'Máxima',
    hint: 'Whisper large-v3 turbo. Necesita tarjeta gráfica (WebGPU).',
    sizeMb: { wasm: 1084, webgpu: 759 },
    webgpuOnly: true,
  },
]

/**
 * Precisión de cada parte del modelo. En CPU (WASM) se usa int8 ("q8"),
 * que es lo más rápido. En GPU el codificador va en fp16 si la tarjeta lo
 * admite (si no, fp32) y el decodificador en q4, que es donde más se ahorra.
 */
export function dtypeFor(device: Device, shaderF16: boolean, modelId: string) {
  if (device === 'wasm') return { encoder_model: 'q8', decoder_model_merged: 'q8' } as const
  if (modelId === 'turbo') return { encoder_model: 'q4', decoder_model_merged: 'q4' } as const
  return { encoder_model: shaderF16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } as const
}

export const LANGUAGES: [string, string][] = [
  ['auto', 'Detectar idioma'],
  ['es', 'Castellano'],
  ['ca', 'Català'],
  ['eu', 'Euskara'],
  ['gl', 'Galego'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['de', 'Deutsch'],
]

export interface GpuInfo {
  available: boolean
  shaderF16: boolean
}

export async function detectGpu(): Promise<GpuInfo> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
    if (!gpu) return { available: false, shaderF16: false }
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { available: false, shaderF16: false }
    return { available: true, shaderF16: adapter.features.has('shader-f16') }
  } catch {
    return { available: false, shaderF16: false }
  }
}
