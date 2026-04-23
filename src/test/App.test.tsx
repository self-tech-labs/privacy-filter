// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelStatus, OutputMode, PrivacyRunResult } from '../types/privacy'

const { redactTextMock, getInitialModelStatusMock } = vi.hoisted(() => ({
  redactTextMock: vi.fn(),
  getInitialModelStatusMock: vi.fn(),
}))

vi.mock('../services/modelService', () => ({
  getInitialModelStatus: getInitialModelStatusMock,
  redactText: redactTextMock,
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
    redactTextMock.mockResolvedValue(createResult('Clean <PRIVATE_PERSON>'))
  })

  it('keeps the interface paste-only and shows the public project framing', async () => {
    render(<App />)

    expect(
      screen.queryByRole('button', { name: /choose files/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/privacy filter by ogram/i)).toBeInTheDocument()
    expect(
      screen.getByText(/open-source software\. use it at your own risk/i),
    ).toBeInTheDocument()

    enterSourceText('Alice Example alice@example.com')
    fireEvent.click(screen.getByRole('button', { name: /make private/i }))

    expect(await screen.findByDisplayValue('Clean <PRIVATE_PERSON>')).toBeInTheDocument()
    expect(redactTextMock).toHaveBeenCalledWith(
      'Alice Example alice@example.com',
      'typed',
      expect.any(Function),
    )
    expect(writeTextMock).not.toHaveBeenCalled()
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
    expect(screen.getByText(/the private version appears here/i)).toBeInTheDocument()
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
