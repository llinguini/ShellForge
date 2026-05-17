fn main() {
    let target = std::env::var("TARGET").expect("TARGET must be set by Cargo");
    println!("cargo:rustc-env=BUILD_TARGET_TRIPLE={target}");
    tauri_build::build();
}
