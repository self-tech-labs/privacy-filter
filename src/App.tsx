import { ClipboardCopy, Shield, Sparkles, Trash2 } from 'lucide-react'
import {
  type KeyboardEvent,
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'

import {
  APP_LOCAL_PROCESSING_NOTE,
  APP_SHORT_TAGLINE,
  BRAND_NAME,
  LEGAL_DISCLAIMER_SHORT,
  PRODUCT_NAME,
  PRODUCT_PUBLIC_NAME,
} from './content/projectContent'
import { getInitialModelStatus, redactText } from './services/modelService'
import type { ModelStatus, PrivacyRunResult } from './types/privacy'

function App() {
  const [sourceText, setSourceText] = useState('')
  const [result, setResult] = useState<PrivacyRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [modelStatus, setModelStatus] =
    useState<ModelStatus>(getInitialModelStatus())

  const deferredSourceText = useDeferredValue(sourceText)
  const deferredResultText = useDeferredValue(result?.redactedText ?? '')
  const hasSource = sourceText.trim().length > 0

  const sourceMetrics = useMemo(
    () => buildTextMetrics(deferredSourceText),
    [deferredSourceText],
  )
  const resultMetrics = useMemo(
    () => buildTextMetrics(deferredResultText),
    [deferredResultText],
  )

  function applySourceText(nextText: string) {
    startTransition(() => {
      setSourceText(nextText)
      setResult(null)
      setError(null)
      setNotice(null)
    })
  }

  function showTransientNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => {
      setNotice((current) => (current === message ? null : current))
    }, 1800)
  }

  async function handleCopy() {
    if (!result) {
      return
    }

    try {
      await navigator.clipboard.writeText(result.redactedText)
      setError(null)
      showTransientNotice('Copied to clipboard')
    } catch {
      setError(null)
      setNotice('Copy is unavailable here. Select the private text and press Cmd+C.')
    }
  }

  async function handleMakePrivate() {
    const cleaned = sourceText.trim()

    if (!cleaned || busy) {
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const nextResult = await redactText(cleaned, 'typed', setModelStatus)
      startTransition(() => {
        setResult(nextResult)
      })
    } catch (redactionError) {
      const message =
        redactionError instanceof Error
          ? redactionError.message
          : 'Privacy pass failed.'

      setModelStatus((status) => ({
        ...status,
        phase: 'error',
        detail: 'Local engine error',
      }))
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function handleReset() {
    startTransition(() => {
      setSourceText('')
      setResult(null)
      setError(null)
      setNotice(null)
      setModelStatus(getInitialModelStatus())
    })
  }

  function handleSourceKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleMakePrivate()
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-cluster">
            <div className="wordmark">{BRAND_NAME}</div>
            <div className="brand-rule" aria-hidden="true" />
            <div className="brand-copy">
              <p className="product-label">{PRODUCT_NAME}</p>
              <h1>{PRODUCT_PUBLIC_NAME}</h1>
              <p>{APP_SHORT_TAGLINE}</p>
            </div>
          </div>

          <div className="header-side">
            <div className="header-credit">Desktop app by ogram</div>
            <div
              className="status-chip"
              data-state={busy ? 'busy' : modelStatus.phase}
              role="status"
              aria-live="polite"
            >
              <span className="status-chip__dot" />
              <span>{modelStatus.detail}</span>
            </div>
          </div>
        </header>

        <section className="context-strip" aria-label="Workflow context">
          <span>Open source</span>
          <span>Swiss privacy workflows</span>
          <span>{APP_LOCAL_PROCESSING_NOTE}</span>
        </section>

        {error ? <NoticeBar tone="error" text={error} /> : null}
        {!error && notice ? <NoticeBar tone="neutral" text={notice} /> : null}

        <section className="workspace-grid" aria-label="Privacy filter workspace">
          <section className="work-pane" aria-labelledby="source-pane-title">
            <div className="pane-header">
              <div className="pane-heading">
                <p className="surface-eyebrow">Source text</p>
                <h2 id="source-pane-title">Working draft</h2>
              </div>
              <MetricStrip words={sourceMetrics.words} chars={sourceMetrics.chars} />
            </div>

            <div className="editor-shell">
              <textarea
                aria-label="Source text"
                value={sourceText}
                onChange={(event) => applySourceText(event.target.value)}
                onKeyDown={handleSourceKeyDown}
                placeholder="Paste the material you want to make private."
                spellCheck={false}
                className="editor-textarea"
              />
            </div>

            <div className="pane-footer">
              <div className="local-note">
                <Shield size={15} strokeWidth={1.4} aria-hidden="true" />
                <span>{APP_LOCAL_PROCESSING_NOTE}</span>
              </div>

              <div className="action-row">
                {hasSource ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleReset}
                    disabled={busy}
                  >
                    <Trash2 size={16} strokeWidth={1.4} aria-hidden="true" />
                    <span>Clear</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleMakePrivate}
                  disabled={!hasSource || busy}
                >
                  <Sparkles size={16} strokeWidth={1.4} aria-hidden="true" />
                  <span>{busy ? 'Making private' : 'Make private'}</span>
                </button>
              </div>
            </div>
          </section>

          <section className="work-pane" aria-labelledby="private-pane-title">
            <div className="pane-header">
              <div className="pane-heading">
                <p className="surface-eyebrow">Private text</p>
                <h2 id="private-pane-title">Clean draft</h2>
              </div>
              {result ? (
                <MetricStrip
                  words={resultMetrics.words}
                  chars={resultMetrics.chars}
                />
              ) : null}
            </div>

            <div className="editor-shell editor-shell--output">
              {busy ? (
                <LoadingState detail={modelStatus.detail} />
              ) : result ? (
                <textarea
                  aria-label="Private text"
                  value={result.redactedText}
                  readOnly
                  spellCheck={false}
                  className="editor-textarea editor-textarea--readonly"
                />
              ) : (
                <EmptyResultState />
              )}
            </div>

            <div className="pane-footer">
              {result ? (
                <>
                  <div className="result-summary">
                    {result.summary.spanCount.toLocaleString()} private replacement
                    {result.summary.spanCount === 1 ? '' : 's'} with the local{' '}
                    {result.summary.backend.toUpperCase()} engine.
                  </div>
                  <div className="action-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleCopy}
                    >
                      <ClipboardCopy size={16} strokeWidth={1.4} aria-hidden="true" />
                      <span>Copy</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="result-summary">
                  The private version appears here.
                </div>
              )}
            </div>
          </section>
        </section>

        <footer className="legal-strip" aria-label="Legal disclaimer">
          <span className="legal-strip__label">Open source</span>
          <p>{LEGAL_DISCLAIMER_SHORT}</p>
        </footer>
      </div>
    </main>
  )
}

function MetricStrip({ words, chars }: { words: number; chars: number }) {
  return (
    <div className="metric-strip" aria-label={`${words} words, ${chars} characters`}>
      <span>{words.toLocaleString()} words</span>
      <span className="metric-strip__divider">/</span>
      <span>{chars.toLocaleString()} chars</span>
    </div>
  )
}

function LoadingState({ detail }: { detail: string }) {
  return (
    <div className="loading-state">
      <div className="surface-eyebrow">Local engine</div>
      <p>{detail}</p>
      <div className="loading-rail" aria-hidden="true">
        <span />
      </div>
    </div>
  )
}

function EmptyResultState() {
  return (
    <div className="empty-state">
      <div className="surface-eyebrow">Waiting</div>
      <p>Run the privacy pass and the paste-ready version will appear here.</p>
    </div>
  )
}

function NoticeBar({
  tone,
  text,
}: {
  tone: 'error' | 'neutral'
  text: string
}) {
  return (
    <div className={`notice-bar ${tone === 'error' ? 'notice-bar--error' : ''}`}>
      <span className="notice-bar__dot" />
      <span>{text}</span>
    </div>
  )
}

function buildTextMetrics(text: string) {
  const trimmed = text.trim()

  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
  }
}

export default App
