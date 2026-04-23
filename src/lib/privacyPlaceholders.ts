import type {
  DetectedSpan,
  OutputMode,
  PrivacyRunResult,
  RuntimeBackend,
} from '../types/privacy'

interface ModelSpan {
  word: string
  score: number
  entity_group?: string
  entity?: string
  start?: number
  end?: number
}

const TYPED_PLACEHOLDERS: Record<string, string> = {
  account_number: '<ACCOUNT_NUMBER>',
  private_address: '<PRIVATE_ADDRESS>',
  private_date: '<PRIVATE_DATE>',
  private_email: '<PRIVATE_EMAIL>',
  private_person: '<PRIVATE_PERSON>',
  private_phone: '<PRIVATE_PHONE>',
  private_url: '<PRIVATE_URL>',
  secret: '<SECRET>',
}

function normalizeLabel(input: string): string {
  return input
    .replace(/^[BIES]-/i, '')
    .trim()
    .toLowerCase()
}

export function placeholderForLabel(label: string, outputMode: OutputMode): string {
  if (outputMode === 'redacted') {
    return '<REDACTED>'
  }

  return TYPED_PLACEHOLDERS[normalizeLabel(label)] ?? `<${normalizeLabel(label).toUpperCase()}>`
}

function resolveRange(sourceText: string, span: ModelSpan, cursor: number) {
  if (
    typeof span.start === 'number' &&
    typeof span.end === 'number' &&
    span.end > span.start &&
    span.end <= sourceText.length
  ) {
    return { start: span.start, end: span.end }
  }

  const candidates = [span.word, span.word.trim()].filter(Boolean)

  for (const candidate of candidates) {
    const start = sourceText.indexOf(candidate, cursor)
    if (start !== -1) {
      return { start, end: start + candidate.length }
    }
  }

  return null
}

export function materializeDetectedSpans(
  sourceText: string,
  modelSpans: ModelSpan[],
  outputMode: OutputMode,
): DetectedSpan[] {
  const detected: DetectedSpan[] = []
  let cursor = 0

  for (const span of modelSpans) {
    const label = normalizeLabel(span.entity_group ?? span.entity ?? 'redacted')
    const range = resolveRange(sourceText, span, cursor)

    if (!range || range.end <= range.start) {
      continue
    }

    if (detected.length > 0 && range.start < detected.at(-1)!.end) {
      continue
    }

    const text = sourceText.slice(range.start, range.end)
    const placeholder = placeholderForLabel(label, outputMode)

    detected.push({
      label,
      start: range.start,
      end: range.end,
      text,
      placeholder,
      score: span.score,
    })

    cursor = range.end
  }

  return detected
}

export function applyPlaceholders(sourceText: string, spans: DetectedSpan[]): string {
  if (spans.length === 0) {
    return sourceText
  }

  let cursor = 0
  let output = ''

  for (const span of spans) {
    output += sourceText.slice(cursor, span.start)
    output += span.placeholder
    cursor = span.end
  }

  output += sourceText.slice(cursor)
  return output
}

export function buildPrivacyRunResult(
  sourceText: string,
  modelSpans: ModelSpan[],
  outputMode: OutputMode,
  backend: RuntimeBackend,
): PrivacyRunResult {
  const detectedSpans = materializeDetectedSpans(sourceText, modelSpans, outputMode)
  const byLabel = detectedSpans.reduce<Record<string, number>>((summary, span) => {
    summary[span.label] = (summary[span.label] ?? 0) + 1
    return summary
  }, {})

  return {
    redactedText: applyPlaceholders(sourceText, detectedSpans),
    detectedSpans,
    summary: {
      outputMode,
      spanCount: detectedSpans.length,
      byLabel,
      backend,
    },
  }
}

