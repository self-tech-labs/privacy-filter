import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/runtimeLogging', () => ({
  fireAndForgetRuntimeLog: vi.fn(),
  serializeError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

describe('device performance preflight', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('treats two visible CPU threads as a Windows advisory instead of an alert', async () => {
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 2,
      onLine: true,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 Windows',
    })

    const { getDevicePerformanceReport } = await import(
      '../services/devicePerformance'
    )

    const report = await getDevicePerformanceReport()

    expect(report.status).toBe('ok')
    expect(report.reasons).toEqual([])
    expect(report.recommendations).toContain(
      'Only 2 CPU threads are visible; the app will prefer compatibility mode.',
    )
  })
})
