import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCopy,
  FileText,
  FolderInput,
  FolderOutput,
  Languages,
  Play,
  Shield,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  BRAND_NAME,
  PRODUCT_NAME,
  PRODUCT_PUBLIC_NAME,
} from './content/projectContent'
import {
  createPendingDevicePerformanceReport,
  getDevicePerformanceReport,
  type DevicePerformanceReport,
} from './services/devicePerformance'
import {
  fireAndForgetRuntimeLog,
  getRuntimeLogPath,
  serializeError,
} from './services/runtimeLogging'
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
type AppLanguage = 'en' | 'fr'
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

interface GuideStepCopy {
  title: string
  body: string
}

interface AppCopy {
  languageLabel: string
  guideButton: string
  header: {
    productLabel: string
    workflowLabel: string
    textTab: string
    folderTab: string
  }
  guide: {
    eyebrow: string
    title: string
    intro: string
    close: string
    previous: string
    next: string
    done: string
    textSteps: GuideStepCopy[]
    folderSteps: GuideStepCopy[]
    stepLabel: (current: number, total: number) => string
  }
  panes: {
    input: string
    output: string
    source: string
    private: string
    sourceTextLabel: string
    privateTextLabel: string
    sourcePlaceholder: string
    textMetricLabels: [string, string]
    localDevice: string
    clear: string
    makePrivate: string
    makingPrivate: string
    copy: string
    ready: string
    privateOutputEmpty: string
    engine: string
    waiting: string
    replacement: (count: number) => string
    backendSeparator: string
  }
  folder: {
    chooseSourceTitle: string
    chooseOutputTitle: string
    sourceAriaLabel: string
    outputAriaLabel: string
    sourceLabel: string
    outputLabel: string
    noSourceSelected: string
    outputAfterSource: string
    chooseSource: string
    chooseOutput: string
    runFolder: string
    processing: string
    fileKinds: string
    chooseFolderToScan: string
    unsupported: (count: number) => string
    privateReplacements: (count: number) => string
    filesLabel: string
    skippedLabel: string
    doneLabel: string
    errorsLabel: string
  }
  batch: {
    processedTitle: string
    processedSubtitle: (count: number) => string
    processedAriaLabel: string
    processedCollapse: string
    processedExpand: string
    processedCollapsed: (count: number) => string
    deniedTitle: string
    deniedSubtitle: string
    deniedAriaLabel: (count: number) => string
    deniedCollapse: string
    deniedExpand: string
    deniedCollapsed: (count: number) => string
    filesAppearAfterScan: string
    manifest: string
    done: string
    pending: string
    errors: string
    unsupportedSkipped: (count: number) => string
    queued: string
    extracting: string
    redacting: string
    writing: string
    error: string
    replacements: (count: number) => string
  }
  notices: {
    copied: string
    manualCopy: string
    privacyPassFailed: string
    localEngineError: string
    fileProcessingFailed: string
    scanFailed: string
    outputPickFailed: string
    filesReady: (count: number) => string
    noSupportedFiles: string
    folderComplete: string
    folderCompleteWithErrors: string
    manifestFailed: string
  }
  runtime: {
    performanceWarning: (summary: string) => string
    logPath: (path: string) => string
  }
  status: Record<FolderRunStatus, string>
  modelDetails: Record<string, string>
  footer: {
    label: string
    text: string
  }
}

const languages: AppLanguage[] = ['en', 'fr']

const copy: Record<AppLanguage, AppCopy> = {
  en: {
    languageLabel: 'Select language',
    guideButton: 'Guide',
    header: {
      productLabel: 'Desktop privacy filter',
      workflowLabel: 'Privacy workflow',
      textTab: 'Text',
      folderTab: 'Folder',
    },
    guide: {
      eyebrow: 'Guide',
      title: 'Use Privacy Filter in three steps',
      intro:
        'Follow the workflow for one text passage or a whole folder before sending content to another AI tool.',
      close: 'Close guide',
      previous: 'Back',
      next: 'Next',
      done: 'Got it',
      stepLabel: (current, total) => `Step ${current} of ${total}`,
      textSteps: [
        {
          title: 'Paste source text',
          body: 'Use Text mode for a single note, email, report excerpt, or draft you want to clean locally.',
        },
        {
          title: 'Run the local privacy pass',
          body: 'Click Make private. The app replaces detected personal data with typed placeholders such as <PRIVATE_PERSON> or <PRIVATE_EMAIL>.',
        },
        {
          title: 'Review, then copy',
          body: 'Read the private output, adjust anything important, and copy only the cleaned text into your next workflow.',
        },
      ],
      folderSteps: [
        {
          title: 'Choose a source folder',
          body: 'Use Folder mode when you need to process several Office, PDF, or text files at once.',
        },
        {
          title: 'Check processed and denied files',
          body: 'The app lists files it can process and files it denied because their type is unsupported. Fold either list when it gets long.',
        },
        {
          title: 'Run and review the output folder',
          body: 'Choose the destination, run the folder job, then inspect the generated private text files and manifest.',
        },
      ],
    },
    panes: {
      input: 'Input',
      output: 'Output',
      source: 'Source',
      private: 'Private',
      sourceTextLabel: 'Source text',
      privateTextLabel: 'Private text',
      sourcePlaceholder: 'Paste text to redact.',
      textMetricLabels: ['words', 'chars'],
      localDevice: 'Local on this device',
      clear: 'Clear',
      makePrivate: 'Make private',
      makingPrivate: 'Making private',
      copy: 'Copy',
      ready: 'Ready',
      privateOutputEmpty: 'Private output appears here.',
      engine: 'Engine',
      waiting: 'Waiting',
      replacement: (count) => `${count.toLocaleString()} replacement${count === 1 ? '' : 's'}`,
      backendSeparator: '/',
    },
    folder: {
      chooseSourceTitle: 'Choose source folder',
      chooseOutputTitle: 'Choose private output folder',
      sourceAriaLabel: 'Folder privacy workspace',
      outputAriaLabel: 'Private output folder',
      sourceLabel: 'Input',
      outputLabel: 'Output',
      noSourceSelected: 'No source folder selected',
      outputAfterSource: 'Output folder is set after source selection',
      chooseSource: 'Choose source',
      chooseOutput: 'Choose output',
      runFolder: 'Run folder',
      processing: 'Processing',
      fileKinds: 'Office, PDF, and text files',
      chooseFolderToScan: 'Choose a folder to scan',
      unsupported: (count) => `${count.toLocaleString()} unsupported`,
      privateReplacements: (count) =>
        `${count.toLocaleString()} private replacement${count === 1 ? '' : 's'}`,
      filesLabel: 'files',
      skippedLabel: 'skipped',
      doneLabel: 'done',
      errorsLabel: 'errors',
    },
    batch: {
      processedTitle: 'Files being processed',
      processedSubtitle: (count) =>
        count === 0
          ? 'No processable files yet'
          : `${count.toLocaleString()} file${count === 1 ? '' : 's'} in the run`,
      processedAriaLabel: 'Folder files',
      processedCollapse: 'Collapse files being processed',
      processedExpand: 'Expand files being processed',
      processedCollapsed: (count) =>
        `${count.toLocaleString()} processable file${count === 1 ? '' : 's'} hidden`,
      deniedTitle: 'Denied files',
      deniedSubtitle: 'These files were not processed.',
      deniedAriaLabel: (count) => `${count.toLocaleString()} skipped files`,
      deniedCollapse: 'Collapse denied files',
      deniedExpand: 'Expand denied files',
      deniedCollapsed: (count) =>
        `${count.toLocaleString()} denied file${count === 1 ? '' : 's'} hidden`,
      filesAppearAfterScan: 'Files appear after scan.',
      manifest: 'Manifest',
      done: 'done',
      pending: 'pending',
      errors: 'errors',
      unsupportedSkipped: (count) =>
        `${count.toLocaleString()} unsupported file${count === 1 ? ' was' : 's were'} skipped`,
      queued: 'queued',
      extracting: 'extracting',
      redacting: 'redacting',
      writing: 'writing',
      error: 'Error',
      replacements: (count) =>
        `${count.toLocaleString()} replacement${count === 1 ? '' : 's'}`,
    },
    notices: {
      copied: 'Copied to clipboard',
      manualCopy:
        'Copy is unavailable here. Select the private text and press Cmd+C.',
      privacyPassFailed: 'Privacy pass failed.',
      localEngineError: 'Local engine error',
      fileProcessingFailed: 'File processing failed.',
      scanFailed: 'Could not scan that folder.',
      outputPickFailed: 'Could not choose an output folder.',
      filesReady: (count) =>
        `${count.toLocaleString()} file${count === 1 ? '' : 's'} ready`,
      noSupportedFiles: 'No supported files found in that folder',
      folderComplete: 'Folder run completed',
      folderCompleteWithErrors: 'Folder run completed with file-level errors',
      manifestFailed: 'Could not write the manifest.',
    },
    runtime: {
      performanceWarning: (summary) =>
        `Performance alert: ${summary} The app will continue, but large text or folders may run slowly.`,
      logPath: (path) => `Runtime log: ${path}`,
    },
    status: {
      idle: 'Choose a folder',
      scanning: 'Scanning folder',
      ready: 'Folder ready',
      running: 'Processing folder',
      complete: 'Folder complete',
    },
    modelDetails: {
      Idle: 'Idle',
      'Preparing local engine': 'Preparing local engine',
      'Finalizing local engine': 'Finalizing local engine',
      'Local engine ready': 'Local engine ready',
      'Runs locally after the first model download':
        'Runs locally after the first model download',
      'Local engine error': 'Local engine error',
      'Switching to compatibility engine': 'Switching to compatibility engine',
      'Making text private': 'Making text private',
      'Finalizing private text': 'Finalizing private text',
    },
    footer: {
      label: 'Open source',
      text: 'Local after first download. Use at your own risk.',
    },
  },
  fr: {
    languageLabel: 'Choisir la langue',
    guideButton: 'Guide',
    header: {
      productLabel: 'Filtre de confidentialité desktop',
      workflowLabel: 'Flux de confidentialité',
      textTab: 'Texte',
      folderTab: 'Dossier',
    },
    guide: {
      eyebrow: 'Guide',
      title: 'Utiliser Privacy Filter en trois étapes',
      intro:
        'Suivez le flux pour un texte seul ou pour un dossier complet avant d’envoyer du contenu vers un autre outil d’IA.',
      close: 'Fermer le guide',
      previous: 'Retour',
      next: 'Suivant',
      done: 'Compris',
      stepLabel: (current, total) => `Étape ${current} sur ${total}`,
      textSteps: [
        {
          title: 'Collez le texte source',
          body: 'Utilisez le mode Texte pour une note, un email, un extrait de rapport ou un brouillon à nettoyer localement.',
        },
        {
          title: 'Lancez le filtrage local',
          body: 'Cliquez sur Rendre privé. L’app remplace les données personnelles détectées par des placeholders typés comme <PRIVATE_PERSON> ou <PRIVATE_EMAIL>.',
        },
        {
          title: 'Relisez, puis copiez',
          body: 'Relisez la sortie privée, ajustez les points importants, puis copiez uniquement le texte nettoyé dans votre flux suivant.',
        },
      ],
      folderSteps: [
        {
          title: 'Choisissez un dossier source',
          body: 'Utilisez le mode Dossier pour traiter plusieurs fichiers Office, PDF ou texte en une seule passe.',
        },
        {
          title: 'Vérifiez les fichiers traités et refusés',
          body: 'L’app liste les fichiers qu’elle peut traiter et ceux refusés parce que leur type n’est pas supporté. Repliez chaque liste quand elle devient longue.',
        },
        {
          title: 'Lancez et vérifiez le dossier de sortie',
          body: 'Choisissez la destination, lancez le traitement, puis inspectez les fichiers texte privés générés et le manifeste.',
        },
      ],
    },
    panes: {
      input: 'Entrée',
      output: 'Sortie',
      source: 'Source',
      private: 'Privé',
      sourceTextLabel: 'Texte source',
      privateTextLabel: 'Texte privé',
      sourcePlaceholder: 'Collez le texte à anonymiser.',
      textMetricLabels: ['mots', 'car.'],
      localDevice: 'Local sur cet appareil',
      clear: 'Effacer',
      makePrivate: 'Rendre privé',
      makingPrivate: 'Traitement',
      copy: 'Copier',
      ready: 'Prêt',
      privateOutputEmpty: 'La sortie privée apparaîtra ici.',
      engine: 'Moteur',
      waiting: 'En attente',
      replacement: (count) => `${count.toLocaleString('fr-CH')} remplacement${count === 1 ? '' : 's'}`,
      backendSeparator: '/',
    },
    folder: {
      chooseSourceTitle: 'Choisir le dossier source',
      chooseOutputTitle: 'Choisir le dossier de sortie privé',
      sourceAriaLabel: 'Espace de confidentialité pour dossier',
      outputAriaLabel: 'Dossier de sortie privé',
      sourceLabel: 'Entrée',
      outputLabel: 'Sortie',
      noSourceSelected: 'Aucun dossier source sélectionné',
      outputAfterSource: 'Le dossier de sortie est défini après la sélection source',
      chooseSource: 'Choisir la source',
      chooseOutput: 'Choisir la sortie',
      runFolder: 'Traiter le dossier',
      processing: 'Traitement',
      fileKinds: 'Fichiers Office, PDF et texte',
      chooseFolderToScan: 'Choisissez un dossier à scanner',
      unsupported: (count) => `${count.toLocaleString('fr-CH')} non supporté${count === 1 ? '' : 's'}`,
      privateReplacements: (count) =>
        `${count.toLocaleString('fr-CH')} remplacement${count === 1 ? '' : 's'} privé${count === 1 ? '' : 's'}`,
      filesLabel: 'fichiers',
      skippedLabel: 'ignorés',
      doneLabel: 'terminés',
      errorsLabel: 'erreurs',
    },
    batch: {
      processedTitle: 'Fichiers en traitement',
      processedSubtitle: (count) =>
        count === 0
          ? 'Aucun fichier traitable pour le moment'
          : `${count.toLocaleString('fr-CH')} fichier${count === 1 ? '' : 's'} dans le traitement`,
      processedAriaLabel: 'Fichiers du dossier',
      processedCollapse: 'Replier les fichiers en traitement',
      processedExpand: 'Déplier les fichiers en traitement',
      processedCollapsed: (count) =>
        `${count.toLocaleString('fr-CH')} fichier${count === 1 ? '' : 's'} traitable${count === 1 ? '' : 's'} masqué${count === 1 ? '' : 's'}`,
      deniedTitle: 'Fichiers refusés',
      deniedSubtitle: 'Ces fichiers n’ont pas été traités.',
      deniedAriaLabel: (count) => `${count.toLocaleString('fr-CH')} fichiers ignorés`,
      deniedCollapse: 'Replier les fichiers refusés',
      deniedExpand: 'Déplier les fichiers refusés',
      deniedCollapsed: (count) =>
        `${count.toLocaleString('fr-CH')} fichier${count === 1 ? '' : 's'} refusé${count === 1 ? '' : 's'} masqué${count === 1 ? '' : 's'}`,
      filesAppearAfterScan: 'Les fichiers apparaissent après le scan.',
      manifest: 'Manifeste',
      done: 'terminés',
      pending: 'en attente',
      errors: 'erreurs',
      unsupportedSkipped: (count) =>
        `${count.toLocaleString('fr-CH')} fichier${count === 1 ? '' : 's'} non supporté${count === 1 ? ' a été ignoré' : 's ont été ignorés'}`,
      queued: 'en attente',
      extracting: 'extraction',
      redacting: 'filtrage',
      writing: 'écriture',
      error: 'Erreur',
      replacements: (count) =>
        `${count.toLocaleString('fr-CH')} remplacement${count === 1 ? '' : 's'}`,
    },
    notices: {
      copied: 'Copié dans le presse-papiers',
      manualCopy:
        'La copie est indisponible ici. Sélectionnez le texte privé et appuyez sur Cmd+C.',
      privacyPassFailed: 'Le filtrage de confidentialité a échoué.',
      localEngineError: 'Erreur du moteur local',
      fileProcessingFailed: 'Le traitement du fichier a échoué.',
      scanFailed: 'Impossible de scanner ce dossier.',
      outputPickFailed: 'Impossible de choisir un dossier de sortie.',
      filesReady: (count) =>
        `${count.toLocaleString('fr-CH')} fichier${count === 1 ? '' : 's'} prêt${count === 1 ? '' : 's'}`,
      noSupportedFiles: 'Aucun fichier supporté trouvé dans ce dossier',
      folderComplete: 'Traitement du dossier terminé',
      folderCompleteWithErrors:
        'Traitement du dossier terminé avec des erreurs sur certains fichiers',
      manifestFailed: 'Impossible d’écrire le manifeste.',
    },
    runtime: {
      performanceWarning: (summary) =>
        `Alerte performance : ${summary} L’app continue, mais les grands textes ou dossiers peuvent être lents.`,
      logPath: (path) => `Journal d’exécution : ${path}`,
    },
    status: {
      idle: 'Choisir un dossier',
      scanning: 'Scan du dossier',
      ready: 'Dossier prêt',
      running: 'Traitement du dossier',
      complete: 'Dossier terminé',
    },
    modelDetails: {
      Idle: 'Inactif',
      'Preparing local engine': 'Préparation du moteur local',
      'Finalizing local engine': 'Finalisation du moteur local',
      'Local engine ready': 'Moteur local prêt',
      'Runs locally after the first model download':
        'Local après le premier téléchargement du modèle',
      'Local engine error': 'Erreur du moteur local',
      'Switching to compatibility engine':
        'Passage au moteur de compatibilité',
      'Making text private': 'Anonymisation du texte',
      'Finalizing private text': 'Finalisation du texte privé',
    },
    footer: {
      label: 'Open source',
      text: 'Local après le premier téléchargement. Utilisation à vos risques.',
    },
  },
}

const languageLabels: Record<AppLanguage, string> = {
  en: 'EN',
  fr: 'FR',
}

function App() {
  const [language, setLanguage] = useState<AppLanguage>(() => {
    const savedLanguage = readLocalStorageValue('privacy-filter-language')
    if (savedLanguage === 'en' || savedLanguage === 'fr') {
      return savedLanguage
    }

    return getBrowserLanguage().toLowerCase().startsWith('fr') ? 'fr' : 'en'
  })
  const content = copy[language]
  const [mode, setMode] = useState<WorkspaceMode>('text')
  const [guideOpen, setGuideOpen] = useState(() => {
    return readLocalStorageValue('privacy-filter-guide-dismissed') !== 'true'
  })
  const [guideStep, setGuideStep] = useState(0)
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
  const [processedFilesExpanded, setProcessedFilesExpanded] = useState(true)
  const [deniedFilesExpanded, setDeniedFilesExpanded] = useState(true)
  const [performanceReport, setPerformanceReport] =
    useState<DevicePerformanceReport>(createPendingDevicePerformanceReport)
  const [runtimeLogPath, setRuntimeLogPath] = useState<string | null>(null)

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

  useEffect(() => {
    document.documentElement.lang = language
    document.title =
      language === 'fr'
        ? `${PRODUCT_NAME} - filtre de confidentialité`
        : `${PRODUCT_NAME} - desktop privacy filter`
    writeLocalStorageValue('privacy-filter-language', language)
  }, [language])

  useEffect(() => {
    let active = true

    fireAndForgetRuntimeLog('info', 'App shell mounted', {
      location: 'app-shell',
      language,
    })

    void getRuntimeLogPath().then((path) => {
      if (active) {
        setRuntimeLogPath(path)
      }
    })

    void getDevicePerformanceReport().then((report) => {
      if (active) {
        setPerformanceReport(report)
      }
    })

    return () => {
      active = false
    }
  }, [language])

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

  function selectMode(nextMode: WorkspaceMode) {
    setMode(nextMode)
    setGuideStep(0)
  }

  function updateBatchItem(relativePath: string, patch: Partial<BatchItem>) {
    setBatchItems((items) =>
      items.map((item) =>
        item.relativePath === relativePath ? { ...item, ...patch } : item,
      ),
    )
  }

  async function runPerformancePreflight(operation: string) {
    const report = await getDevicePerformanceReport()
    setPerformanceReport(report)

    if (report.status === 'warning') {
      fireAndForgetRuntimeLog('warn', 'Execution continuing after performance warning', {
        location: 'execution-preflight',
        operation,
        summary: report.summary,
      })
    }

    return report
  }

  async function handleCopy() {
    if (!result) {
      return
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable.')
      }
      await navigator.clipboard.writeText(result.redactedText)
      setError(null)
      showTransientNotice(content.notices.copied)
    } catch {
      setError(null)
      setNotice(content.notices.manualCopy)
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
      await runPerformancePreflight('text-redaction')
      fireAndForgetRuntimeLog('info', 'Text redaction started', {
        location: 'text-redaction',
        characters: cleaned.length,
      })
      const nextResult = await redactText(cleaned, 'typed', setModelStatus)
      startTransition(() => {
        setResult(nextResult)
      })
      fireAndForgetRuntimeLog('info', 'Text redaction completed', {
        location: 'text-redaction',
        replacements: nextResult.summary.spanCount,
        backend: nextResult.summary.backend,
      })
    } catch (redactionError) {
      const message =
        redactionError instanceof Error
          ? redactionError.message
          : content.notices.privacyPassFailed

      fireAndForgetRuntimeLog('error', 'Text redaction failed', {
        location: 'text-redaction',
        error: serializeError(redactionError),
      })
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
      const selected = await pickPrivacyFolder(content.folder.chooseSourceTitle)
      if (!selected) {
        fireAndForgetRuntimeLog('info', 'Folder selection cancelled', {
          location: 'folder-scan',
        })
        return
      }

      setMode('folder')
      setFolderStatus('scanning')
      setManifestPath(null)
      fireAndForgetRuntimeLog('info', 'Folder scan started', {
        location: 'folder-scan',
      })

      const scan = await scanPrivacyFolder(selected)
      setInputFolder(scan.inputRoot)
      setOutputFolder(defaultOutputFolder(scan.inputRoot))
      setFolderScan(scan)
      setBatchItems(scan.files.map(createQueuedItem))
      setProcessedFilesExpanded(true)
      setDeniedFilesExpanded(true)
      setFolderStatus('ready')
      setNotice(
        scan.files.length > 0
          ? content.notices.filesReady(scan.files.length)
          : content.notices.noSupportedFiles,
      )
      fireAndForgetRuntimeLog('info', 'Folder scan completed', {
        location: 'folder-scan',
        files: scan.files.length,
        unsupported: scan.unsupported.length,
        warnings: scan.warnings.length,
      })
    } catch (folderError) {
      setFolderStatus('idle')
      fireAndForgetRuntimeLog('error', 'Folder scan failed', {
        location: 'folder-scan',
        error: serializeError(folderError),
      })
      setError(
        folderError instanceof Error
          ? folderError.message
          : content.notices.scanFailed,
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
      const selected = await pickPrivacyFolder(content.folder.chooseOutputTitle)
      if (selected) {
        setOutputFolder(selected)
        fireAndForgetRuntimeLog('info', 'Output folder selected', {
          location: 'folder-output',
        })
      }
    } catch (folderError) {
      fireAndForgetRuntimeLog('error', 'Output folder selection failed', {
        location: 'folder-output',
        error: serializeError(folderError),
      })
      setError(
        folderError instanceof Error
          ? folderError.message
          : content.notices.outputPickFailed,
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

    await runPerformancePreflight('folder-redaction')
    fireAndForgetRuntimeLog('info', 'Folder run started', {
      location: 'folder-run',
      files: folderScan.files.length,
      unsupported: folderScan.unsupported.length,
    })

    setFolderStatus('running')
    setBatchItems(folderScan.files.map(createQueuedItem))

    for (const file of folderScan.files) {
      try {
        fireAndForgetRuntimeLog('info', 'Folder item started', {
          location: 'folder-run',
          relativePath: file.relativePath,
          extension: file.extension,
          bytes: file.bytes,
        })
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
        fireAndForgetRuntimeLog('info', 'Folder item completed', {
          location: 'folder-run',
          relativePath: file.relativePath,
          replacements: privacyResult.summary.spanCount,
          backend: privacyResult.summary.backend,
          warnings: extracted.warnings.length,
        })
      } catch (itemError) {
        failed = true
        const message =
          itemError instanceof Error
            ? itemError.message
            : content.notices.fileProcessingFailed
        fireAndForgetRuntimeLog('error', 'Folder item failed', {
          location: 'folder-run',
          relativePath: file.relativePath,
          error: serializeError(itemError),
        })
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
          ? content.notices.folderCompleteWithErrors
          : content.notices.folderComplete,
      )
      fireAndForgetRuntimeLog(
        failed ? 'warn' : 'info',
        'Folder run completed',
        {
          location: 'folder-run',
          files: entries.length,
          failed,
          manifestBytes: manifest.bytes,
        },
      )
    } catch (manifestError) {
      setFolderStatus('complete')
      fireAndForgetRuntimeLog('error', 'Folder manifest write failed', {
        location: 'folder-run',
        error: serializeError(manifestError),
      })
      setError(
        manifestError instanceof Error
          ? manifestError.message
          : content.notices.manifestFailed,
      )
    }
  }

  function closeGuide() {
    setGuideOpen(false)
    writeLocalStorageValue('privacy-filter-guide-dismissed', 'true')
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
              <p className="product-label">{content.header.productLabel}</p>
              <h1>{PRODUCT_NAME}</h1>
            </div>
          </div>

          <div className="header-controls">
            <button
              type="button"
              className="guide-toggle"
              onClick={() => setGuideOpen((current) => !current)}
              aria-expanded={guideOpen}
            >
              <CircleHelp size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{content.guideButton}</span>
            </button>

            <div className="language-switch" aria-label={content.languageLabel}>
              <Languages size={15} strokeWidth={1.8} aria-hidden="true" />
              {languages.map((item) => (
                <button
                  aria-pressed={language === item}
                  className="language-option"
                  key={item}
                  onClick={() => setLanguage(item)}
                  type="button"
                >
                  {languageLabels[item]}
                </button>
              ))}
            </div>

            <div
              className="mode-switch"
              role="tablist"
              aria-label={content.header.workflowLabel}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'text'}
                className={
                  mode === 'text' ? 'mode-switch__tab is-active' : 'mode-switch__tab'
                }
                onClick={() => selectMode('text')}
                disabled={appBusy}
              >
                <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{content.header.textTab}</span>
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
                onClick={() => selectMode('folder')}
                disabled={appBusy}
              >
                <FolderInput size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{content.header.folderTab}</span>
              </button>
            </div>

            <div
              className="status-chip"
              data-state={appBusy ? 'busy' : modelStatus.phase}
              role="status"
              aria-live="polite"
            >
              <span className="status-chip__dot" />
              <span>
                {folderBusy
                  ? folderStatusLabel(folderStatus, content)
                  : modelStatusDetailLabel(modelStatus.detail, content)}
              </span>
            </div>
          </div>
        </header>

        {guideOpen ? (
          <GuidePanel
            content={content}
            mode={mode}
            step={guideStep}
            onClose={closeGuide}
            onModeChange={selectMode}
            onStepChange={setGuideStep}
            disabled={appBusy}
          />
        ) : null}

        {error ? <NoticeBar tone="error" text={error} /> : null}
        {performanceReport.status === 'warning' ? (
          <NoticeBar
            tone="warning"
            text={content.runtime.performanceWarning(performanceReport.summary)}
          />
        ) : null}
        {!error && notice ? <NoticeBar tone="neutral" text={notice} /> : null}

        {mode === 'text' ? (
          <section
            className="workspace-grid"
            aria-label={content.header.workflowLabel}
          >
            <section className="work-pane" aria-labelledby="source-pane-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">{content.panes.input}</p>
                  <h2 id="source-pane-title">{content.panes.source}</h2>
                </div>
                <MetricStrip
                  words={sourceMetrics.words}
                  chars={sourceMetrics.chars}
                  labels={content.panes.textMetricLabels}
                />
              </div>

              <div className="editor-shell">
                <textarea
                  aria-label={content.panes.sourceTextLabel}
                  value={sourceText}
                  onChange={(event) => applySourceText(event.target.value)}
                  onKeyDown={handleSourceKeyDown}
                  placeholder={content.panes.sourcePlaceholder}
                  spellCheck={false}
                  className="editor-textarea"
                />
              </div>

              <div className="pane-footer">
                <div className="local-note">
                  <Shield size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>{content.panes.localDevice}</span>
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
                      <span>{content.panes.clear}</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleMakePrivate}
                    disabled={!hasSource || busy}
                  >
                    <Sparkles size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>
                      {busy ? content.panes.makingPrivate : content.panes.makePrivate}
                    </span>
                  </button>
                </div>
              </div>
            </section>

            <section className="work-pane" aria-labelledby="private-pane-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">{content.panes.output}</p>
                  <h2 id="private-pane-title">{content.panes.private}</h2>
                </div>
                {result ? (
                  <MetricStrip
                    words={resultMetrics.words}
                    chars={resultMetrics.chars}
                    labels={content.panes.textMetricLabels}
                  />
                ) : null}
              </div>

              <div className="editor-shell editor-shell--output">
                {busy ? (
                  <LoadingState
                    content={content}
                    detail={modelStatusDetailLabel(modelStatus.detail, content)}
                  />
                ) : result ? (
                  <textarea
                    aria-label={content.panes.privateTextLabel}
                    value={result.redactedText}
                    readOnly
                    spellCheck={false}
                    className="editor-textarea editor-textarea--readonly"
                  />
                ) : (
                  <EmptyResultState content={content} />
                )}
              </div>

              <div className="pane-footer">
                {result ? (
                  <>
                    <div className="result-summary">
                      {content.panes.replacement(result.summary.spanCount)}{' '}
                      {content.panes.backendSeparator}{' '}
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
                        <span>{content.panes.copy}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="result-summary">
                    {content.panes.ready}
                  </div>
                )}
              </div>
            </section>
          </section>
        ) : (
          <section
            className="workspace-grid"
            aria-label={content.folder.sourceAriaLabel}
          >
            <section className="work-pane" aria-labelledby="folder-source-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">{content.panes.input}</p>
                  <h2 id="folder-source-title">{content.panes.source}</h2>
                </div>
                <MetricStrip
                  words={folderScan?.files.length ?? 0}
                  chars={folderScan?.unsupported.length ?? 0}
                  labels={[content.folder.filesLabel, content.folder.skippedLabel]}
                />
              </div>

              <div className="editor-shell folder-shell">
                <FolderPathBlock
                  icon="input"
                  label={content.folder.sourceLabel}
                  path={inputFolder}
                  empty={content.folder.noSourceSelected}
                />

                <div className="folder-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleChooseInputFolder}
                    disabled={folderBusy}
                  >
                    <FolderInput size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{content.folder.chooseSource}</span>
                  </button>
                </div>

                <BatchList
                  content={content}
                  expanded={processedFilesExpanded}
                  items={batchItems}
                  onToggle={() =>
                    setProcessedFilesExpanded((current) => !current)
                  }
                />
              </div>

              <div className="pane-footer">
                <div className="local-note">
                  <Shield size={15} strokeWidth={1.7} aria-hidden="true" />
                  <span>{content.folder.fileKinds}</span>
                </div>
                <div className="result-summary">
                  {folderScan
                    ? content.folder.unsupported(folderScan.unsupported.length)
                    : content.folder.chooseFolderToScan}
                </div>
              </div>
            </section>

            <section className="work-pane" aria-labelledby="folder-output-title">
              <div className="pane-header">
                <div className="pane-heading">
                  <p className="surface-eyebrow">{content.panes.output}</p>
                  <h2 id="folder-output-title">{content.panes.private}</h2>
                </div>
                <MetricStrip
                  words={batchTotals.done}
                  chars={batchTotals.errors}
                  labels={[content.folder.doneLabel, content.folder.errorsLabel]}
                />
              </div>

              <div className="editor-shell folder-shell">
                <FolderPathBlock
                  icon="output"
                  label={content.folder.outputLabel}
                  path={outputFolder}
                  empty={content.folder.outputAfterSource}
                />

                <div className="folder-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleChooseOutputFolder}
                    disabled={folderBusy}
                  >
                    <FolderOutput size={15} strokeWidth={1.7} aria-hidden="true" />
                    <span>{content.folder.chooseOutput}</span>
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
                    <span>
                      {folderBusy
                        ? content.folder.processing
                        : content.folder.runFolder}
                    </span>
                  </button>
                </div>

                <BatchRunPanel
                  content={content}
                  deniedExpanded={deniedFilesExpanded}
                  status={folderStatus}
                  totals={batchTotals}
                  manifestPath={manifestPath}
                  onDeniedToggle={() =>
                    setDeniedFilesExpanded((current) => !current)
                  }
                  scan={folderScan}
                />
              </div>

              <div className="pane-footer">
                <div className="result-summary">
                  {content.folder.privateReplacements(batchTotals.replacements)}
                </div>
                <div className="result-summary">
                  {folderStatus === 'running'
                    ? modelStatusDetailLabel(modelStatus.detail, content)
                    : folderStatusLabel(folderStatus, content)}
                </div>
              </div>
            </section>
          </section>
        )}

        <footer className="legal-strip" aria-label="Privacy and legal note">
          <span className="legal-strip__label">{content.footer.label}</span>
          <p>{content.footer.text}</p>
          {runtimeLogPath ? (
            <p className="runtime-log-path">
              {content.runtime.logPath(runtimeLogPath)}
            </p>
          ) : null}
        </footer>
      </div>
    </main>
  )
}

function GuidePanel({
  content,
  disabled,
  mode,
  onClose,
  onModeChange,
  onStepChange,
  step,
}: {
  content: AppCopy
  disabled: boolean
  mode: WorkspaceMode
  onClose: () => void
  onModeChange: (mode: WorkspaceMode) => void
  onStepChange: (step: number) => void
  step: number
}) {
  const steps = mode === 'folder' ? content.guide.folderSteps : content.guide.textSteps
  const activeStep = steps[step] ?? steps[0]
  const isFirstStep = step === 0
  const isLastStep = step === steps.length - 1

  function goToStep(nextStep: number) {
    onStepChange(Math.min(Math.max(nextStep, 0), steps.length - 1))
  }

  return (
    <section className="guide-panel" aria-labelledby="guide-title">
      <div className="guide-panel__header">
        <div>
          <p className="surface-eyebrow">{content.guide.eyebrow}</p>
          <h2 id="guide-title">{content.guide.title}</h2>
          <p>{content.guide.intro}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={content.guide.close}
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div
        className="guide-panel__mode-row"
        aria-label={content.header.workflowLabel}
      >
        <button
          type="button"
          aria-pressed={mode === 'text'}
          className={mode === 'text' ? 'guide-mode is-active' : 'guide-mode'}
          disabled={disabled}
          onClick={() => onModeChange('text')}
        >
          <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>{content.header.textTab}</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === 'folder'}
          className={mode === 'folder' ? 'guide-mode is-active' : 'guide-mode'}
          disabled={disabled}
          onClick={() => onModeChange('folder')}
        >
          <FolderInput size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>{content.header.folderTab}</span>
        </button>
      </div>

      <div className="guide-step">
        <div className="guide-step__index">
          {content.guide.stepLabel(step + 1, steps.length)}
        </div>
        <h3>{activeStep.title}</h3>
        <p>{activeStep.body}</p>
      </div>

      <div className="guide-panel__footer">
        <div className="guide-stepper" aria-label={content.guide.stepLabel(step + 1, steps.length)}>
          {steps.map((guideStep, index) => (
            <button
              type="button"
              key={guideStep.title}
              className={
                index === step ? 'guide-stepper__dot is-active' : 'guide-stepper__dot'
              }
              aria-label={content.guide.stepLabel(index + 1, steps.length)}
              aria-pressed={index === step}
              onClick={() => goToStep(index)}
            />
          ))}
        </div>
        <div className="guide-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={isFirstStep}
            onClick={() => goToStep(step - 1)}
          >
            {content.guide.previous}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => (isLastStep ? onClose() : goToStep(step + 1))}
          >
            {isLastStep ? content.guide.done : content.guide.next}
          </button>
        </div>
      </div>
    </section>
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

function BatchList({
  content,
  expanded,
  items,
  onToggle,
}: {
  content: AppCopy
  expanded: boolean
  items: BatchItem[]
  onToggle: () => void
}) {
  return (
    <section className="batch-viewer" aria-label={content.batch.processedAriaLabel}>
      <button
        type="button"
        className="batch-viewer__header"
        aria-expanded={expanded}
        aria-label={
          expanded
            ? content.batch.processedCollapse
            : content.batch.processedExpand
        }
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
        )}
        <div>
          <span>{content.batch.processedTitle}</span>
          <small>{content.batch.processedSubtitle(items.length)}</small>
        </div>
      </button>

      {expanded ? (
        items.length === 0 ? (
          <div className="batch-empty">
            <div className="surface-eyebrow">{content.panes.waiting}</div>
            <p>{content.batch.filesAppearAfterScan}</p>
          </div>
        ) : (
          <div className="batch-list">
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
                  <span>{itemStatusLabel(item, content)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="batch-collapsed">
          {content.batch.processedCollapsed(items.length)}
        </div>
      )}
    </section>
  )
}

function BatchRunPanel({
  content,
  deniedExpanded,
  status,
  totals,
  manifestPath,
  onDeniedToggle,
  scan,
}: {
  content: AppCopy
  deniedExpanded: boolean
  status: FolderRunStatus
  totals: ReturnType<typeof summarizeBatch>
  manifestPath: string | null
  onDeniedToggle: () => void
  scan: PrivacyFolderScan | null
}) {
  const warnings = scan?.warnings ?? []

  return (
    <div className="batch-run-panel">
      <div className="batch-run-panel__summary">
        <div>
          <span>{totals.done.toLocaleString()}</span>
          <small>{content.batch.done}</small>
        </div>
        <div>
          <span>{totals.pending.toLocaleString()}</span>
          <small>{content.batch.pending}</small>
        </div>
        <div>
          <span>{totals.errors.toLocaleString()}</span>
          <small>{content.batch.errors}</small>
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
            <span>{content.batch.manifest}</span>
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
        <SkippedFilesList
          content={content}
          expanded={deniedExpanded}
          files={scan.unsupported}
          onToggle={onDeniedToggle}
        />
      ) : null}
    </div>
  )
}

function SkippedFilesList({
  content,
  expanded,
  files,
  onToggle,
}: {
  content: AppCopy
  expanded: boolean
  files: UnsupportedPrivacyFile[]
  onToggle: () => void
}) {
  return (
    <section
      className="skipped-files"
      aria-label={content.batch.deniedAriaLabel(files.length)}
    >
      <button
        type="button"
        className="skipped-files__header"
        aria-expanded={expanded}
        aria-label={expanded ? content.batch.deniedCollapse : content.batch.deniedExpand}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
        )}
        <div>
          <span>{content.batch.unsupportedSkipped(files.length)}</span>
          <small>{content.batch.deniedSubtitle}</small>
        </div>
      </button>
      {expanded ? (
        <div className="skipped-files__list">
          {files.map((file) => (
            <div className="skipped-file" key={file.path}>
              <span>{file.relativePath}</span>
              <small>{skippedFileMeta(file)}</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="batch-collapsed">
          {content.batch.deniedCollapsed(files.length)}
        </div>
      )}
    </section>
  )
}

function LoadingState({ content, detail }: { content: AppCopy; detail: string }) {
  return (
    <div className="loading-state">
      <div className="surface-eyebrow">{content.panes.engine}</div>
      <p>{detail}</p>
      <div className="loading-rail" aria-hidden="true">
        <span />
      </div>
    </div>
  )
}

function EmptyResultState({ content }: { content: AppCopy }) {
  return (
    <div className="empty-state">
      <div className="surface-eyebrow">{content.panes.waiting}</div>
      <p>{content.panes.privateOutputEmpty}</p>
    </div>
  )
}

function NoticeBar({
  tone,
  text,
}: {
  tone: 'error' | 'neutral' | 'warning'
  text: string
}) {
  return (
    <div
      className={`notice-bar ${
        tone === 'error'
          ? 'notice-bar--error'
          : tone === 'warning'
            ? 'notice-bar--warning'
            : ''
      }`}
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

function itemStatusLabel(item: BatchItem, content: AppCopy) {
  if (item.status === 'done' && item.spanCount !== null) {
    return content.batch.replacements(item.spanCount)
  }

  if (item.status === 'error') {
    return item.error ?? content.batch.error
  }

  return content.batch[item.status]
}

function folderStatusLabel(status: FolderRunStatus, content: AppCopy) {
  return content.status[status]
}

function modelStatusDetailLabel(detail: string, content: AppCopy) {
  const chunkMatch = detail.match(/^Making text private \((\d+)\/(\d+)\)$/)

  if (chunkMatch) {
    const base = content.modelDetails['Making text private'] ?? 'Making text private'
    return `${base} (${chunkMatch[1]}/${chunkMatch[2]})`
  }

  return content.modelDetails[detail] ?? detail
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

function readLocalStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not read local storage value', {
      location: 'storage',
      key,
      error: serializeError(error),
    })
    return null
  }
}

function writeLocalStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not write local storage value', {
      location: 'storage',
      key,
      error: serializeError(error),
    })
  }
}

function getBrowserLanguage(): string {
  try {
    return window.navigator.language || 'en'
  } catch {
    return 'en'
  }
}

export default App
