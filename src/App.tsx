import { ClipboardCopy, Shield, Sparkles, Trash2 } from 'lucide-react'
import {
  type KeyboardEvent,
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'

import {
  APP_DESCRIPTION,
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
          <div className="header-copy">
            <div className="app-kicker-row">
              <span className="app-kicker">Open source</span>
              <span className="app-kicker">Swiss privacy workflows</span>
            </div>

            <div className="brand-lockup">
              <div className="wordmark text-[2.35rem] leading-none text-[color:var(--fg)]">
                {BRAND_NAME}
              </div>
              <div className="app-tag">{PRODUCT_NAME}</div>
            </div>

            <div className="space-y-3">
              <h1 className="serif-display text-[clamp(2.2rem,4.2vw,3.6rem)] leading-[0.92] text-[color:var(--fg)]">
                {PRODUCT_PUBLIC_NAME}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[color:var(--fg-muted)]">
                {APP_SHORT_TAGLINE}
              </p>
              <p className="max-w-2xl text-sm leading-6 text-[color:var(--fg-dim)]">
                {APP_DESCRIPTION}
              </p>
            </div>
          </div>

          <div className="header-side">
            <div className="header-credit">Desktop app by ogram</div>
            <div
              className="status-chip"
              data-state={busy ? 'busy' : modelStatus.phase}
            >
              <span className="status-chip__dot" />
              <span>{modelStatus.detail}</span>
            </div>
          </div>
        </header>

        {error ? <NoticeBar tone="error" text={error} /> : null}
        {!error && notice ? <NoticeBar tone="neutral" text={notice} /> : null}

        <section className="workspace-grid">
          <section className="surface-card">
            <div className="surface-head">
              <div>
                <div className="surface-eyebrow">Source text</div>
                <h2 className="serif-display text-[clamp(2rem,4vw,3.1rem)] leading-[0.92] text-[color:var(--fg)]">
                  Paste or write.
                </h2>
              </div>
              <MetricStrip words={sourceMetrics.words} chars={sourceMetrics.chars} />
            </div>

            <div className="surface-body">
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

            <div className="surface-footer">
              <div className="info-row">
                <div className="flex items-center gap-3 text-sm text-[color:var(--fg-muted)]">
                  <Shield
                    size={15}
                    strokeWidth={1.4}
                    className="text-[color:var(--accent)]"
                  />
                  <span>{APP_LOCAL_PROCESSING_NOTE}</span>
                </div>
                <span className="shortcut-hint">Cmd/Ctrl + Enter to run</span>
              </div>

              <div className="action-row">
                {hasSource ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleReset}
                    disabled={busy}
                  >
                    <Trash2 size={16} strokeWidth={1.4} />
                    Clear
                  </button>
                ) : null}

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleMakePrivate}
                  disabled={!hasSource || busy}
                >
                  <Sparkles size={16} strokeWidth={1.4} />
                  {busy ? 'Making private' : 'Make private'}
                </button>
              </div>
            </div>
          </section>

          <section className="surface-card">
            <div className="surface-head">
              <div>
                <div className="surface-eyebrow">Private text</div>
                <h2 className="serif-display text-[clamp(1.8rem,3.3vw,2.7rem)] leading-[0.94] text-[color:var(--fg)]">
                  Ready to paste.
                </h2>
              </div>
              {result ? (
                <MetricStrip
                  words={resultMetrics.words}
                  chars={resultMetrics.chars}
                />
              ) : null}
            </div>

            <div className="surface-body">
              {busy ? (
                <LoadingState detail={modelStatus.detail} />
              ) : result ? (
                <textarea
                  aria-label="Private text"
                  value={result.redactedText}
                  readOnly
                  spellCheck={false}
                  className="editor-textarea editor-textarea--output"
                />
              ) : (
                <EmptyResultState />
              )}
            </div>

            <div className="surface-footer">
              {result ? (
                <>
                  <div className="text-sm text-[color:var(--fg-muted)]">
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
                      <ClipboardCopy size={16} strokeWidth={1.4} />
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[color:var(--fg-muted)]">
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
    <div className="metric-strip">
      <span>{words.toLocaleString()} words</span>
      <span className="metric-strip__divider">•</span>
      <span>{chars.toLocaleString()} chars</span>
    </div>
  )
}

function LoadingState({ detail }: { detail: string }) {
  return (
    <div className="loading-state">
      <div className="loading-orb" aria-hidden="true" />
      <div className="space-y-2 text-center">
        <div className="surface-eyebrow text-[color:var(--accent)]">
          Working locally
        </div>
        <p className="max-w-[22rem] text-sm text-[color:var(--fg-muted)]">
          {detail}
        </p>
      </div>
    </div>
  )
}

function EmptyResultState() {
  return (
    <div className="empty-state">
      <div className="surface-eyebrow text-[color:var(--fg-dim)]">Waiting</div>
      <p className="max-w-[22rem] text-center text-sm text-[color:var(--fg-muted)]">
        Run the privacy pass and the paste-ready version will appear here.
      </p>
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
