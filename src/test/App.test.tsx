// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DevicePerformanceReport } from '../services/devicePerformance'
import type { ModelStatus, OutputMode, PrivacyRunResult } from '../types/privacy'

const {
  createPendingDevicePerformanceReportMock,
  extractPrivacyFileMock,
  fireAndForgetRuntimeLogMock,
  getDevicePerformanceReportMock,
  pickPrivacyFolderMock,
  redactTextMock,
  scanPrivacyFolderMock,
  getInitialModelStatusMock,
  getRuntimeLogPathMock,
  writePrivacyManifestMock,
  writePrivacyOutputMock,
} = vi.hoisted(() => ({
  createPendingDevicePerformanceReportMock: vi.fn(),
  extractPrivacyFileMock: vi.fn(),
  fireAndForgetRuntimeLogMock: vi.fn(),
  getDevicePerformanceReportMock: vi.fn(),
  pickPrivacyFolderMock: vi.fn(),
  redactTextMock: vi.fn(),
  scanPrivacyFolderMock: vi.fn(),
  getInitialModelStatusMock: vi.fn(),
  getRuntimeLogPathMock: vi.fn(),
  writePrivacyManifestMock: vi.fn(),
  writePrivacyOutputMock: vi.fn(),
}))

vi.mock('../services/batchService', () => ({
  extractPrivacyFile: extractPrivacyFileMock,
  pickPrivacyFolder: pickPrivacyFolderMock,
  scanPrivacyFolder: scanPrivacyFolderMock,
  writePrivacyManifest: writePrivacyManifestMock,
  writePrivacyOutput: writePrivacyOutputMock,
}))

vi.mock('../services/modelService', () => ({
  getInitialModelStatus: getInitialModelStatusMock,
  redactText: redactTextMock,
}))

vi.mock('../services/devicePerformance', () => ({
  createPendingDevicePerformanceReport: createPendingDevicePerformanceReportMock,
  getDevicePerformanceReport: getDevicePerformanceReportMock,
}))

vi.mock('../services/runtimeLogging', () => ({
  fireAndForgetRuntimeLog: fireAndForgetRuntimeLogMock,
  getRuntimeLogPath: getRuntimeLogPathMock,
  serializeError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

import App from '../App'

function createResult(
  redactedText: string,
  outputMode: OutputMode = 'typed',
): PrivacyRunResult {
  return {
    redactedText,
    detectedSpans: [
      {
        label: 'private_person',
        start: 0,
        end: 5,
        text: 'Alice',
        placeholder: '<PRIVATE_PERSON>',
        score: 0.99,
      },
    ],
    summary: {
      outputMode,
      spanCount: 1,
      byLabel: { private_person: 1 },
      backend: 'wasm',
    },
  }
}

function enterSourceText(value: string) {
  fireEvent.change(screen.getByLabelText(/source text/i), {
    target: { value },
  })
}

function createPerformanceReport(
  status: DevicePerformanceReport['status'] = 'ok',
): DevicePerformanceReport {
  const warning = status === 'warning'

  return {
    status,
    summary: warning
      ? 'Only 2 GB of device memory is visible; close other apps before processing large files.'
      : 'Device performance looks ready for local redaction.',
    reasons: warning
      ? [
          'Only 2 GB of device memory is visible; close other apps before processing large files.',
        ]
      : [],
    recommendations: warning ? ['Process shorter text first.'] : [],
    signals: {
      cpuThreads: warning ? 2 : 8,
      deviceMemoryGb: warning ? 2 : 8,
      jsHeapLimitMb: 2048,
      benchmarkMs: warning ? 180 : 12,
      webGpu: 'available',
      platform: 'Windows',
      userAgent: 'Mozilla/5.0 Windows',
      isWindows: true,
      online: true,
    },
    startedAt: '2026-06-09T00:00:00.000Z',
    completedAt: '2026-06-09T00:00:01.000Z',
  }
}

describe('App', () => {
  const writeTextMock = vi.fn()
  const initialStatus: ModelStatus = {
    phase: 'idle',
    detail: 'Runs locally after the first model download',
    progress: null,
    backend: null,
    cacheHint: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock.mockResolvedValue(undefined),
      },
    })

    getInitialModelStatusMock.mockReturnValue(initialStatus)
    createPendingDevicePerformanceReportMock.mockReturnValue(
      createPerformanceReport('scanning'),
    )
    getDevicePerformanceReportMock.mockResolvedValue(createPerformanceReport())
    getRuntimeLogPathMock.mockResolvedValue(
      'C:\\Users\\Alice\\AppData\\Local\\ch.ogram.private\\logs\\ogram-private-runtime.log',
    )
    redactTextMock.mockResolvedValue(createResult('Clean <PRIVATE_PERSON>'))
    pickPrivacyFolderMock.mockResolvedValue('/Users/test/input')
    scanPrivacyFolderMock.mockResolvedValue({
      inputRoot: '/Users/test/input',
      files: [
        {
          path: '/Users/test/input/case.pdf',
          relativePath: 'case.pdf',
          outputRelativePath: 'case.pdf.md',
          extension: 'pdf',
          bytes: 2048,
          kind: 'pdf',
        },
      ],
      unsupported: [],
      warnings: [],
    })
    extractPrivacyFileMock.mockResolvedValue({
      sourcePath: '/Users/test/input/case.pdf',
      relativePath: 'case.pdf',
      outputRelativePath: 'case.pdf.md',
      markdown: 'Alice Example',
      extractor: 'pdf-extract',
      warnings: [],
      charCount: 13,
    })
    writePrivacyOutputMock.mockResolvedValue({
      path: '/Users/test/input-private-text/case.pdf.md',
      bytes: 21,
    })
    writePrivacyManifestMock.mockResolvedValue({
      path: '/Users/test/input-private-text/_privacy-filter-manifest.json',
      bytes: 300,
    })
  })

  it('keeps the text workflow as the default screen and shows the public project framing', async () => {
    render(<App />)

    expect(
      screen.queryByRole('button', { name: /choose files/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /^privacy filter$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/local after first download\. use at your own risk/i),
    ).toBeInTheDocument()

    enterSourceText('Alice Example alice@example.com')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))

    expect(await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')).toBeInTheDocument()
    expect(redactTextMock).toHaveBeenCalledWith(
      'Alice Example alice@example.com',
      'typed',
      expect.any(Function),
      {},
    )
    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('switches the app shell to French', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'FR' }))

    expect(document.documentElement.lang).toBe('fr')
    expect(
      screen.getByText(/filtre de confidentialité desktop/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^texte$/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/collez le texte/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rendre privé/i })).toBeInTheDocument()
  })

  it('shows the desktop runtime log path when available', async () => {
    render(<App />)

    expect(
      await screen.findByText(/runtime log: c:\\users\\alice\\appdata/i),
    ).toBeInTheDocument()
  })

  it('alerts when the device performance preflight reports low resources', async () => {
    getDevicePerformanceReportMock.mockResolvedValue(createPerformanceReport('warning'))

    render(<App />)

    expect(await screen.findByText(/performance alert/i)).toHaveTextContent(
      /only 2 gb of device memory/i,
    )

    enterSourceText('Alice Example')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))

    expect(await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')).toBeInTheDocument()
    expect(fireAndForgetRuntimeLogMock).toHaveBeenCalledWith(
      'warn',
      'Execution continuing after performance warning',
      expect.objectContaining({
        operation: 'text-redaction',
      }),
    )
  })

  it('scans a folder and prepares a mirrored private output path', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose source/i }))

    expect(await screen.findByText(/1 file ready/i)).toBeInTheDocument()
    expect(screen.getByText('/Users/test/input')).toBeInTheDocument()
    expect(screen.getByText('/Users/test/input-private-text')).toBeInTheDocument()
    expect(screen.getByText('case.pdf')).toBeInTheDocument()
  })

  it('lists skipped unsupported files after a folder scan', async () => {
    scanPrivacyFolderMock.mockResolvedValueOnce({
      inputRoot: '/Users/test/input',
      files: [
        {
          path: '/Users/test/input/case.pdf',
          relativePath: 'case.pdf',
          outputRelativePath: 'case.pdf.md',
          extension: 'pdf',
          bytes: 2048,
          kind: 'pdf',
        },
      ],
      unsupported: [
        {
          path: '/Users/test/input/archive.zip',
          relativePath: 'archive.zip',
          extension: 'zip',
          reason: 'Unsupported file extension',
        },
        {
          path: '/Users/test/input/nested/photo.png',
          relativePath: 'nested/photo.png',
          extension: 'png',
          reason: 'Unsupported file extension',
        },
      ],
      warnings: [],
    })

    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose source/i }))

    expect(await screen.findByText(/2 unsupported files were skipped/i)).toBeInTheDocument()
    expect(screen.getByText('archive.zip')).toBeInTheDocument()
    expect(screen.getByText('nested/photo.png')).toBeInTheDocument()
    expect(screen.getByText('.ZIP / Unsupported file extension')).toBeInTheDocument()
    expect(screen.getByText('.PNG / Unsupported file extension')).toBeInTheDocument()
    expect(screen.queryByText('2 unsupported files were skipped.')).not.toBeInTheDocument()
  })

  it('folds and expands processed and denied folder file viewers', async () => {
    scanPrivacyFolderMock.mockResolvedValueOnce({
      inputRoot: '/Users/test/input',
      files: [
        {
          path: '/Users/test/input/case.pdf',
          relativePath: 'case.pdf',
          outputRelativePath: 'case.pdf.md',
          extension: 'pdf',
          bytes: 2048,
          kind: 'pdf',
        },
      ],
      unsupported: [
        {
          path: '/Users/test/input/archive.zip',
          relativePath: 'archive.zip',
          extension: 'zip',
          reason: 'Unsupported file extension',
        },
      ],
      warnings: [],
    })

    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose source/i }))
    await screen.findByText(/1 file ready/i)

    fireEvent.click(
      screen.getByRole('button', {
        name: /collapse files being processed/i,
      }),
    )
    expect(screen.queryByText('case.pdf')).not.toBeInTheDocument()
    expect(screen.getByText(/1 processable file hidden/i)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /expand files being processed/i,
      }),
    )
    expect(screen.getByText('case.pdf')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /collapse denied files/i,
      }),
    )
    expect(screen.queryByText('archive.zip')).not.toBeInTheDocument()
    expect(screen.getByText(/1 denied file hidden/i)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /expand denied files/i,
      }),
    )
    expect(screen.getByText('archive.zip')).toBeInTheDocument()
  })

  it('runs folder processing through extraction, redaction, output, and manifest writes', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /folder/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose source/i }))
    await screen.findByText(/1 file ready/i)

    fireEvent.click(screen.getByRole('button', { name: /run folder/i }))

    expect(await screen.findByText(/folder run completed/i)).toBeInTheDocument()
    expect(extractPrivacyFileMock).toHaveBeenCalledWith(
      '/Users/test/input',
      '/Users/test/input/case.pdf',
    )
    expect(redactTextMock).toHaveBeenCalledWith(
      'Alice Example',
      'typed',
      expect.any(Function),
      {},
    )
    expect(writePrivacyOutputMock).toHaveBeenCalledWith(
      '/Users/test/input-private-text',
      'case.pdf.md',
      'Clean <PRIVATE_PERSON>',
    )
    expect(writePrivacyManifestMock).toHaveBeenCalledWith(
      '/Users/test/input-private-text',
      expect.objectContaining({
        inputRoot: '/Users/test/input',
        outputRoot: '/Users/test/input-private-text',
      }),
    )
  })

  it('copies the private result only when requested', async () => {
    render(<App />)

    enterSourceText('Alice Example')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))
    await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('Clean <PRIVATE_PERSON>')
    })
  })

  it('shows a generic local loading state while the engine prepares', async () => {
    let resolveRun!: (value: PrivacyRunResult) => void

    redactTextMock.mockImplementationOnce(
      (
        _text: string,
        _mode: OutputMode,
        statusListener?: (status: ModelStatus) => void,
      ) =>
        new Promise<PrivacyRunResult>((resolve) => {
          resolveRun = resolve
          statusListener?.({
            phase: 'loading',
            detail: 'Preparing local engine',
            progress: null,
            backend: 'wasm',
            cacheHint: false,
          })
        }),
    )

    render(<App />)

    enterSourceText('Alice Example')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))

    expect(
      (await screen.findAllByText('Preparing local engine')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/42%/i)).not.toBeInTheDocument()

    resolveRun(createResult('Prepared <PRIVATE_PERSON>'))

    expect(await screen.findByDisplayValue('Prepared <PRIVATE_PERSON>')).toBeInTheDocument()
  })

  it('clears both panes without leaving the current screen', async () => {
    render(<App />)

    enterSourceText('Alice Example')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))
    await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/source text/i)).toHaveValue('')
    })
    expect(screen.getAllByText(/private output appears here/i).length).toBeGreaterThan(0)
  })

  it('shows a manual copy hint when clipboard access is denied', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'))

    render(<App />)

    enterSourceText('Alice Example')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))
    await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))

    expect(
      await screen.findByText(/select the private text and press cmd\+c/i),
    ).toBeInTheDocument()
  })
})
