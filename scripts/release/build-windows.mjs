import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '../..')
const tauriConfigPath = join(projectRoot, 'src-tauri', 'tauri.conf.json')
const defaultSigningKeyPath = join(
  projectRoot,
  '.tauri',
  'updater',
  'private.key',
)
const nsisBundleDir = join(
  projectRoot,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'nsis',
)
const msiBundleDir = join(
  projectRoot,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'msi',
)
const updaterOutputDir = join(
  projectRoot,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'updater',
)

function commandName(command) {
  if (process.platform === 'win32') {
    return `${command}.cmd`
  }

  return command
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function resolveSigningKey() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    return process.env.TAURI_SIGNING_PRIVATE_KEY.trim()
  }

  const pathFromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim()
  const candidatePath =
    pathFromEnv && existsSync(pathFromEnv) ? pathFromEnv : defaultSigningKeyPath

  if (!existsSync(candidatePath)) {
    throw new Error(
      [
        'Missing updater private key.',
        `Expected TAURI_SIGNING_PRIVATE_KEY or a key file at ${candidatePath}.`,
        'Generate one with: npx tauri signer generate -- -w .tauri/updater/private.key',
      ].join(' '),
    )
  }

  return readFileSync(candidatePath, 'utf8').trim()
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function optionalWindowsSigningConfig() {
  const signCommand = process.env.WINDOWS_SIGN_COMMAND?.trim()

  if (signCommand) {
    return {
      bundle: {
        windows: {
          signCommand: parseSignCommand(signCommand),
        },
      },
    }
  }

  const certificateThumbprint =
    process.env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim()

  if (!certificateThumbprint) {
    return null
  }

  const windows = {
    certificateThumbprint,
    digestAlgorithm: process.env.WINDOWS_DIGEST_ALGORITHM?.trim() || 'sha256',
  }

  if (process.env.WINDOWS_TIMESTAMP_URL?.trim()) {
    windows.timestampUrl = process.env.WINDOWS_TIMESTAMP_URL.trim()
  }

  if (process.env.WINDOWS_TSP?.trim()) {
    windows.tsp = parseBoolean(process.env.WINDOWS_TSP)
  }

  return {
    bundle: {
      windows,
    },
  }
}

function parseSignCommand(signCommand) {
  const trimmed = signCommand.trim()

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }

  return trimmed
}

function currentArch() {
  if (process.env.OGRAM_RELEASE_ARCH) {
    return process.env.OGRAM_RELEASE_ARCH
  }

  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'ia32') return 'i686'
  return process.arch
}

function updaterPlatformKey() {
  return `windows-${currentArch()}`
}

function latestFileBySuffix(directory, suffix) {
  if (!existsSync(directory)) {
    throw new Error(`Missing bundle directory: ${directory}`)
  }

  const candidates = readdirSync(directory)
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => ({
      path: join(directory, entry),
      mtimeMs: statSync(join(directory, entry)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  if (candidates.length === 0) {
    throw new Error(`No file ending with ${suffix} found in ${directory}`)
  }

  return candidates[0].path
}

function updaterArtifact(target) {
  if (target === 'msi') {
    return latestFileBySuffix(msiBundleDir, '.msi')
  }

  return latestFileBySuffix(nsisBundleDir, '.exe')
}

function preferredUpdaterTarget(requestedTargets) {
  const configuredTarget = process.env.OGRAM_WINDOWS_UPDATER_BUNDLE?.trim()

  if (configuredTarget) {
    if (!['nsis', 'msi'].includes(configuredTarget)) {
      throw new Error(
        'Unsupported OGRAM_WINDOWS_UPDATER_BUNDLE value. Use nsis or msi.',
      )
    }

    return configuredTarget
  }

  if (requestedTargets.includes('nsis')) return 'nsis'
  return requestedTargets[0]
}

function writeStaticManifest(target) {
  const tauriConfig = readJson(tauriConfigPath)
  const version = String(tauriConfig.version)
  const bundleUrlBase =
    process.env.OGRAM_RELEASE_BASE_URL?.trim() ||
    'https://downloads.ogram.ch/private'
  const bundlePath = updaterArtifact(target)
  const signaturePath = `${bundlePath}.sig`

  if (!existsSync(signaturePath)) {
    throw new Error(
      `Missing updater signature: ${signaturePath}. Build the Windows bundle with an updater private key first.`,
    )
  }

  const bundleName = basename(bundlePath)
  const signature = readFileSync(signaturePath, 'utf8').trim()
  const notes =
    process.env.OGRAM_RELEASE_NOTES?.trim() || `ogram private ${version}`

  mkdirSync(updaterOutputDir, { recursive: true })

  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [updaterPlatformKey()]: {
        signature,
        url: `${bundleUrlBase}/${bundleName}`,
      },
    },
  }

  const outputPath = join(updaterOutputDir, 'latest-windows.json')
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote Windows updater manifest to ${outputPath}`)
}

function printReleaseContext(targets) {
  const hasCertificate = Boolean(
    process.env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim(),
  )
  const hasCustomSignCommand = Boolean(process.env.WINDOWS_SIGN_COMMAND?.trim())

  console.log(`Release mode: Windows`)
  console.log(`Installer targets: ${targets.join(', ')}`)
  console.log(
    `Code signing: ${
      hasCustomSignCommand
        ? 'custom sign command'
        : hasCertificate
          ? 'certificate thumbprint'
          : 'not configured'
    }`,
  )

  if (!hasCertificate && !hasCustomSignCommand) {
    console.warn(
      'No Windows code signing configuration detected. The installer can be built, but browser downloads may show Microsoft SmartScreen warnings.',
    )
  }
}

function buildWindowsBundles(targets) {
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: resolveSigningKey(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  }

  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH

  const args = ['tauri', 'build', '--bundles', targets.join(','), '--ci']
  const signingConfig = optionalWindowsSigningConfig()

  if (signingConfig) {
    args.push('--config', JSON.stringify(signingConfig))
  }

  run(commandName('npx'), args, env)
  writeStaticManifest(preferredUpdaterTarget(targets))
}

function targetsForMode(mode) {
  if (mode === 'nsis') return ['nsis']
  if (mode === 'msi') return ['msi']
  if (mode === 'all') return ['nsis', 'msi']

  throw new Error(`Unsupported mode: ${mode}`)
}

function main() {
  const mode = process.argv[2] ?? 'nsis'

  if (mode === 'manifest') {
    writeStaticManifest(
      process.env.OGRAM_WINDOWS_UPDATER_BUNDLE?.trim() || 'nsis',
    )
    return
  }

  const targets = targetsForMode(mode)
  printReleaseContext(targets)
  buildWindowsBundles(targets)
}

main()
