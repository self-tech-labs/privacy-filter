import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const outDir = resolve('site-dist')
const host = '0.0.0.0'
const port = Number(process.env.PORT ?? 4175)
const basePath = '/privacy-filter'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
} 

function sendFile(response, filePath) {
  const type = contentTypes[extname(filePath)] ?? 'application/octet-stream'
  response.writeHead(200, { 'Content-Type': type })
  createReadStream(filePath).pipe(response)
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (url.pathname === '/') {
    response.writeHead(302, { Location: `${basePath}/` })
    response.end()
    return
  }

  if (!url.pathname.startsWith(`${basePath}/`)) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  const requested = url.pathname.slice(basePath.length + 1) || 'index.html'
  const filePath = resolve(outDir, requested)

  if (!filePath.startsWith(outDir)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  if (!existsSync(filePath)) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  const fileStats = await stat(filePath)

  if (!fileStats.isFile()) {
    response.writeHead(404)
    response.end('Not found')
    return
  }

  sendFile(response, filePath)
}).listen(port, host, () => {
  console.log(`Previewing site-dist at http://127.0.0.1:${port}${basePath}/`)
})
