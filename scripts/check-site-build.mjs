import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outDir = resolve('site-dist')

if (!existsSync(outDir)) {
  throw new Error('Missing site-dist output. Run `npm run site:build` first.')
}

const files = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      walk(fullPath)
      continue
    }

    files.push(fullPath)
  }
}

walk(outDir)

if (!files.some((file) => file.endsWith('index.html'))) {
  throw new Error('GitHub Pages build is missing index.html.')
}

const forbiddenFile = files.find((file) => /ort|onnx|\.wasm$/i.test(file))

if (forbiddenFile) {
  throw new Error(`Unexpected desktop/model asset in site build: ${forbiddenFile}`)
}

for (const file of files) {
  if (!/\.(html|css|js)$/.test(file)) {
    continue
  }

  const content = readFileSync(file, 'utf8')

  if (/ort-wasm|onnxruntime/i.test(content)) {
    throw new Error(`Unexpected model reference in site build output: ${file}`)
  }
}

console.log('Site build smoke test passed.')
