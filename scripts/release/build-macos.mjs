import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
const macBundleDir = join(
  projectRoot,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'macos',
)
const updaterOutputDir = join(
  projectRoot,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'updater',
)

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

function runAndCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to run ${command}`)
  }

  return result.stdout
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

function notarizationMode() {
  const hasApiAuth =
    Boolean(process.env.APPLE_API_KEY) &&
    Boolean(process.env.APPLE_API_ISSUER) &&
    (Boolean(process.env.APPLE_API_KEY_PATH) ||
      Boolean(process.env.API_PRIVATE_KEYS_DIR))
  const hasAppleIdAuth =
    Boolean(process.env.APPLE_ID) &&
    Boolean(process.env.APPLE_PASSWORD) &&
    Boolean(process.env.APPLE_TEAM_ID)

  if (hasApiAuth) return 'app-store-connect'
  if (hasAppleIdAuth) return 'apple-id'
  return 'local-only'
}

function printReleaseContext() {
  const notarization = notarizationMode()
  const signingIdentity =
    process.env.APPLE_SIGNING_IDENTITY?.trim() || 'not configured'

  console.log(`Release mode: macOS`)
  console.log(`Signing identity: ${signingIdentity}`)
  console.log(`Notarization: ${notarization}`)

  if (notarization === 'local-only') {
    console.warn(
      'No notarization credentials detected. Generated artifacts will be suitable for local validation, not final browser download distribution.',
    )
  }
}

function currentArch() {
  if (process.env.OGRAM_RELEASE_ARCH) {
    return process.env.OGRAM_RELEASE_ARCH
  }

  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'x64') return 'x86_64'
  return process.arch
}

function updaterPlatformKey() {
  return `darwin-${currentArch()}`
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

function writeStaticManifest() {
  const tauriConfig = readJson(tauriConfigPath)
  const version = String(tauriConfig.version)
  const bundleUrlBase =
    process.env.OGRAM_RELEASE_BASE_URL?.trim() ||
    'https://downloads.ogram.ch/private'
  const updaterArchive = latestFileBySuffix(macBundleDir, '.app.tar.gz')
  const signaturePath = `${updaterArchive}.sig`

  if (!existsSync(signaturePath)) {
    throw new Error(
      `Missing updater signature: ${signaturePath}. Build the app bundle with an updater private key first.`,
    )
  }

  const archiveName = updaterArchive.split('/').at(-1)
  const signature = readFileSync(signaturePath, 'utf8').trim()
  const notes =
    process.env.OGRAM_RELEASE_NOTES?.trim() ||
    `ogram private ${version}`

  mkdirSync(updaterOutputDir, { recursive: true })

  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [updaterPlatformKey()]: {
        signature,
        url: `${bundleUrlBase}/${archiveName}`,
      },
    },
  }

  const outputPath = join(updaterOutputDir, 'latest.json')
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote static updater manifest to ${outputPath}`)
}

function cleanupStaleRwDmgFiles() {
  if (!existsSync(macBundleDir)) {
    return
  }

  for (const entry of readdirSync(macBundleDir)) {
    if (entry.startsWith('rw.') && entry.endsWith('.dmg')) {
      rmSync(join(macBundleDir, entry), { force: true })
    }
  }
}

function detachMountedProjectImages() {
  const info = runAndCapture('hdiutil', ['info'])
  const sections = info.split('================================================')

  for (const section of sections) {
    const imagePathMatch = section.match(/image-path\s+:\s+(.+)/)
    const deviceMatch = section.match(/(\/dev\/disk\d+)/)

    if (!imagePathMatch || !deviceMatch) {
      continue
    }

    const imagePath = imagePathMatch[1].trim()
    const device = deviceMatch[1].trim()

    if (
      imagePath.startsWith(join(projectRoot, 'src-tauri', 'target')) &&
      imagePath.includes('/bundle/macos/rw.')
    ) {
      run('hdiutil', ['detach', device])
    }
  }
}

function buildAppBundle() {
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: resolveSigningKey(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  }

  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH

  run('npx', ['tauri', 'build', '--bundles', 'app'], env)
  writeStaticManifest()
}

function buildDmgBundle() {
  detachMountedProjectImages()
  cleanupStaleRwDmgFiles()

  const configOverride = JSON.stringify({
    bundle: {
      createUpdaterArtifacts: false,
    },
  })

  run('npx', ['tauri', 'build', '--bundles', 'dmg', '--config', configOverride])
}

function main() {
  const mode = process.argv[2] ?? 'all'

  printReleaseContext()

  if (mode === 'app') {
    buildAppBundle()
    return
  }

  if (mode === 'dmg') {
    buildDmgBundle()
    return
  }

  if (mode === 'manifest') {
    writeStaticManifest()
    return
  }

  if (mode === 'all') {
    buildAppBundle()
    buildDmgBundle()
    return
  }

  throw new Error(`Unsupported mode: ${mode}`)
}

main()
