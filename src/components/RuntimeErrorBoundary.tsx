import { Component, type ErrorInfo, type ReactNode } from 'react'

import {
  getRuntimeLogPath,
  logRuntimeEvent,
  serializeError,
} from '../services/runtimeLogging'

interface RuntimeErrorBoundaryProps {
  children: ReactNode
}

interface RuntimeErrorBoundaryState {
  error: string | null
  logPath: string | null
}

export class RuntimeErrorBoundary extends Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = {
    error: null,
    logPath: null,
  }

  static getDerivedStateFromError(error: unknown): RuntimeErrorBoundaryState {
    return {
      error: serializeError(error),
      logPath: null,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void logRuntimeEvent('error', 'React runtime error boundary caught an error', {
      location: 'react-error-boundary',
      error: serializeError(error),
      componentStack: errorInfo.componentStack ?? '',
    })

    void getRuntimeLogPath().then((logPath) => {
      this.setState({ logPath })
    })
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <main className="app-shell">
        <section className="fatal-screen" role="alert">
          <div>
            <p className="surface-eyebrow">Runtime error</p>
            <h1>Privacy Filter could not finish rendering.</h1>
            <p>
              The app caught the failure instead of leaving a blank screen. Restart
              the app, then include the runtime log path below when reporting the
              issue.
            </p>
          </div>

          <pre>{this.state.error}</pre>

          {this.state.logPath ? (
            <p className="fatal-screen__log">
              Runtime log: <span>{this.state.logPath}</span>
            </p>
          ) : null}
        </section>
      </main>
    )
  }
}
