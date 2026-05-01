import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  FolderInput,
  FolderOutput,
  Play,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  type KeyboardEvent,
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
} from 'react'

import {
  BRAND_NAME,
  PRODUCT_NAME,
  PRODUCT_PUBLIC_NAME,
} from './content/projectContent'
import {
  extractPrivacyFile,
  pickPrivacyFolder,
  scanPrivacyFolder,
  writePrivacyManifest,
  writePrivacyOutput,
} from './services/batchService'
import { getInitialModelStatus, redactText } from './services/modelService'
import type {
  ModelStatus,
  PrivacyFolderFile,
  PrivacyFolderScan,
  PrivacyRunResult,
  UnsupportedPrivacyFile,
} from './types/privacy'

type WorkspaceMode = 'text' | 'folder'
type FolderRunStatus = 'idle' | 'scanning' | 'ready' | 'running' | 'complete'
type BatchItemStatus =
  | 'queued'
  | 'extracting'
  | 'redacting'
  | 'writing'
  | 'done'
  | 'error'

interface BatchItem extends PrivacyFolderFile {
  status: BatchItemStatus
  extractor?: string
  warnings: string[]
  spanCount: number | null
  outputPath?: string
  error?: string
}

interface BatchManifestEntry {
  sourcePath: string
  relativePath: string
  outputRelativePath: string
  status: 'done' | 'error'
  outputPath?: string
  extractor?: string
  charCount?: number
  replacements?: number
  byLabel?: Record<string, number>
  backend?: string
  warnings: string[]
  error?: string
}

function App() {
  const [mode, setMode] = useState<WorkspaceMode>('text')
  const [sourceText, setSourceText] = useState('')
  const [result, setResult] = useState<PrivacyRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [modelStatus, setModelStatus] =
    useState<ModelStatus>(getInitialModelStatus())
  const [folderStatus, setFolderStatus] = useState<FolderRunStatus>('idle')
  const [inputFolder, setInputFolder] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [folderScan, setFolderScan] = useState<PrivacyFolderScan | null>(null)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [manifestPath, setManifestPath] = useState<string | null>(null)

  const deferredSourceText = useDeferredValue(sourceText)
  const deferredResultText = useDeferredValue(result?.redactedText ?? '')
  const hasSource = sourceText.trim().length > 0
  const folderBusy = folderStatus === 'scanning' || folderStatus === 'running'
  const appBusy = busy || folderBusy

  const sourceMetrics = useMemo(
    () => buildTextMetrics(deferredSourceText),
    [deferredSourceText],
  )
  const resultMetrics = useMemo(
    () => buildTextMetrics(deferredResultText),
    [deferredResultText],
  )
  const batchTotals = useMemo(() => summarizeBatch(batchItems), [batchItems])

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

  function updateBatchItem(relativePath: string, patch: Partial<BatchItem>) {
    setBatchItems((items) =>
      items.map((item) =>
        item.relativePath === relativePath ? { ...item, ...patch } : item,
      ),
    )
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

  async function handleChooseInputFolder() {
    if (folderBusy) {
      return
    }

    setError(null)
    setNotice(null)

    try {
      const selected = await pickPrivacyFolder('Choose source folder')
      if (!selected) {
        return
      }

      setMode('folder')
      setFolderStatus('scanning')
      setManifestPath(null)

      const scan = await scanPrivacyFolder(selected)
      setInputFolder(scan.inputRoot)
      setOutputFolder(defaultOutputFolder(scan.inputRoot))
      setFolderScan(scan)
      setBatchItems(scan.files.map(createQueuedItem))
      setFolderStatus('ready')
      setNotice(
        scan.files.length > 0
          ? `${scan.files.length.toLocaleString()} files ready`
          : 'No supported files found in that folder',
      )
    } catch (folderError) {
      setFolderStatus('idle')
      setError(
        folderError instanceof Error
          ? folderError.message
          : 'Could not scan that folder.',
      )
    }
  }

  async function handleChooseOutputFolder() {
    if (folderBusy) {
      return
    }

    setError(null)
    setNotice(null)

    try {
      const selected = await pickPrivacyFolder('Choose private output folder')
      if (selected) {
        setOutputFolder(selected)
      }
    } catch (folderError) {
      setError(
        folderError instanceof Error
          ? folderError.message
          : 'Could not choose an output folder.',
      )
    }
  }

  async function handleRunFolder() {
    if (!folderScan || !outputFolder || folderBusy || folderScan.files.length === 0) {
      return
    }

    const startedAt = new Date().toISOString()
    const entries: BatchManifestEntry[] = []
    let failed = false

    setError(null)
    setNotice(null)
    setManifestPath(null)
    setFolderStatus('running')
    setBatchItems(folderScan.files.map(createQueuedItem))

    for (const file of folderScan.files) {
      try {
        updateBatchItem(file.relativePath, { status: 'extracting' })
        const extracted = await extractPrivacyFile(folderScan.inputRoot, file.path)

        updateBatchItem(file.relativePath, {
          status: 'redacting',
          extractor: extracted.extractor,
          warnings: extracted.warnings,
        })
        const privacyResult = await redactText(
          extracted.markdown,
          'typed',
          setModelStatus,
        )

        updateBatchItem(file.relativePath, {
          status: 'writing',
          spanCount: privacyResult.summary.spanCount,
        })
        const written = await writePrivacyOutput(
          outputFolder,
          extracted.outputRelativePath,
          privacyResult.redactedText,
        )

        entries.push({
          sourcePath: extracted.sourcePath,
          relativePath: extracted.relativePath,
          outputRelativePath: extracted.outputRelativePath,
          status: 'done',
          outputPath: written.path,
          extractor: extracted.extractor,
          charCount: extracted.charCount,
          replacements: privacyResult.summary.spanCount,
          byLabel: privacyResult.summary.byLabel,
          backend: privacyResult.summary.backend,
          warnings: extracted.warnings,
        })
        updateBatchItem(file.relativePath, {
          status: 'done',
          outputPath: written.path,
          spanCount: privacyResult.summary.spanCount,
        })
      } catch (itemError) {
        failed = true
        const message =
          itemError instanceof Error ? itemError.message : 'File processing failed.'
        entries.push({
          sourcePath: file.path,
          relativePath: file.relativePath,
          outputRelativePath: file.outputRelativePath,
          status: 'error',
          warnings: [],
          error: message,
        })
        updateBatchItem(file.relativePath, {
          status: 'error',
          error: message,
        })
      }
    }

    try {
      const manifest = await writePrivacyManifest(outputFolder, {
        app: PRODUCT_PUBLIC_NAME,
        createdAt: new Date().toISOString(),
        startedAt,
        inputRoot: folderScan.inputRoot,
        outputRoot: outputFolder,
        files: entries,
        unsupported: folderScan.unsupported,
        warnings: folderScan.warnings,
      })
      setManifestPath(manifest.path)
      setFolderStatus('complete')
      setNotice(
        failed
          ? 'Folder run completed with file-level errors'
          : 'Folder run completed',
      )
    } catch (manifestError) {
      setFolderStatus('complete')
      setError(
        manifestError instanceof Error
          ? manifestError.message
          : 'Could not write the manifest.',
      )
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
            <div className="brand-copy">
              <p className="product-label">Desktop privacy filter</p>
              <h1>{PRODUCT_NAME}</h1>
            </div>
          </div>

          <div className="header-controls">
            <div className="mode-switch" role="tablist" aria-label="Privacy workflow">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'text'}
                className={
                  mode === 'text' ? 'mode-switch__tab is-active' : 'mode-switch__tab'
                }
                onClick={() => setMode('text')}
                disabled={appBusy}
              >
                <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Text</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'folder'}
                className={
                  mode === 'folder'
                    ? 'mode-switch__tab is-active'
                    : 'mode-switch__tab'
                }
                onClick={() => setMode('folder')}
                disabled={appBusy}
              >
                <FolderInput size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>Folder</span>
              </button>
            </div>

            <div
              className="status-chip"
              data-state={appBusy ? 'busy' : modelStatus.phase}
              role="status"
              aria-live="polite"
            >
              <span className="status-chip__dot" />
              <span>{folderBusy ? folderStatusLabel(folderStatus) : modelStatus.detail}</span>
            </div>
          </div>
        </header>

        {error ? <NoticeBar tone="error" text={error} /> : null}
        {!error && notice ? <NoticeBar tone="neutral" text={notice} /> : null}

        {mode === 'text' ? (
          <section className="workspace-grid" aria-label="Privacy filter workspace">
            <section className="work-pane" aria-labelledby="source-pane-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">Input</p>
                  <h2 id="source-pane-title">Source</h2>
                </div>
                <MetricStrip
                  words={sourceMetrics.words}
                  chars={sourceMetrics.chars}
                />
              </div>

              <div className="editor-shell">
                <textarea
                  aria-label="Source text"
                  value={sourceText}
                  onChange={(event) => applySourceText(event.target.value)}
                  onKeyDown={handleSourceKeyDown}
                  placeholder="Paste text to redact."
                  spellCheck={false}
                  className="editor-textarea"
                />
              </div>

              <div className="pane-footer">
                <div className="local-note">
                  <Shield size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>Local on this device</span>
                </div>

                <div className="action-row">
                  {hasSource ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleReset}
                      disabled={busy}
                    >
                      <Trash2 size={15} strokeWidth={1.7} aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleMakePrivate}
                    disabled={!hasSource || busy}
                  >
                    <Sparkles size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{busy ? 'Making private' : 'Make private'}</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="work-pane" aria-labelledby="private-pane-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">Output</p>
                  <h2 id="private-pane-title">Private</h2>
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
                      {result.summary.spanCount.toLocaleString()} replacement
                      {result.summary.spanCount === 1 ? '' : 's'} /{' '}
                      {result.summary.backend.toUpperCase()}
                    </div>
                    <div className="action-row">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={handleCopy}
                      >
                        <ClipboardCopy
                          size={15}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <span>Copy</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="result-summary">
                    Ready
                  </div>
                )}
              </div>
            </section>
          </section>
        ) : (
          <section className="workspace-grid" aria-label="Folder privacy workspace">
            <section className="work-pane" aria-labelledby="folder-source-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">Input</p>
                  <h2 id="folder-source-title">Source</h2>
                </div>
                <MetricStrip
                  words={folderScan?.files.length ?? 0}
                  chars={folderScan?.unsupported.length ?? 0}
                  labels={['files', 'skipped']}
                />
              </div>

              <div className="editor-shell folder-shell">
                <FolderPathBlock
                  icon="input"
                  label="Input"
                  path={inputFolder}
                  empty="No source folder selected"
                />

                <div className="folder-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleChooseInputFolder}
                    disabled={folderBusy}
                  >
                    <FolderInput size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>Choose source</span>
                  </button>
                </div>

                <BatchList items={batchItems} />
              </div>

              <div className="pane-footer">
                <div className="local-note">
                  <Shield size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>Office, PDF, and text files</span>
                </div>
                <div className="result-summary">
                  {folderScan
                    ? `${folderScan.unsupported.length.toLocaleString()} unsupported`
                    : 'Choose a folder to scan'}
                </div>
              </div>
            </section>

            <section className="work-pane" aria-labelledby="folder-output-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">Output</p>
                  <h2 id="folder-output-title">Private</h2>
                </div>
                <MetricStrip
                  words={batchTotals.done}
                  chars={batchTotals.errors}
                  labels={['done', 'errors']}
                />
              </div>

              <div className="editor-shell folder-shell">
                <FolderPathBlock
                  icon="output"
                  label="Output"
                  path={outputFolder}
                  empty="Output folder is set after source selection"
                />

                <div className="folder-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleChooseOutputFolder}
                    disabled={folderBusy}
                  >
                    <FolderOutput size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>Choose output</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRunFolder}
                    disabled={
                      folderBusy ||
                      !folderScan ||
                      !outputFolder ||
                      folderScan.files.length === 0
                    }
                  >
                    <Play size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{folderBusy ? 'Processing' : 'Run folder'}</span>
                  </button>
                </div>

                <BatchRunPanel
                  status={folderStatus}
                  totals={batchTotals}
                  manifestPath={manifestPath}
                  scan={folderScan}
                />
              </div>

              <div className="pane-footer">
                <div className="result-summary">
                  {batchTotals.replacements.toLocaleString()} private replacements
                </div>
                <div className="result-summary">
                  {folderStatus === 'running'
                    ? modelStatus.detail
                    : folderStatusLabel(folderStatus)}
                </div>
              </div>
            </section>
          </section>
        )}

        <footer className="legal-strip" aria-label="Privacy and legal note">
          <span className="legal-strip__label">Open source</span>
          <p>Local after first download. Use at your own risk.</p>
        </footer>
      </div>
    </main>
  )
}

function MetricStrip({
  words,
  chars,
  labels = ['words', 'chars'],
}: {
  words: number
  chars: number
  labels?: [string, string]
}) {
  return (
    <div className="metric-strip" aria-label={`${words} ${labels[0]}, ${chars} ${labels[1]}`}>
      <span>
        {words.toLocaleString()} {labels[0]}
      </span>
      <span className="metric-strip__divider">/</span>
      <span>
        {chars.toLocaleString()} {labels[1]}
      </span>
    </div>
  )
}

function FolderPathBlock({
  icon,
  label,
  path,
  empty,
}: {
  icon: 'input' | 'output'
  label: string
  path: string | null
  empty: string
}) {
  const Icon = icon === 'input' ? FolderInput : FolderOutput

  return (
    <div className="folder-path-block">
      <div className="folder-path-block__label">
        <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p>{path ?? empty}</p>
    </div>
  )
}

function BatchList({ items }: { items: BatchItem[] }) {
  if (items.length === 0) {
    return (
      <div className="batch-empty">
        <div className="surface-eyebrow">Waiting</div>
        <p>Files appear after scan.</p>
      </div>
    )
  }

  return (
    <div className="batch-list" aria-label="Folder files">
      {items.map((item) => (
        <div className="batch-row" key={item.relativePath}>
          <div className="batch-row__main">
            <span>{item.relativePath}</span>
            <small>
              {item.extension.toUpperCase()} / {formatBytes(item.bytes)}
            </small>
          </div>
          <div className={`batch-status batch-status--${item.status}`}>
            {statusIcon(item.status)}
            <span>{itemStatusLabel(item)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function BatchRunPanel({
  status,
  totals,
  manifestPath,
  scan,
}: {
  status: FolderRunStatus
  totals: ReturnType<typeof summarizeBatch>
  manifestPath: string | null
  scan: PrivacyFolderScan | null
}) {
  const warnings = scan?.warnings ?? []

  return (
    <div className="batch-run-panel">
      <div className="batch-run-panel__summary">
        <div>
          <span>{totals.done.toLocaleString()}</span>
          <small>done</small>
        </div>
        <div>
          <span>{totals.pending.toLocaleString()}</span>
          <small>pending</small>
        </div>
        <div>
          <span>{totals.errors.toLocaleString()}</span>
          <small>errors</small>
        </div>
      </div>

      {status === 'running' ? (
        <div className="loading-rail batch-loading" aria-hidden="true">
          <span />
        </div>
      ) : null}

      {manifestPath ? (
        <div className="folder-path-block folder-path-block--manifest">
          <div className="folder-path-block__label">
            <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
            <span>Manifest</span>
          </div>
          <p>{manifestPath}</p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="batch-warnings">
          {warnings.map((warning) => (
            <div className="batch-warnings__item" key={warning}>
              <AlertTriangle size={15} strokeWidth={1.7} aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {scan && scan.unsupported.length > 0 ? (
        <SkippedFilesList files={scan.unsupported} />
      ) : null}
    </div>
  )
}

function SkippedFilesList({ files }: { files: UnsupportedPrivacyFile[] }) {
  const fileLabel = files.length === 1 ? 'file was' : 'files were'

  return (
    <section
      className="skipped-files"
      aria-label={`${files.length.toLocaleString()} skipped files`}
    >
      <div className="skipped-files__header">
        <AlertTriangle size={15} strokeWidth={1.7} aria-hidden="true" />
        <div>
          <span>
            {files.length.toLocaleString()} unsupported {fileLabel} skipped
          </span>
          <small>These files were not processed.</small>
        </div>
      </div>
      <div className="skipped-files__list">
        {files.map((file) => (
          <div className="skipped-file" key={file.path}>
            <span>{file.relativePath}</span>
            <small>{skippedFileMeta(file)}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function LoadingState({ detail }: { detail: string }) {
  return (
    <div className="loading-state">
      <div className="surface-eyebrow">Engine</div>
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
      <p>Private output appears here.</p>
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
    <div
      className={`notice-bar ${tone === 'error' ? 'notice-bar--error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="notice-bar__dot" />
      <span>{text}</span>
    </div>
  )
}

function createQueuedItem(file: PrivacyFolderFile): BatchItem {
  return {
    ...file,
    status: 'queued',
    warnings: [],
    spanCount: null,
  }
}

function summarizeBatch(items: BatchItem[]) {
  return items.reduce(
    (summary, item) => {
      if (item.status === 'done') {
        summary.done += 1
      } else if (item.status === 'error') {
        summary.errors += 1
      } else {
        summary.pending += 1
      }

      summary.replacements += item.spanCount ?? 0
      return summary
    },
    { done: 0, errors: 0, pending: 0, replacements: 0 },
  )
}

function statusIcon(status: BatchItemStatus) {
  if (status === 'done') {
    return <CheckCircle2 size={15} strokeWidth={1.5} aria-hidden="true" />
  }

  if (status === 'error') {
    return <AlertTriangle size={15} strokeWidth={1.5} aria-hidden="true" />
  }

  return <span className="batch-status__dot" aria-hidden="true" />
}

function itemStatusLabel(item: BatchItem) {
  if (item.status === 'done' && item.spanCount !== null) {
    return `${item.spanCount.toLocaleString()} replacements`
  }

  if (item.status === 'error') {
    return item.error ?? 'Error'
  }

  return item.status
}

function folderStatusLabel(status: FolderRunStatus) {
  switch (status) {
    case 'scanning':
      return 'Scanning folder'
    case 'ready':
      return 'Folder ready'
    case 'running':
      return 'Processing folder'
    case 'complete':
      return 'Folder complete'
    default:
      return 'Choose a folder'
  }
}

function defaultOutputFolder(inputRoot: string) {
  return `${inputRoot.replace(/[\\/]+$/, '')}-private-text`
}

function skippedFileMeta(file: UnsupportedPrivacyFile) {
  const extension = file.extension ? `.${file.extension}` : 'no extension'

  return `${extension.toUpperCase()} / ${file.reason}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function buildTextMetrics(text: string) {
  const trimmed = text.trim()

  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
  }
}

export default App
