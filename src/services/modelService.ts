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
import {
  clearTransformersCache,
  createTauriCustomCache,
} from './transformersCache'

const MODEL_ID = 'openai/privacy-filter'
const PIPELINE_TASK = 'token-classification'
const CACHE_HINT_KEY = 'ogram-private-model-ready'
const FALLBACK_BACKEND: RuntimeBackend = 'wasm'
const MAX_CLASSIFIER_CHARS = 3200
const MIN_TRAILING_CHARS = 600
const WASM_CLASSIFIER_LOAD_TIMEOUT_MS = 300_000
const WEBGPU_CLASSIFIER_LOAD_TIMEOUT_MS = 60_000
const CLASSIFIER_CHUNK_TIMEOUT_MS = 120_000
const BACKEND_DTYPE: Record<RuntimeBackend, 'q4' | 'q8'> = {
  webgpu: 'q4',
  wasm: 'q8',
}

type StatusListener = (status: ModelStatus) => void

export interface ModelRuntimeOptions {
  compatibilityOnly?: boolean
  compatibilityReason?: string
}

interface BackendLoadAttempt {
  backend: RuntimeBackend
  timeoutMs: number
  resetCacheBeforeLoad?: boolean
  detail: string
}

interface BackendFailure {
  backend: RuntimeBackend
  reason: string
  timedOut: boolean
}

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
let classifierPromiseMode: 'auto' | 'compatibility-only' | null = null
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
  attempt: BackendLoadAttempt,
  statusListener?: StatusListener,
): Promise<ClassifierState> {
  const { backend } = attempt

  if (attempt.resetCacheBeforeLoad) {
    emitStatus(statusListener, {
      phase: 'loading',
      detail: 'Repairing local model cache',
      backend,
      progress: null,
    })
    setCacheHint(false)
    await clearTransformersCache()
  }

  emitStatus(statusListener, {
    phase: 'loading',
    detail: attempt.detail,
    backend,
    progress: null,
  })

  const localFilesOnly = shouldUseLocalFilesOnly()

  fireAndForgetRuntimeLog('info', 'Model classifier load started', {
    location: 'model-load',
    backend,
    localFilesOnly,
    timeoutMs: attempt.timeoutMs,
    cacheReset: attempt.resetCacheBeforeLoad === true,
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
    attempt.timeoutMs,
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

async function getClassifierWithOptions(
  statusListener: StatusListener | undefined,
  options: ModelRuntimeOptions = {},
) {
  await configureEnvironment()

  const mode = shouldUseCompatibilityOnly(options)
    ? 'compatibility-only'
    : 'auto'

  if (classifierPromise && classifierPromiseMode !== mode) {
    fireAndForgetRuntimeLog('warn', 'Discarding model load for new runtime mode', {
      location: 'model-load',
      previousMode: classifierPromiseMode,
      nextMode: mode,
    })
    classifierPromise = null
    classifierPromiseMode = null
  }

  if (!classifierPromise) {
    classifierPromiseMode = mode
    classifierPromise = (async () => {
      const attempts = getBackendLoadAttempts(options)
      const failures: BackendFailure[] = []

      fireAndForgetRuntimeLog('info', 'Model backend attempts prepared', {
        location: 'model-load',
        mode,
        compatibilityReason: options.compatibilityReason,
        attempts: attempts
          .map((attempt) =>
            `${attempt.backend}${attempt.resetCacheBeforeLoad ? ':cache-reset' : ''}`,
          )
          .join(','),
      })

      for (const [index, attempt] of attempts.entries()) {
        try {
          return await createClassifier(attempt, statusListener)
        } catch (error) {
          const timedOut = isTimeoutError(error)
          failures.push({
            backend: attempt.backend,
            reason: error instanceof Error ? error.message : serializeError(error),
            timedOut,
          })
          fireAndForgetRuntimeLog('warn', 'Model classifier backend failed', {
            location: 'model-load',
            backend: attempt.backend,
            cacheReset: attempt.resetCacheBeforeLoad === true,
            timedOut,
            error: serializeError(error),
          })

          const nextAttempt = nextUsableAttempt(attempts, index, timedOut)
          if (nextAttempt) {
            emitStatus(statusListener, {
              phase: 'loading',
              detail: nextAttempt.detail,
              backend: nextAttempt.backend,
              progress: null,
            })
          } else {
            break
          }
        }
      }

      classifierPromise = null
      classifierPromiseMode = null
      throw createModelLoadError(failures, options)
    })()
  }

  return classifierPromise
}

function shouldUseCompatibilityOnly(options: ModelRuntimeOptions): boolean {
  return options.compatibilityOnly === true || isWindowsRuntime()
}

function getBackendLoadAttempts(
  options: ModelRuntimeOptions,
): BackendLoadAttempt[] {
  if (shouldUseCompatibilityOnly(options)) {
    return [
      {
        backend: FALLBACK_BACKEND,
        timeoutMs: WASM_CLASSIFIER_LOAD_TIMEOUT_MS,
        detail: 'Preparing compatibility engine',
      },
      {
        backend: FALLBACK_BACKEND,
        timeoutMs: WASM_CLASSIFIER_LOAD_TIMEOUT_MS,
        resetCacheBeforeLoad: true,
        detail: 'Repairing local model cache',
      },
    ]
  }

  return [
    {
      backend: 'webgpu',
      timeoutMs: WEBGPU_CLASSIFIER_LOAD_TIMEOUT_MS,
      detail: 'Preparing GPU engine',
    },
    {
      backend: FALLBACK_BACKEND,
      timeoutMs: WASM_CLASSIFIER_LOAD_TIMEOUT_MS,
      detail: 'Switching to compatibility engine',
    },
    {
      backend: FALLBACK_BACKEND,
      timeoutMs: WASM_CLASSIFIER_LOAD_TIMEOUT_MS,
      resetCacheBeforeLoad: true,
      detail: 'Repairing local model cache',
    },
  ]
}

function nextUsableAttempt(
  attempts: BackendLoadAttempt[],
  failedIndex: number,
  failedByTimeout: boolean,
): BackendLoadAttempt | null {
  for (const attempt of attempts.slice(failedIndex + 1)) {
    if (failedByTimeout && attempt.resetCacheBeforeLoad) {
      continue
    }

    return attempt
  }

  return null
}

function createModelLoadError(
  failures: BackendFailure[],
  options: ModelRuntimeOptions,
): Error {
  const attempted = failures
    .map((failure) =>
      `${failure.backend.toUpperCase()}${failure.timedOut ? ' timed out' : ` failed: ${failure.reason}`}`,
    )
    .join(' | ')

  const reason = options.compatibilityReason
    ? ` ${options.compatibilityReason}`
    : ''
  const message = isWindowsRuntime()
    ? `Compatibility engine could not initialize on Windows.${reason} Restart the app and try a shorter text or folder. Details: ${attempted}`
    : `Local engine could not initialize. Restart the app and try again. Details: ${attempted}`

  return new Error(message)
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ModelLoadTimeoutError'
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
      const error = new Error(message)
      error.name = 'ModelLoadTimeoutError'
      reject(error)
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
  options: ModelRuntimeOptions = {},
): Promise<PrivacyRunResult> {
  const { classifier, backend } = await getClassifierWithOptions(
    statusListener,
    options,
  )
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
