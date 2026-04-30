import { env, pipeline } from '@huggingface/transformers'

import { buildPrivacyRunResult } from '../lib/privacyPlaceholders'
import type {
  ModelStatus,
  OutputMode,
  PrivacyRunResult,
  RuntimeBackend,
} from '../types/privacy'
import { createTauriCustomCache } from './transformersCache'

const MODEL_ID = 'openai/privacy-filter'
const PIPELINE_TASK = 'token-classification'
const CACHE_HINT_KEY = 'ogram-private-model-ready'
const FALLBACK_BACKEND: RuntimeBackend = 'wasm'
const MAX_CLASSIFIER_CHARS = 3200
const MIN_TRAILING_CHARS = 600
const BACKEND_DTYPE: Record<RuntimeBackend, 'q4' | 'q8'> = {
  webgpu: 'q4',
  wasm: 'q8',
}

type StatusListener = (status: ModelStatus) => void

interface GroupedSpan {
  word: string
  score: number
  entity_group?: string
  entity?: string
  start?: number
  end?: number
}

interface ClassifierState {
  classifier: (
    input: string,
    options?: { aggregation_strategy?: 'simple' },
  ) => Promise<GroupedSpan[]>
  backend: RuntimeBackend
}

interface TextChunk {
  start: number
  text: string
}

let classifierPromise: Promise<ClassifierState> | null = null
let environmentConfigured = false

function getCacheHint() {
  try {
    return window.localStorage.getItem(CACHE_HINT_KEY) === 'true'
  } catch {
    return false
  }
}

function setCacheHint(value: boolean) {
  try {
    window.localStorage.setItem(CACHE_HINT_KEY, value ? 'true' : 'false')
  } catch {
    // Ignore storage failures.
  }
}

function emitStatus(
  listener: StatusListener | undefined,
  status: Partial<ModelStatus>,
): void {
  if (!listener) {
    return
  }

  listener({
    phase: status.phase ?? 'idle',
    detail: status.detail ?? 'Idle',
    progress: status.progress ?? null,
    backend: status.backend ?? null,
    cacheHint: status.cacheHint ?? getCacheHint(),
  })
}

async function configureEnvironment() {
  if (environmentConfigured) {
    return
  }

  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = false
  env.useFSCache = false
  env.useCustomCache = true
  env.customCache = createTauriCustomCache()
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = import.meta.env.DEV
      ? '/node_modules/onnxruntime-web/dist/'
      : '/ort/'
  }

  environmentConfigured = true
}

function loadingDetail(event: Record<string, unknown>) {
  const status = String(event.status ?? '')

  if (
    status === 'download' ||
    status === 'progress' ||
    status === 'progress_total' ||
    status === 'initiate'
  ) {
    return 'Preparing local engine'
  }

  if (status === 'done' || status === 'ready') {
    return 'Finalizing local engine'
  }

  return 'Preparing local engine'
}

async function createClassifier(
  backend: RuntimeBackend,
  statusListener?: StatusListener,
): Promise<ClassifierState> {
  emitStatus(statusListener, {
    phase: 'loading',
    detail: 'Preparing local engine',
    backend,
    progress: null,
  })

  const localFilesOnly =
    getCacheHint() && typeof navigator !== 'undefined' && navigator.onLine === false

  const classifier = await pipeline(PIPELINE_TASK, MODEL_ID, {
    device: backend,
    dtype: BACKEND_DTYPE[backend],
    local_files_only: localFilesOnly,
    progress_callback(event) {
      emitStatus(statusListener, {
        phase: 'loading',
        backend,
        detail: loadingDetail(event as Record<string, unknown>),
        progress: null,
      })
    },
  })

  setCacheHint(true)
  emitStatus(statusListener, {
    phase: 'ready',
    detail: 'Local engine ready',
    backend,
    progress: null,
    cacheHint: true,
  })

  return {
    classifier,
    backend,
  }
}

async function getClassifier(statusListener?: StatusListener) {
  await configureEnvironment()

  if (!classifierPromise) {
    classifierPromise = (async () => {
      try {
        return await createClassifier('webgpu', statusListener)
      } catch (webgpuError) {
        emitStatus(statusListener, {
          phase: 'loading',
          detail: 'Switching to compatibility engine',
          backend: FALLBACK_BACKEND,
          progress: null,
        })

        try {
          return await createClassifier(FALLBACK_BACKEND, statusListener)
        } catch (fallbackError) {
          classifierPromise = null
          throw fallbackError instanceof Error ? fallbackError : webgpuError
        }
      }
    })()
  }

  return classifierPromise
}

function splitForClassifier(sourceText: string): TextChunk[] {
  if (sourceText.length <= MAX_CLASSIFIER_CHARS) {
    return [{ start: 0, text: sourceText }]
  }

  const chunks: TextChunk[] = []
  let start = 0

  while (start < sourceText.length) {
    let end = Math.min(start + MAX_CLASSIFIER_CHARS, sourceText.length)

    if (end < sourceText.length) {
      const window = sourceText.slice(start, end)
      const splitAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      )

      if (splitAt > MIN_TRAILING_CHARS) {
        end = start + splitAt + 1
      }
    }

    chunks.push({
      start,
      text: sourceText.slice(start, end),
    })
    start = end
  }

  return chunks
}

async function classifyText(
  sourceText: string,
  classifier: ClassifierState['classifier'],
  backend: RuntimeBackend,
  statusListener?: StatusListener,
): Promise<GroupedSpan[]> {
  const chunks = splitForClassifier(sourceText)
  const spans: GroupedSpan[] = []

  for (const [index, chunk] of chunks.entries()) {
    emitStatus(statusListener, {
      phase: 'loading',
      detail:
        chunks.length === 1
          ? 'Making text private'
          : `Making text private (${index + 1}/${chunks.length})`,
      backend,
      progress: index / chunks.length,
      cacheHint: true,
    })

    const chunkOutput = await classifier(chunk.text, {
      aggregation_strategy: 'simple',
    })

    spans.push(
      ...chunkOutput.map((span) => ({
        ...span,
        start:
          typeof span.start === 'number' ? chunk.start + span.start : span.start,
        end: typeof span.end === 'number' ? chunk.start + span.end : span.end,
      })),
    )
  }

  emitStatus(statusListener, {
    phase: 'loading',
    detail: 'Finalizing private text',
    backend,
    progress: 1,
    cacheHint: true,
  })

  return spans
}

export function getInitialModelStatus(): ModelStatus {
  return {
    phase: 'idle',
    detail: getCacheHint()
      ? 'Local engine ready'
      : 'Runs locally after the first model download',
    progress: null,
    backend: null,
    cacheHint: getCacheHint(),
  }
}

export async function redactText(
  sourceText: string,
  outputMode: OutputMode,
  statusListener?: StatusListener,
): Promise<PrivacyRunResult> {
  const { classifier, backend } = await getClassifier(statusListener)
  emitStatus(statusListener, {
    phase: 'loading',
    detail: 'Making text private',
    backend,
    progress: null,
    cacheHint: true,
  })
  const modelOutput = await classifyText(
    sourceText,
    classifier,
    backend,
    statusListener,
  )

  emitStatus(statusListener, {
    phase: 'ready',
    detail: 'Local engine ready',
    backend,
    progress: null,
    cacheHint: true,
  })

  return buildPrivacyRunResult(sourceText, modelOutput, outputMode, backend)
}
