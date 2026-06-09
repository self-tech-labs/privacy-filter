import { env, pipeline } from '@huggingface/transformers'

import { buildPrivacyRunResult } from '../lib/privacyPlaceholders'
import type {
  ModelStatus,
  OutputMode,
  PrivacyRunResult,
  RuntimeBackend,
} from '../types/privacy'
import {
  fireAndForgetRuntimeLog,
  serializeError,
} from './runtimeLogging'
import { createTauriCustomCache } from './transformersCache'

const MODEL_ID = 'openai/privacy-filter'
const PIPELINE_TASK = 'token-classification'
const CACHE_HINT_KEY = 'ogram-private-model-ready'
const FALLBACK_BACKEND: RuntimeBackend = 'wasm'
const MAX_CLASSIFIER_CHARS = 3200
const MIN_TRAILING_CHARS = 600
const CLASSIFIER_LOAD_TIMEOUT_MS = 180_000
const CLASSIFIER_CHUNK_TIMEOUT_MS = 120_000
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
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not read model cache hint', {
      location: 'model-cache-hint',
      error: serializeError(error),
    })
    return false
  }
}

function setCacheHint(value: boolean) {
  try {
    window.localStorage.setItem(CACHE_HINT_KEY, value ? 'true' : 'false')
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not write model cache hint', {
      location: 'model-cache-hint',
      error: serializeError(error),
    })
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

  try {
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
    fireAndForgetRuntimeLog('info', 'Transformers environment configured', {
      location: 'model-environment',
      wasmPaths: env.backends.onnx.wasm?.wasmPaths ?? 'unavailable',
    })
  } catch (error) {
    fireAndForgetRuntimeLog('error', 'Transformers environment configuration failed', {
      location: 'model-environment',
      error: serializeError(error),
    })
    throw error
  }
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

  const localFilesOnly = shouldUseLocalFilesOnly()

  fireAndForgetRuntimeLog('info', 'Model classifier load started', {
    location: 'model-load',
    backend,
    localFilesOnly,
  })

  const classifier = await withTimeout(
    pipeline(PIPELINE_TASK, MODEL_ID, {
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
    }),
    CLASSIFIER_LOAD_TIMEOUT_MS,
    `Model load timed out for ${backend}`,
  )

  setCacheHint(true)
  emitStatus(statusListener, {
    phase: 'ready',
    detail: 'Local engine ready',
    backend,
    progress: null,
    cacheHint: true,
  })

  fireAndForgetRuntimeLog('info', 'Model classifier load completed', {
    location: 'model-load',
    backend,
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
      const backendOrder = getBackendOrder()
      let lastError: unknown = null

      for (const [index, backend] of backendOrder.entries()) {
        try {
          return await createClassifier(backend, statusListener)
        } catch (error) {
          lastError = error
          fireAndForgetRuntimeLog('warn', 'Model classifier backend failed', {
            location: 'model-load',
            backend,
            error: serializeError(error),
          })

          const nextBackend = backendOrder[index + 1]
          if (nextBackend) {
            emitStatus(statusListener, {
              phase: 'loading',
              detail: 'Switching to compatibility engine',
              backend: nextBackend,
              progress: null,
            })
          }
        }
      }

      classifierPromise = null
      throw lastError instanceof Error
        ? lastError
        : new Error('Local engine could not be initialized.')
    })()
  }

  return classifierPromise
}

function getBackendOrder(): RuntimeBackend[] {
  if (isWindowsRuntime()) {
    return [FALLBACK_BACKEND, 'webgpu']
  }

  return ['webgpu', FALLBACK_BACKEND]
}

function shouldUseLocalFilesOnly(): boolean {
  try {
    return (
      getCacheHint() &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    )
  } catch {
    return false
  }
}

function isWindowsRuntime(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string
    }
  }
  const platform = nav.userAgentData?.platform || nav.platform || ''
  return /win/i.test(platform) || /windows/i.test(nav.userAgent)
}

function normalizeGroupedSpans(output: unknown): GroupedSpan[] {
  if (!Array.isArray(output)) {
    fireAndForgetRuntimeLog('warn', 'Model classifier returned non-array output', {
      location: 'model-inference',
      outputType: typeof output,
    })
    return []
  }

  return output.flatMap((item) => {
    if (!isGroupedSpan(item)) {
      fireAndForgetRuntimeLog('warn', 'Model classifier returned invalid span', {
        location: 'model-inference',
      })
      return []
    }

    return [
      {
        ...item,
        score: typeof item.score === 'number' ? item.score : 0,
      },
    ]
  })
}

function isGroupedSpan(value: unknown): value is GroupedSpan {
  if (!value || typeof value !== 'object') {
    return false
  }

  const span = value as Partial<GroupedSpan>
  const hasLabel =
    typeof span.entity_group === 'string' || typeof span.entity === 'string'
  const hasOffsets =
    (span.start === undefined || typeof span.start === 'number') &&
    (span.end === undefined || typeof span.end === 'number')

  return typeof span.word === 'string' && hasLabel && hasOffsets
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeoutId))
  })
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

    const chunkOutput = await withTimeout(
      classifier(chunk.text, {
        aggregation_strategy: 'simple',
      }),
      CLASSIFIER_CHUNK_TIMEOUT_MS,
      `Model inference timed out on chunk ${index + 1}/${chunks.length}`,
    )
    const normalizedChunkOutput = normalizeGroupedSpans(chunkOutput)

    spans.push(
      ...normalizedChunkOutput.map((span) => ({
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
