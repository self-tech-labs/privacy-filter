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

import {
  fireAndForgetRuntimeLog,
  serializeError,
} from './runtimeLogging'

const CACHE_ROOT = 'transformers-cache'

interface CachedResponseMetadata {
  headers: Record<string, string>
}

interface MemoryCacheEntry {
  body: Uint8Array
  headers: Record<string, string>
}

const browserCache = new Map<string, MemoryCacheEntry>()

export async function clearTransformersCache(): Promise<boolean> {
  if (!isTauri()) {
    const hadEntries = browserCache.size > 0
    browserCache.clear()
    return hadEntries
  }

  try {
    if (!(await exists(CACHE_ROOT, { baseDir: BaseDirectory.AppCache }))) {
      return false
    }

    await remove(CACHE_ROOT, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    })
    fireAndForgetRuntimeLog('warn', 'Model cache cleared for retry', {
      location: 'transformers-cache',
    })
    return true
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Could not clear model cache for retry', {
      location: 'transformers-cache',
      error: serializeError(error),
    })
    return false
  }
}

async function hashKey(key: string) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    fireAndForgetRuntimeLog('warn', 'Crypto subtle API unavailable for cache hashing', {
      location: 'transformers-cache',
    })
    return fallbackHashKey(key)
  }

  const input = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function fallbackHashKey(key: string) {
  let hash = 0x811c9dc5

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fallback-${(hash >>> 0).toString(16)}`
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

async function readMetadata(
  metadataPath: string,
): Promise<CachedResponseMetadata | null> {
  if (!(await exists(metadataPath, { baseDir: BaseDirectory.AppCache }))) {
    return null
  }

  try {
    const content = await readFile(metadataPath, {
      baseDir: BaseDirectory.AppCache,
    })
    const metadata = JSON.parse(new TextDecoder().decode(content)) as Partial<
      CachedResponseMetadata
    >

    return metadata.headers && typeof metadata.headers === 'object'
      ? { headers: metadata.headers as Record<string, string> }
      : null
  } catch (error) {
    fireAndForgetRuntimeLog('warn', 'Ignoring corrupt model cache metadata', {
      location: 'transformers-cache',
      error: serializeError(error),
    })
    return null
  }
}

export function createTauriCustomCache() {
  if (!isTauri()) {
    return {
      async match(key: string) {
        try {
          const cached = browserCache.get(key)

          if (!cached) {
            return undefined
          }

          return new Response(cached.body.slice(), {
            headers: cached.headers,
          })
        } catch (error) {
          fireAndForgetRuntimeLog('warn', 'Browser model cache match failed', {
            location: 'transformers-cache',
            error: serializeError(error),
          })
          return undefined
        }
      },

      async put(key: string, response: Response) {
        try {
          const clone = response.clone()
          browserCache.set(key, {
            body: new Uint8Array(await clone.arrayBuffer()),
            headers: Object.fromEntries(clone.headers.entries()),
          })
        } catch (error) {
          fireAndForgetRuntimeLog('warn', 'Browser model cache put failed', {
            location: 'transformers-cache',
            error: serializeError(error),
          })
        }
      },

      async delete(key: string) {
        try {
          return browserCache.delete(key)
        } catch (error) {
          fireAndForgetRuntimeLog('warn', 'Browser model cache delete failed', {
            location: 'transformers-cache',
            error: serializeError(error),
          })
          return false
        }
      },
    }
  }

  return {
    async match(key: string) {
      try {
        await ensureCacheRoot()
        const { dataPath, metadataPath } = await resolveCachePaths(key)

        if (!(await exists(dataPath, { baseDir: BaseDirectory.AppCache }))) {
          return undefined
        }

        const data = await readFile(dataPath, { baseDir: BaseDirectory.AppCache })
        const metadata = await readMetadata(metadataPath)

        return new Response(data, {
          headers: metadata?.headers,
        })
      } catch (error) {
        fireAndForgetRuntimeLog('warn', 'Tauri model cache match failed', {
          location: 'transformers-cache',
          error: serializeError(error),
        })
        return undefined
      }
    },

    async put(key: string, response: Response) {
      try {
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
      } catch (error) {
        fireAndForgetRuntimeLog('warn', 'Tauri model cache put failed', {
          location: 'transformers-cache',
          error: serializeError(error),
        })
      }
    },

    async delete(key: string) {
      try {
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
      } catch (error) {
        fireAndForgetRuntimeLog('warn', 'Tauri model cache delete failed', {
          location: 'transformers-cache',
          error: serializeError(error),
        })
        return false
      }
    },
  }
}
