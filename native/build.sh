#!/bin/sh
# C++ -> WebAssembly, no Emscripten needed: plain clang + wasm-ld. Output is committed (src/wasm/*.wasm), so the
# site builds without a C++ toolchain; run this after changing native/*.cpp.
set -e
cd "$(dirname "$0")"
clang --target=wasm32 -mbulk-memory -O3 -nostdlib -fno-exceptions -fno-rtti -ffast-math -flto \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--lto-O3 -Wl,-z,stack-size=1048576 \
  -o ../src/wasm/shipnav.wasm shipnav.cpp
ls -l ../src/wasm/shipnav.wasm
