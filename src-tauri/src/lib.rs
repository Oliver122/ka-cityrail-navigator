mod db;
mod helpers;
mod kvv;
mod network;
mod schema;
mod types;

use db::establish_connection;
use diesel::sqlite::SqliteConnection;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<SqliteConnection>,
    pub http: reqwest::Client,
}

fn get_db_path(app: &tauri::AppHandle) -> String {
    #[cfg(target_os = "android")]
    {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .expect("Failed to resolve Android app data directory");
        std::fs::create_dir_all(&app_data_dir)
            .expect("Failed to create Android app data directory");
        return app_data_dir.join("stops.db").to_string_lossy().to_string();
    }

    #[cfg(not(target_os = "android"))]
    {
        let data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        let app_dir = data_dir.join("ka-cityrail-navigator");
        std::fs::create_dir_all(&app_dir).ok();
        let _ = app;
        app_dir.join("stops.db").to_string_lossy().to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = get_db_path(app.handle());
            let conn = establish_connection(&db_path);
            let http = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(5))
                .pool_max_idle_per_host(4)
                .build()
                .expect("failed to create HTTP client");
            app.manage(AppState {
                db: Mutex::new(conn),
                http,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kvv::fetch_and_store_stop,
            kvv::fetch_and_store_stops,
            kvv::fetch_stops_in_bounds,
            kvv::fetch_stops_near,
            kvv::get_stops,
            kvv::fetch_departures,
            kvv::search_stops,
            kvv::search_stops_db,
            kvv::fetch_trip_stopseq,
            network::get_current_connection,
            network::check_current_network,
            network::get_networks,
            network::add_network,
            network::remove_network,
            network::pin_stop_to_network,
            network::unpin_stop_from_network,
            network::get_network_stops,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
