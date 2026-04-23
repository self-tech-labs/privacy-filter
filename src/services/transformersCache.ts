import { isTauri } from '@tauri-apps/api/core'
import { BaseDirectory } from '@tauri-apps/api/path'
import {
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'

const CACHE_ROOT = 'transformers-cache'

interface CachedResponseMetadata {
  headers: Record<string, string>
}

interface MemoryCacheEntry {
  body: Uint8Array
  headers: Record<string, string>
}

const browserCache = new Map<string, MemoryCacheEntry>()

async function hashKey(key: string) {
  const input = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function resolveCachePaths(key: string) {
  const hashed = await hashKey(key)
  return {
    dataPath: `${CACHE_ROOT}/${hashed}.bin`,
    metadataPath: `${CACHE_ROOT}/${hashed}.json`,
  }
}

async function ensureCacheRoot() {
  await mkdir(CACHE_ROOT, { baseDir: BaseDirectory.AppCache, recursive: true })
}

export function createTauriCustomCache() {
  if (!isTauri()) {
    return {
      async match(key: string) {
        const cached = browserCache.get(key)

        if (!cached) {
          return undefined
        }

        return new Response(cached.body.slice(), {
          headers: cached.headers,
        })
      },

      async put(key: string, response: Response) {
        const clone = response.clone()
        browserCache.set(key, {
          body: new Uint8Array(await clone.arrayBuffer()),
          headers: Object.fromEntries(clone.headers.entries()),
        })
      },

      async delete(key: string) {
        return browserCache.delete(key)
      },
    }
  }

  return {
    async match(key: string) {
      await ensureCacheRoot()
      const { dataPath, metadataPath } = await resolveCachePaths(key)

      if (!(await exists(dataPath, { baseDir: BaseDirectory.AppCache }))) {
        return undefined
      }

      const data = await readFile(dataPath, { baseDir: BaseDirectory.AppCache })
      let metadata: CachedResponseMetadata | null = null

      if (await exists(metadataPath, { baseDir: BaseDirectory.AppCache })) {
        const content = await readFile(metadataPath, {
          baseDir: BaseDirectory.AppCache,
        })
        metadata = JSON.parse(new TextDecoder().decode(content))
      }

      return new Response(data, {
        headers: metadata?.headers,
      })
    },

    async put(key: string, response: Response) {
      await ensureCacheRoot()
      const clone = response.clone()
      const bytes = new Uint8Array(await clone.arrayBuffer())
      const { dataPath, metadataPath } = await resolveCachePaths(key)

      await writeFile(dataPath, bytes, { baseDir: BaseDirectory.AppCache })
      await writeTextFile(
        metadataPath,
        JSON.stringify({
          headers: Object.fromEntries(clone.headers.entries()),
        } satisfies CachedResponseMetadata),
        { baseDir: BaseDirectory.AppCache },
      )
    },

    async delete(key: string) {
      const { dataPath, metadataPath } = await resolveCachePaths(key)
      let removed = false

      if (await exists(dataPath, { baseDir: BaseDirectory.AppCache })) {
        await remove(dataPath, { baseDir: BaseDirectory.AppCache })
        removed = true
      }

      if (await exists(metadataPath, { baseDir: BaseDirectory.AppCache })) {
        await remove(metadataPath, { baseDir: BaseDirectory.AppCache })
        removed = true
      }

      return removed
    },
  }
}
