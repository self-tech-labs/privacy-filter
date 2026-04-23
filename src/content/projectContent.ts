export const PRODUCT_NAME = 'Privacy Filter'
export const BRAND_NAME = 'ogram'
export const PRODUCT_PUBLIC_NAME = `${PRODUCT_NAME} by ${BRAND_NAME}`
export const BRAND_SITE_URL = 'https://ogram.ch/'

export const PRODUCT_REPOSITORY_URL =
  'https://github.com/self-tech-labs/privacy-filter'
export const PRODUCT_PAGES_URL =
  'https://self-tech-labs.github.io/privacy-filter/'
export const PRODUCT_RELEASES_URL = `${PRODUCT_REPOSITORY_URL}/releases`
export const PRODUCT_PRIVACY_DOC_URL =
  `${PRODUCT_REPOSITORY_URL}/blob/main/docs/PRIVACY.md`
export const PRODUCT_SECURITY_DOC_URL =
  `${PRODUCT_REPOSITORY_URL}/blob/main/SECURITY.md`
export const PRODUCT_LICENSE_URL =
  `${PRODUCT_REPOSITORY_URL}/blob/main/LICENSE`
export const MODEL_REFERENCE_URL = 'https://huggingface.co/openai/privacy-filter'
export const MODEL_REFERENCE_LABEL = 'openai/privacy-filter'

export const APP_SHORT_TAGLINE =
  'Local-first redaction for Swiss privacy-sensitive professionals who want safer prompt preparation.'
export const APP_DESCRIPTION =
  'Paste raw text, redact obvious private entities locally, and move only the cleaned draft into your frontier-model workflow.'
export const APP_LOCAL_PROCESSING_NOTE =
  'After the first model download, the privacy pass runs on this Mac.'

export const LEGAL_DISCLAIMER_SHORT =
  'Open-source software. Use it at your own risk. ogram accepts no responsibility for any downstream use, output, decision, or compliance outcome.'
export const LEGAL_DISCLAIMER_LONG =
  'Privacy Filter is an open-source project maintained by ogram. It helps remove obvious private entities before text is shared with external models, but it is not legal advice, medical advice, or compliance certification. Users remain responsible for validating outputs, workflows, and applicable confidentiality obligations.'
export const MODEL_USAGE_SUMMARY =
  'This project uses OpenAI’s openai/privacy-filter model from Hugging Face as its local privacy-detection engine.'
export const MODEL_USAGE_DETAIL =
  'The model is a token-classification privacy filter. In this project, we load it through @huggingface/transformers, run it locally after the first model download, detect spans such as names, emails, phones, dates, addresses, URLs, account numbers, and secrets, then replace those spans with typed placeholders before the user copies the cleaned text into a downstream AI workflow.'

export const LANDING_AUDIENCES = [
  'Swiss law firms handling client drafts and exhibits',
  'Medical practices preparing notes for structured AI assistance',
  'Specialists who work with private material but still want frontier-model leverage',
]

export const LANDING_STEPS = [
  {
    id: '01',
    title: 'Paste a working draft',
    body: 'Bring raw text into the desktop app instead of dropping it directly into a hosted model.',
  },
  {
    id: '02',
    title: 'Redact locally',
    body: 'The app runs the privacy filter on-device after the first model download and replaces obvious entities with placeholders.',
  },
  {
    id: '03',
    title: 'Use the cleaned version',
    body: 'Take the paste-ready result into ChatGPT or another frontier-model workflow with less raw exposure.',
  },
]

export const LANDING_LIMITS = [
  'It reduces obvious exposure risk, but it does not guarantee compliance.',
  'Users must validate every output before sharing, filing, or acting on it.',
  'Swiss professional secrecy, medical confidentiality, and internal policy obligations still apply.',
]
