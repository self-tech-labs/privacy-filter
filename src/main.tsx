import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import { RuntimeErrorBoundary } from './components/RuntimeErrorBoundary.tsx'
import {
  fireAndForgetRuntimeLog,
  installGlobalRuntimeLogging,
} from './services/runtimeLogging.ts'
import App from './App.tsx'

installGlobalRuntimeLogging()

const rootElement = document.getElementById('root')

if (!rootElement) {
  fireAndForgetRuntimeLog('error', 'React root element was not found', {
    location: 'bootstrap',
  })
  document.body.textContent =
    'Privacy Filter could not start because the root element is missing.'
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <RuntimeErrorBoundary>
        <App />
      </RuntimeErrorBoundary>
    </StrictMode>,
  )
}
