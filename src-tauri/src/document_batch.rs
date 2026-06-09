use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyBatchFile {
    path: String,
    relative_path: String,
    output_relative_path: String,
    extension: String,
    bytes: u64,
    kind: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedPrivacyFile {
    path: String,
    relative_path: String,
    extension: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyFolderScan {
    input_root: String,
    files: Vec<PrivacyBatchFile>,
    unsupported: Vec<UnsupportedPrivacyFile>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedPrivacyFile {
    source_path: String,
    relative_path: String,
    output_relative_path: String,
    markdown: String,
    extractor: &'static str,
    warnings: Vec<String>,
    char_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyWriteResult {
    path: String,
    bytes: u64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_privacy_folder(input_root: String) -> Result<PrivacyFolderScan, String> {
    log::info!(target: "document_batch", "folder scan command started");
    let result =
        tauri::async_runtime::spawn_blocking(move || scan_privacy_folder_blocking(&input_root))
            .await
            .map_err(|error| format!("Folder scan failed: {error}"))?;

    match &result {
        Ok(scan) => log::info!(
            target: "document_batch",
            "folder scan command completed; files={} unsupported={} warnings={}",
            scan.files.len(),
            scan.unsupported.len(),
            scan.warnings.len()
        ),
        Err(error) => log::error!(target: "document_batch", "folder scan command failed: {error}"),
    }

    result
}

#[tauri::command(rename_all = "camelCase")]
pub async fn extract_privacy_file(
    input_root: String,
    file_path: String,
) -> Result<ExtractedPrivacyFile, String> {
    let extension = extension(Path::new(&file_path));
    log::info!(
        target: "document_batch",
        "file extraction command started; extension={extension}"
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        extract_privacy_file_blocking(&input_root, &file_path)
    })
    .await
    .map_err(|error| format!("Extraction failed: {error}"))?;

    match &result {
        Ok(extracted) => log::info!(
            target: "document_batch",
            "file extraction command completed; relative_path={} chars={} warnings={}",
            extracted.relative_path,
            extracted.char_count,
            extracted.warnings.len()
        ),
        Err(error) => {
            log::error!(target: "document_batch", "file extraction command failed: {error}")
        }
    }

    result
}

#[tauri::command(rename_all = "camelCase")]
pub async fn write_privacy_output(
    output_root: String,
    output_relative_path: String,
    redacted_markdown: String,
) -> Result<PrivacyWriteResult, String> {
    log::info!(target: "document_batch", "output write command started");
    let result = tauri::async_runtime::spawn_blocking(move || {
        write_text_under_root(&output_root, &output_relative_path, &redacted_markdown)
    })
    .await
    .map_err(|error| format!("Output write failed: {error}"))?;

    match &result {
        Ok(written) => log::info!(
            target: "document_batch",
            "output write command completed; bytes={}",
            written.bytes
        ),
        Err(error) => log::error!(target: "document_batch", "output write command failed: {error}"),
    }

    result
}

#[tauri::command(rename_all = "camelCase")]
pub async fn write_privacy_manifest(
    output_root: String,
    manifest: serde_json::Value,
) -> Result<PrivacyWriteResult, String> {
    log::info!(target: "document_batch", "manifest write command started");
    let result = tauri::async_runtime::spawn_blocking(move || {
        let content = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Could not encode manifest: {error}"))?;
        write_text_under_root(&output_root, "_privacy-filter-manifest.json", &content)
    })
    .await
    .map_err(|error| format!("Manifest write failed: {error}"))?;

    match &result {
        Ok(written) => log::info!(
            target: "document_batch",
            "manifest write command completed; bytes={}",
            written.bytes
        ),
        Err(error) => {
            log::error!(target: "document_batch", "manifest write command failed: {error}")
        }
    }

    result
}

fn scan_privacy_folder_blocking(input_root: &str) -> Result<PrivacyFolderScan, String> {
    let root = require_directory(input_root)?;
    let mut files = Vec::new();
    let mut unsupported = Vec::new();
    let mut warnings = Vec::new();

    for entry in WalkDir::new(&root).follow_links(false).sort_by_file_name() {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let relative = relative_path(&root, path)?;
        let extension = extension(path);

        if let Some(kind) = supported_kind(&extension) {
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Could not read file metadata: {error}"))?;
            files.push(PrivacyBatchFile {
                path: path_to_string(path),
                relative_path: slash_path(&relative),
                output_relative_path: output_relative_path(&relative),
                extension,
                bytes: metadata.len(),
                kind,
            });
        } else {
            unsupported.push(UnsupportedPrivacyFile {
                path: path_to_string(path),
                relative_path: slash_path(&relative),
                extension,
                reason: "Unsupported file extension".to_string(),
            });
        }
    }

    if files.is_empty() {
        warnings.push("No supported files were found in this folder.".to_string());
    }

    Ok(PrivacyFolderScan {
        input_root: path_to_string(&root),
        files,
        unsupported,
        warnings,
    })
}

fn extract_privacy_file_blocking(
    input_root: &str,
    file_path: &str,
) -> Result<ExtractedPrivacyFile, String> {
    let root = require_directory(input_root)?;
    let path = require_file(file_path)?;
    let relative = relative_path(&root, &path)?;
    let extension = extension(&path);
    let kind = supported_kind(&extension)
        .ok_or_else(|| format!("Unsupported file extension: {extension}"))?;
    let mut warnings = Vec::new();
    let (markdown, extractor) = match kind {
        "office" => {
            let markdown = office_oxide::to_markdown(&path)
                .map_err(|error| format!("Could not extract Office document: {error}"))?;
            (markdown, "office_oxide")
        }
        "pdf" => {
            let text = pdf_extract::extract_text(&path)
                .map_err(|error| format!("Could not extract PDF text: {error}"))?;
            if meaningful_text_len(&text) < 24 {
                warnings.push(
                    "PDF text layer is empty or sparse; this may be a scanned PDF and needs OCR."
                        .to_string(),
                );
            }
            (text_to_markdown(&path, &text), "pdf-extract")
        }
        "text" => {
            let bytes = fs::read(&path).map_err(|error| format!("Could not read file: {error}"))?;
            let (text, used_lossy_utf8) = decode_utf8(bytes);
            if used_lossy_utf8 {
                warnings.push("File was not valid UTF-8; invalid bytes were replaced.".to_string());
            }
            (text_to_markdown(&path, &text), "utf8")
        }
        _ => return Err(format!("Unsupported file kind: {kind}")),
    };

    let markdown = normalize_markdown(markdown);
    if meaningful_text_len(&markdown) == 0 {
        warnings.push("No readable text was extracted from this file.".to_string());
    }

    Ok(ExtractedPrivacyFile {
        source_path: path_to_string(&path),
        relative_path: slash_path(&relative),
        output_relative_path: output_relative_path(&relative),
        char_count: markdown.chars().count(),
        markdown,
        extractor,
        warnings,
    })
}

fn write_text_under_root(
    output_root: &str,
    output_relative_path: &str,
    content: &str,
) -> Result<PrivacyWriteResult, String> {
    let root = PathBuf::from(output_root);
    if root.exists() && !root.is_dir() {
        return Err("Output path exists but is not a folder.".to_string());
    }
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create output folder: {error}"))?;

    let target = safe_join(&root, output_relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create output subfolder: {error}"))?;
    }

    fs::write(&target, content).map_err(|error| format!("Could not write output file: {error}"))?;
    let bytes = fs::metadata(&target)
        .map_err(|error| format!("Could not read output metadata: {error}"))?
        .len();

    Ok(PrivacyWriteResult {
        path: path_to_string(&target),
        bytes,
    })
}

fn require_directory(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err("Input folder does not exist or is not a folder.".to_string());
    }
    path.canonicalize()
        .map_err(|error| format!("Could not resolve input folder: {error}"))
}

fn require_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("Input file does not exist or is not a file.".to_string());
    }
    path.canonicalize()
        .map_err(|error| format!("Could not resolve input file: {error}"))
}

fn relative_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    path.strip_prefix(root)
        .map(Path::to_path_buf)
        .map_err(|_| "File is outside the selected input folder.".to_string())
}

fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("Output relative path must not be absolute.".to_string());
    }

    let mut target = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(part) => target.push(part),
            Component::CurDir => {}
            _ => return Err("Output relative path escapes the output folder.".to_string()),
        }
    }

    Ok(target)
}

fn supported_kind(extension: &str) -> Option<&'static str> {
    match extension {
        "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" => Some("office"),
        "pdf" => Some("pdf"),
        "csv" | "htm" | "html" | "json" | "jsonl" | "log" | "md" | "markdown" | "rtf" | "text"
        | "tsv" | "txt" | "xml" | "yaml" | "yml" => Some("text"),
        _ => None,
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn output_relative_path(relative: &Path) -> String {
    let mut output = PathBuf::from(relative);
    if let Some(file_name) = relative.file_name().and_then(|name| name.to_str()) {
        output.set_file_name(format!("{file_name}.md"));
    }
    slash_path(&output)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn slash_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn decode_utf8(bytes: Vec<u8>) -> (String, bool) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(error) => (String::from_utf8_lossy(error.as_bytes()).into_owned(), true),
    }
}

fn text_to_markdown(path: &Path, text: &str) -> String {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document");
    format!("# {filename}\n\n{text}")
}

fn normalize_markdown(markdown: String) -> String {
    let markdown = markdown.replace("\r\n", "\n").replace('\r', "\n");
    format!("{}\n", markdown.trim())
}

fn meaningful_text_len(text: &str) -> usize {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_paths_preserve_original_extension() {
        assert_eq!(
            output_relative_path(Path::new("cases/report.pdf")),
            "cases/report.pdf.md"
        );
        assert_eq!(output_relative_path(Path::new("notes.txt")), "notes.txt.md");
    }

    #[test]
    fn safe_join_rejects_path_escape() {
        let root = Path::new("/tmp/privacy-output");
        assert!(safe_join(root, "case/file.pdf.md").is_ok());
        assert!(safe_join(root, "../case/file.pdf.md").is_err());
        assert!(safe_join(root, "/case/file.pdf.md").is_err());
    }

    #[test]
    fn supported_extensions_are_classified() {
        assert_eq!(supported_kind("docx"), Some("office"));
        assert_eq!(supported_kind("pdf"), Some("pdf"));
        assert_eq!(supported_kind("json"), Some("text"));
        assert_eq!(supported_kind("png"), None);
    }

    #[test]
    fn scan_and_extract_text_file() {
        let root =
            std::env::temp_dir().join(format!("privacy-filter-batch-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/case.txt"), "Alice Example").unwrap();
        fs::write(root.join("image.png"), [0_u8; 4]).unwrap();

        let scan = scan_privacy_folder_blocking(&path_to_string(&root)).unwrap();
        assert_eq!(scan.files.len(), 1);
        assert_eq!(scan.unsupported.len(), 1);
        assert_eq!(scan.files[0].relative_path, "nested/case.txt");
        assert_eq!(scan.files[0].output_relative_path, "nested/case.txt.md");

        let extracted = extract_privacy_file_blocking(
            &path_to_string(&root),
            &path_to_string(&root.join("nested/case.txt")),
        )
        .unwrap();
        assert!(extracted.markdown.contains("Alice Example"));
        assert_eq!(extracted.extractor, "utf8");

        fs::remove_dir_all(root).unwrap();
    }
}
