import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import type {
  ExtractedPrivacyFile,
  PrivacyFolderScan,
  PrivacyWriteResult,
} from '../types/privacy'

export async function pickPrivacyFolder(title: string): Promise<string | null> {
  if (!isTauri()) {
    throw new Error('Folder processing is available in the desktop app.')
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })

  return typeof selected === 'string' ? selected : null
}

export async function scanPrivacyFolder(
  inputRoot: string,
): Promise<PrivacyFolderScan> {
  return invoke<PrivacyFolderScan>('scan_privacy_folder', { inputRoot })
}

export async function extractPrivacyFile(
  inputRoot: string,
  filePath: string,
): Promise<ExtractedPrivacyFile> {
  return invoke<ExtractedPrivacyFile>('extract_privacy_file', {
    inputRoot,
    filePath,
  })
}

export async function writePrivacyOutput(
  outputRoot: string,
  outputRelativePath: string,
  redactedMarkdown: string,
): Promise<PrivacyWriteResult> {
  return invoke<PrivacyWriteResult>('write_privacy_output', {
    outputRoot,
    outputRelativePath,
    redactedMarkdown,
  })
}

export async function writePrivacyManifest(
  outputRoot: string,
  manifest: unknown,
): Promise<PrivacyWriteResult> {
  return invoke<PrivacyWriteResult>('write_privacy_manifest', {
    outputRoot,
    manifest,
  })
}
