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

export interface PrivacyFolderFile {
  path: string
  relativePath: string
  outputRelativePath: string
  extension: string
  bytes: number
  kind: 'office' | 'pdf' | 'text'
}

export interface UnsupportedPrivacyFile {
  path: string
  relativePath: string
  extension: string
  reason: string
}

export interface PrivacyFolderScan {
  inputRoot: string
  files: PrivacyFolderFile[]
  unsupported: UnsupportedPrivacyFile[]
  warnings: string[]
}

export interface ExtractedPrivacyFile {
  sourcePath: string
  relativePath: string
  outputRelativePath: string
  markdown: string
  extractor: string
  warnings: string[]
  charCount: number
}

export interface PrivacyWriteResult {
  path: string
  bytes: number
}
