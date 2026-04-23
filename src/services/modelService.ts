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
  const modelOutput = await classifier(sourceText, { aggregation_strategy: 'simple' })

  emitStatus(statusListener, {
    phase: 'ready',
    detail: 'Local engine ready',
    backend,
    progress: null,
    cacheHint: true,
  })

  return buildPrivacyRunResult(sourceText, modelOutput, outputMode, backend)
}
