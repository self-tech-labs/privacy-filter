export type OutputMode = 'typed' | 'redacted'
export type RuntimeBackend = 'webgpu' | 'wasm'

export interface DetectedSpan {
  label: string
  start: number
  end: number
  text: string
  placeholder: string
  score: number
}

export interface PrivacyRunSummary {
  outputMode: OutputMode
  spanCount: number
  byLabel: Record<string, number>
  backend: RuntimeBackend
}

export interface PrivacyRunResult {
  redactedText: string
  detectedSpans: DetectedSpan[]
  summary: PrivacyRunSummary
}

export interface ModelStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  detail: string
  progress: number | null
  backend: RuntimeBackend | null
  cacheHint: boolean
}
