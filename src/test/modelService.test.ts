import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PipelineOptions = {
  device?: string
}

let pipelineMock: ReturnType<typeof vi.fn>
let clearTransformersCacheMock: ReturnType<typeof vi.fn>
let localStorageStore: Map<string, string>

function installBrowserGlobals(platform = 'Win32', userAgent = 'Mozilla/5.0 Windows') {
  localStorageStore = new Map<string, string>()

  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageStore.set(key, value)
      }),
    },
  })

  vi.stubGlobal('navigator', {
    onLine: true,
    platform,
    userAgent,
  })
}

async function importModelService() {
  vi.doMock('@huggingface/transformers', () => ({
    env: {
      allowLocalModels: false,
      allowRemoteModels: true,
      useBrowserCache: false,
      useFSCache: false,
      useCustomCache: false,
      customCache: null,
      backends: {
        onnx: {
          wasm: {},
        },
      },
    },
    pipeline: pipelineMock,
  }))

  vi.doMock('../services/runtimeLogging', () => ({
    fireAndForgetRuntimeLog: vi.fn(),
    serializeError: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  }))

  vi.doMock('../services/transformersCache', () => ({
    clearTransformersCache: clearTransformersCacheMock,
    createTauriCustomCache: vi.fn(() => ({
      delete: vi.fn(),
      match: vi.fn(),
      put: vi.fn(),
    })),
  }))

  return import('../services/modelService')
}

function pipelineDevices() {
  return pipelineMock.mock.calls.map((call) => {
    const options = call[2] as PipelineOptions
    return options.device
  })
}

describe('model service backend fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    pipelineMock = vi.fn()
    clearTransformersCacheMock = vi.fn().mockResolvedValue(true)
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('does not fall through to WebGPU on Windows after WASM load failures', async () => {
    installBrowserGlobals()
    pipelineMock.mockRejectedValue(new Error('WASM unavailable'))

    const { redactText } = await importModelService()

    await expect(redactText('Alice Example', 'typed')).rejects.toThrow(
      /Compatibility engine could not initialize on Windows/,
    )

    expect(pipelineDevices()).toEqual(['wasm', 'wasm'])
    expect(clearTransformersCacheMock).toHaveBeenCalledTimes(1)
  })

  it('falls back from WebGPU to WASM outside Windows', async () => {
    installBrowserGlobals('MacIntel', 'Mozilla/5.0 Macintosh')
    pipelineMock.mockImplementation(
      async (_task: unknown, _model: unknown, options: PipelineOptions) => {
        if (options.device === 'webgpu') {
          throw new Error('WebGPU unavailable')
        }

        return async () => [
          {
            word: 'Alice',
            entity_group: 'private_person',
            start: 0,
            end: 5,
            score: 0.99,
          },
        ]
      },
    )

    const { redactText } = await importModelService()
    const result = await redactText('Alice Example', 'typed')

    expect(pipelineDevices()).toEqual(['webgpu', 'wasm'])
    expect(result.summary.backend).toBe('wasm')
    expect(clearTransformersCacheMock).not.toHaveBeenCalled()
  })
})
