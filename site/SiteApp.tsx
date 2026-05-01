import {
  BRAND_NAME,
  BRAND_SITE_URL,
  LANDING_AUDIENCES,
  LANDING_LIMITS,
  LANDING_STEPS,
  LEGAL_DISCLAIMER_LONG,
  LEGAL_DISCLAIMER_SHORT,
  MODEL_REFERENCE_LABEL,
  MODEL_REFERENCE_URL,
  MODEL_USAGE_DETAIL,
  MODEL_USAGE_SUMMARY,
  PRODUCT_LICENSE_URL,
  PRODUCT_NAME,
  PRODUCT_PAGES_URL,
  PRODUCT_PRIVACY_DOC_URL,
  PRODUCT_PUBLIC_NAME,
  PRODUCT_RELEASES_URL,
  PRODUCT_REPOSITORY_URL,
  PRODUCT_SECURITY_DOC_URL,
} from '../src/content/projectContent'
import demoPosterUrl from './assets/privacy-filter-demo-poster.jpg'
import demoVideoUrl from './assets/privacy-filter-demo.mp4'

export function SiteApp() {
  return (
    <main className="site-shell">
      <section className="site-hero">
        <div className="site-hero__copy">
          <div className="site-eyebrow">
            Open-source local redaction for Swiss privacy-sensitive teams
          </div>
          <a className="site-brand site-brand--link" href={BRAND_SITE_URL}>
            {BRAND_NAME}
          </a>
          <h1 className="site-title">{PRODUCT_NAME}</h1>
          <p className="site-lead">
            {PRODUCT_NAME} helps law firms, medical practices, and other
            confidentiality-sensitive specialists clean working drafts locally
            before they paste text into frontier models.
          </p>

          <div className="site-cta-row">
            <a className="site-btn site-btn--primary" href={PRODUCT_REPOSITORY_URL}>
              View on GitHub
            </a>
            <a className="site-btn" href={PRODUCT_RELEASES_URL}>
              View desktop releases
            </a>
            <a className="site-btn" href={PRODUCT_PRIVACY_DOC_URL}>
              Read privacy docs
            </a>
          </div>

          <p className="site-inline-note">{LEGAL_DISCLAIMER_SHORT}</p>
          <p className="site-inline-note">
            Installable builds appear as `.dmg` assets for macOS and `.exe`
            setup assets for Windows on tagged releases. GitHub&apos;s `.zip` and
            `.tar.gz` downloads are source archives, not the desktop app.
          </p>
          <p className="site-inline-note">
            Main project:{' '}
            <a className="site-inline-link" href={BRAND_SITE_URL}>
              ogram.ch
            </a>
          </p>
        </div>

        <div className="site-preview" aria-label="Product preview">
          <div className="site-preview__frame">
            <div className="site-preview__topline">
              <span>Local-first workflow</span>
              <span>Desktop app</span>
            </div>
            <div className="site-preview__panel">
              <div>
                <div className="site-preview__eyebrow">Source</div>
                <p className="site-preview__text">
                  Dr. Alice Example reviewed the report for patient Marc Dubois on
                  18 April 2026.
                </p>
              </div>
              <div className="site-preview__divider" />
              <div>
                <div className="site-preview__eyebrow">Private</div>
                <p className="site-preview__text site-preview__text--private">
                  Dr. <span>&lt;PRIVATE_PERSON&gt;</span> reviewed the report for
                  patient <span>&lt;PRIVATE_PERSON&gt;</span> on{' '}
                  <span>&lt;PRIVATE_DATE&gt;</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-section__heading">
          <div className="site-eyebrow">Who it is for</div>
          <h2>Built for professionals who cannot casually paste raw material into hosted AI.</h2>
        </div>
        <div className="site-grid site-grid--cards">
          {LANDING_AUDIENCES.map((audience) => (
            <article key={audience} className="site-card">
              <p>{audience}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section">
        <div className="site-section__heading">
          <div className="site-eyebrow">How it works</div>
          <h2>A small, direct workflow designed for safer prompt preparation.</h2>
        </div>
        <div className="site-grid site-grid--steps">
          {LANDING_STEPS.map((step) => (
            <article key={step.id} className="site-step">
              <div className="site-step__id">{step.id}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section site-section--split site-section--demo">
        <div className="site-section__heading">
          <div className="site-eyebrow">Product demo</div>
          <h2>Watch the desktop flow in a short privacy-filter walkthrough.</h2>
          <p className="site-section__copy">
            This clip shows the paste-only workflow: raw text enters the desktop
            app, obvious private entities are replaced locally, and only the
            cleaned draft moves downstream.
          </p>
        </div>
        <div className="site-demo-card">
          <video
            className="site-demo-video"
            controls
            playsInline
            preload="metadata"
            poster={demoPosterUrl}
          >
            <source src={demoVideoUrl} type="video/mp4" />
            Your browser does not support embedded video.
          </video>
          <p className="site-demo-note">
            30-second product demo. Local redaction runs before the user copies
            text into a frontier-model workflow.
          </p>
        </div>
      </section>

      <section className="site-section site-section--split">
        <div className="site-section__heading">
          <div className="site-eyebrow">Model reference</div>
          <h2>Built on OpenAI’s {MODEL_REFERENCE_LABEL} privacy model.</h2>
        </div>
        <div className="site-list-block">
          <p>{MODEL_USAGE_SUMMARY}</p>
          <p>{MODEL_USAGE_DETAIL}</p>
          <p>
            Model source:{' '}
            <a className="site-inline-link" href={MODEL_REFERENCE_URL}>
              {MODEL_REFERENCE_URL}
            </a>
          </p>
        </div>
      </section>

      <section className="site-section site-section--split">
        <div className="site-section__heading">
          <div className="site-eyebrow">Trust and limits</div>
          <h2>Privacy Filter lowers obvious exposure risk. It does not replace professional judgment.</h2>
        </div>
        <div className="site-list-block">
          {LANDING_LIMITS.map((limit) => (
            <p key={limit}>{limit}</p>
          ))}
        </div>
      </section>

      <section className="site-section site-section--legal">
        <div className="site-section__heading">
          <div className="site-eyebrow">Open source</div>
          <h2>Clear licensing, visible limits, and public source.</h2>
        </div>
        <p className="site-legal-copy">{LEGAL_DISCLAIMER_LONG}</p>
        <div className="site-cta-row">
          <a className="site-text-link" href={PRODUCT_LICENSE_URL}>
            MIT License
          </a>
          <a className="site-text-link" href={PRODUCT_SECURITY_DOC_URL}>
            Security policy
          </a>
          <a className="site-text-link" href={PRODUCT_PAGES_URL}>
            Project site
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <div>
          <a
            className="site-brand site-brand--footer site-brand--link"
            href={BRAND_SITE_URL}
          >
            {BRAND_NAME}
          </a>
          <p>{PRODUCT_PUBLIC_NAME}</p>
        </div>
        <div className="site-footer__links">
          <a href={BRAND_SITE_URL}>ogram.ch</a>
          <a href={PRODUCT_REPOSITORY_URL}>GitHub</a>
          <a href={PRODUCT_RELEASES_URL}>Releases</a>
          <a href={PRODUCT_PRIVACY_DOC_URL}>Privacy docs</a>
        </div>
      </footer>
    </main>
  )
}
