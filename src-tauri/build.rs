fn main() {
    // Load .env so variables are available during the build and forwarded to rustc
    if let Ok(path) = dotenvy::dotenv() {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    for var in ["KVV_EFA_BASE_URL", "KVV_COORD_BASE_URL"] {
        if let Ok(val) = std::env::var(var) {
            println!("cargo:rustc-env={var}={val}");
        }
        println!("cargo:rerun-if-env-changed={var}");
    }
    tauri_build::build()
}
