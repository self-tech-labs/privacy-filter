use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

mod document_batch;

const LOG_FILE_NAME: &str = "ogram-private-runtime";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();

    tauri::Builder::default()
        .plugin(runtime_log_plugin())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!(target: "runtime", "single-instance activation received");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            document_batch::extract_privacy_file,
            document_batch::scan_privacy_folder,
            document_batch::write_privacy_manifest,
            document_batch::write_privacy_output,
        ])
        .setup(|app| {
            match app.path().app_log_dir() {
                Ok(path) => {
                    log::info!(target: "runtime", "runtime log directory: {}", path.display());
                }
                Err(error) => {
                    log::warn!(target: "runtime", "could not resolve runtime log directory: {error}");
                }
            }

            log::info!(
                target: "runtime",
                "app setup complete; os={} arch={} debug={}",
                std::env::consts::OS,
                std::env::consts::ARCH,
                cfg!(debug_assertions)
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn runtime_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("tao", log::LevelFilter::Warn)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .max_file_size(1_000_000)
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            }),
        ])
        .build()
}

fn install_panic_logger() {
    std::panic::set_hook(Box::new(|panic_info| {
        log::error!(target: "panic", "panic captured: {panic_info}");
    }));
}
