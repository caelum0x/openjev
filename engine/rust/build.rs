use std::path::PathBuf;

fn main() {
    let cpp = PathBuf::from("../cpp").canonicalize().expect("engine/cpp");
    println!("cargo:rustc-link-search=native={}", cpp.display());
    println!("cargo:rustc-link-lib=dylib=openjev");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", cpp.display());
    println!("cargo:rerun-if-changed=../cpp/libopenjev.so");
    println!("cargo:rerun-if-changed=../cpp/openjev.cpp");
}
