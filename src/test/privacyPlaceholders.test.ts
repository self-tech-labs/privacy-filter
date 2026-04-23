import { describe, expect, it } from 'vitest'

import {
  buildPrivacyRunResult,
  placeholderForLabel,
} from '../lib/privacyPlaceholders'

describe('privacy placeholders', () => {
  it('maps privacy labels to typed placeholders', () => {
    expect(placeholderForLabel('private_person', 'typed')).toBe('<PRIVATE_PERSON>')
    expect(placeholderForLabel('secret', 'typed')).toBe('<SECRET>')
    expect(placeholderForLabel('private_email', 'redacted')).toBe('<REDACTED>')
  })

  it('builds redacted text and label counts from grouped spans', () => {
    const source =
      'Alice Example can be reached at alice@example.com on 1990-01-02.'
    const result = buildPrivacyRunResult(
      source,
      [
        {
          entity_group: 'private_person',
          score: 0.99,
          start: 0,
          end: 13,
          word: 'Alice Example',
        },
        {
          entity_group: 'private_email',
          score: 0.98,
          start: 32,
          end: 49,
          word: 'alice@example.com',
        },
        {
          entity_group: 'private_date',
          score: 0.97,
          start: 53,
          end: 63,
          word: '1990-01-02',
        },
      ],
      'typed',
      'wasm',
    )

    expect(result.redactedText).toBe(
      '<PRIVATE_PERSON> can be reached at <PRIVATE_EMAIL> on <PRIVATE_DATE>.',
    )
    expect(result.summary.byLabel).toEqual({
      private_date: 1,
      private_email: 1,
      private_person: 1,
    })
    expect(result.summary.backend).toBe('wasm')
  })
})
