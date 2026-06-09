import {
  fireAndForgetRuntimeLog,
  serializeError,
} from './runtimeLogging'

export type DevicePerformanceStatus = 'scanning' | 'ok' | 'warning' | 'unknown'

export interface DevicePerformanceSignals {
  cpuThreads: number | null
  deviceMemoryGb: number | null
  jsHeapLimitMb: number | null
  benchmarkMs: number | null
  webGpu: 'available' | 'unavailable' | 'unknown'
  platform: string
  userAgent: string
  isWindows: boolean
  online: boolean | null
}

export interface DevicePerformanceReport {
  status: DevicePerformanceStatus
  summary: string
  reasons: string[]
  recommendations: string[]
  signals: DevicePerformanceSignals
  startedAt: string
  completedAt: string | null
}

interface NavigatorWithDeviceSignals extends Navigator {
  deviceMemory?: number
  userAgentData?: {
    platform?: string
  }
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    jsHeapSizeLimit?: number
  }
}

let reportPromise: Promise<DevicePerformanceReport> | null = null

export function createPendingDevicePerformanceReport(): DevicePerformanceReport {
  return {
    status: 'scanning',
    summary: 'Checking device performance before model execution.',
    reasons: [],
    recommendations: [],
    signals: emptySignals(),
    startedAt: new Date().toISOString(),
    completedAt: null,
  }
}

export function getDevicePerformanceReport(): Promise<DevicePerformanceReport> {
  if (!reportPromise) {
    reportPromise = scanDevicePerformance()
  }

  return reportPromise
}

async function scanDevicePerformance(): Promise<DevicePerformanceReport> {
  const startedAt = new Date().toISOString()

  try {
    const signals = await collectSignals()
    const reasons = performanceReasons(signals)
    const recommendations = performanceRecommendations(signals)
    const status: DevicePerformanceStatus =
      reasons.length > 0 ? 'warning' : 'ok'
    const summary =
      status === 'warning'
        ? reasons.join(' ')
        : 'Device performance looks ready for local redaction.'

    const report: DevicePerformanceReport = {
      status,
      summary,
      reasons,
      recommendations,
      signals,
      startedAt,
      completedAt: new Date().toISOString(),
    }

    fireAndForgetRuntimeLog(
      status === 'warning' ? 'warn' : 'info',
      'Device performance preflight completed',
      {
        location: 'device-performance',
        status,
        summary,
        recommendations: recommendations.join(' '),
        ...signals,
      },
    )

    return report
  } catch (error) {
    const report: DevicePerformanceReport = {
      status: 'unknown',
      summary:
        'Device performance could not be checked. The app will continue in compatibility mode if needed.',
      reasons: [],
      recommendations: ['Close other heavy apps if model loading feels slow.'],
      signals: emptySignals(),
      startedAt,
      completedAt: new Date().toISOString(),
    }

    fireAndForgetRuntimeLog('warn', 'Device performance preflight failed', {
      location: 'device-performance',
      error: serializeError(error),
    })

    return report
  }
}

async function collectSignals(): Promise<DevicePerformanceSignals> {
  const nav = getNavigator()
  const perf = getPerformance()
  const platform =
    nav?.userAgentData?.platform || nav?.platform || inferPlatform(nav?.userAgent)
  const userAgent = nav?.userAgent ?? ''

  return {
    cpuThreads: positiveNumberOrNull(nav?.hardwareConcurrency),
    deviceMemoryGb: positiveNumberOrNull(nav?.deviceMemory),
    jsHeapLimitMb: heapLimitMb(perf),
    benchmarkMs: runCpuBenchmark(perf),
    webGpu: await detectWebGpu(nav),
    platform,
    userAgent,
    isWindows: /win/i.test(platform) || /windows/i.test(userAgent),
    online: typeof nav?.onLine === 'boolean' ? nav.onLine : null,
  }
}

function performanceReasons(signals: DevicePerformanceSignals): string[] {
  const reasons: string[] = []

  if (signals.cpuThreads !== null && signals.cpuThreads < 4) {
    reasons.push(
      `Only ${signals.cpuThreads} CPU threads are visible; local redaction can feel slow.`,
    )
  }

  if (signals.deviceMemoryGb !== null && signals.deviceMemoryGb < 4) {
    reasons.push(
      `Only ${signals.deviceMemoryGb} GB of device memory is visible; close other apps before processing large files.`,
    )
  }

  if (signals.jsHeapLimitMb !== null && signals.jsHeapLimitMb < 1024) {
    reasons.push(
      `The WebView JavaScript heap limit is about ${signals.jsHeapLimitMb} MB; very large files may fail.`,
    )
  }

  if (signals.benchmarkMs !== null && signals.benchmarkMs > 140) {
    reasons.push(
      `The startup CPU probe took ${signals.benchmarkMs.toFixed(0)} ms, which is slower than expected.`,
    )
  }

  return reasons
}

function performanceRecommendations(
  signals: DevicePerformanceSignals,
): string[] {
  const recommendations: string[] = []

  if (signals.deviceMemoryGb !== null && signals.deviceMemoryGb < 8) {
    recommendations.push('Process shorter text or smaller folders first.')
  }

  if (signals.webGpu !== 'available') {
    recommendations.push('Compatibility inference will be used if GPU acceleration is unavailable.')
  }

  if (signals.isWindows) {
    recommendations.push('On Windows, keep WebView2 and graphics drivers up to date.')
  }

  return recommendations
}

function runCpuBenchmark(perf: PerformanceWithMemory | null): number | null {
  if (!perf?.now) {
    return null
  }

  const started = perf.now()
  let checksum = 0

  for (let index = 0; index < 350_000; index += 1) {
    checksum = (checksum + Math.sqrt((index % 97) + 1)) % 100_000
  }

  if (checksum < 0) {
    return null
  }

  return perf.now() - started
}

async function detectWebGpu(
  nav: NavigatorWithDeviceSignals | null,
): Promise<DevicePerformanceSignals['webGpu']> {
  if (!nav?.gpu?.requestAdapter) {
    return 'unavailable'
  }

  try {
    const adapter = await withTimeout(nav.gpu.requestAdapter(), 1200, null)
    return adapter ? 'available' : 'unavailable'
  } catch {
    return 'unknown'
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timeoutId))
  })
}

function heapLimitMb(perf: PerformanceWithMemory | null): number | null {
  const bytes = positiveNumberOrNull(perf?.memory?.jsHeapSizeLimit)
  return bytes === null ? null : Math.round(bytes / 1024 / 1024)
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

function getNavigator(): NavigatorWithDeviceSignals | null {
  return typeof navigator === 'undefined'
    ? null
    : (navigator as NavigatorWithDeviceSignals)
}

function getPerformance(): PerformanceWithMemory | null {
  return typeof performance === 'undefined'
    ? null
    : (performance as PerformanceWithMemory)
}

function inferPlatform(userAgent: string | undefined): string {
  if (!userAgent) {
    return 'unknown'
  }

  if (/windows/i.test(userAgent)) {
    return 'Windows'
  }

  if (/macintosh|mac os/i.test(userAgent)) {
    return 'macOS'
  }

  if (/linux/i.test(userAgent)) {
    return 'Linux'
  }

  return 'unknown'
}

function emptySignals(): DevicePerformanceSignals {
  return {
    cpuThreads: null,
    deviceMemoryGb: null,
    jsHeapLimitMb: null,
    benchmarkMs: null,
    webGpu: 'unknown',
    platform: 'unknown',
    userAgent: '',
    isWindows: false,
    online: null,
  }
}
