#!/bin/bash
# Tiny compile/link probes only; no browser build or dependency installation.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
mkdir -p "$root/.surfer/validation"
probe=$(mktemp -d "$root/.surfer/validation/toolchain.XXXXXX")
clang="$HOME/.mozbuild/clang/bin/clang"
clangxx="$HOME/.mozbuild/clang/bin/clang++"
rustc="$HOME/.rustup/toolchains/1.95.0-aarch64-apple-darwin/bin/rustc"
sdk=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
"$clang" --version
"$rustc" -Vv
printf 'int main(void) { return 0; }\n' > "$probe/main.c"
printf 'fn main() {}\n' > "$probe/main.rs"
for cpu in apple-m4 apple-m5; do
  "$clang" -mcpu="$cpu" -isysroot "$sdk" "$probe/main.c" -o "$probe/c-$cpu"
  "$clangxx" -x c++ -mcpu="$cpu" -isysroot "$sdk" "$probe/main.c" -o "$probe/cxx-$cpu"
  "$rustc" -C "target-cpu=$cpu" "$probe/main.rs" -o "$probe/rust-$cpu"
  "$probe/c-$cpu"; "$probe/cxx-$cpu"; "$probe/rust-$cpu"
  echo "$cpu: C/C++/Rust compile and run passed"
done
cat > "$probe/cross.rs" <<'RS'
#![no_std]
#[no_mangle]
pub extern "C" fn rust_add(a: i32, b: i32) -> i32 { a + b }
RS
cat > "$probe/cross.c" <<'C'
extern int rust_add(int, int);
int main(void) { return rust_add(20, 22) != 42; }
C
"$rustc" --crate-type lib --emit=obj -C opt-level=2 -C panic=abort -C target-cpu=apple-m5 -C linker-plugin-lto "$probe/cross.rs" -o "$probe/cross-rust.o"
"$clang" -O3 -mcpu=apple-m5 -flto=thin -fuse-ld=lld -Wl,--threads=1,--thinlto-jobs=1 -isysroot "$sdk" "$probe/cross.c" "$probe/cross-rust.o" -o "$probe/cross"
"$probe/cross"
echo "Cross-language ThinLTO link/run passed; probes retained at $probe"
