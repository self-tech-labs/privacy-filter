import { invoke, isTauri } from '@tauri-apps/api/core'
import { appLogDir } from '@tauri-apps/api/path'

type RuntimeLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

type RuntimeLogContext = Record<string, unknown>

const LOG_FILE_NAME = 'ogram-private-runtime.log'
const LOG_LEVELS: Record<RuntimeLogLevel, number> = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
}

let globalLoggingInstalled = false
let tauriLogUnavailable = false

export function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message || error.name
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function stringifyContextValue(value: unknown): string {
  if (value instanceof Error) {
    return serializeError(value)
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeContext(context: RuntimeLogContext | undefined) {
  if (!context) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, stringifyContextValue(value)]),
  )
}

function writeBrowserConsole(
  level: RuntimeLogLevel,
  message: string,
  context?: RuntimeLogContext,
) {
  if (level === 'error') {
    console.error(`[privacy-filter] ${message}`, context ?? '')
    return
  }

  if (level === 'warn') {
    console.warn(`[privacy-filter] ${message}`, context ?? '')
    return
  }

  console.info(`[privacy-filter] ${message}`, context ?? '')
}

export async function logRuntimeEvent(
  level: RuntimeLogLevel,
  message: string,
  context?: RuntimeLogContext,
): Promise<void> {
  const keyValues = normalizeContext(context)
  const location =
    typeof context?.location === 'string' ? context.location : 'frontend'

  if (!isTauri()) {
    writeBrowserConsole(level, message, context)
    return
  }

  try {
    await invoke('plugin:log|log', {
      level: LOG_LEVELS[level],
      message,
      location,
      file: null,
      line: null,
      keyValues,
    })
  } catch (error) {
    if (!tauriLogUnavailable) {
      tauriLogUnavailable = true
      writeBrowserConsole('warn', 'Tauri runtime log bridge is unavailable', {
        error: serializeError(error),
      })
    }
  }
}

export function fireAndForgetRuntimeLog(
  level: RuntimeLogLevel,
  message: string,
  context?: RuntimeLogContext,
): void {
  void logRuntimeEvent(level, message, context).catch(() => {
    // Logging must never become a runtime failure source.
  })
}

export function installGlobalRuntimeLogging(): void {
  if (globalLoggingInstalled || typeof window === 'undefined') {
    return
  }

  globalLoggingInstalled = true

  window.addEventListener('error', (event) => {
    fireAndForgetRuntimeLog('error', 'Unhandled frontend error', {
      location: 'window.error',
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: serializeError(event.error),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    fireAndForgetRuntimeLog('error', 'Unhandled promise rejection', {
      location: 'window.unhandledrejection',
      reason: serializeError(event.reason),
    })
  })
}

export async function getRuntimeLogPath(): Promise<string | null> {
  if (!isTauri()) {
    return null
  }

  try {
    const directory = await appLogDir()
    const separator = directory.includes('\\') ? '\\' : '/'
    return `${directory.replace(/[\\/]+$/, '')}${separator}${LOG_FILE_NAME}`
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not resolve runtime log path', {
      location: 'runtime-log-path',
      error: serializeError(error),
    })
    return null
  }
}
