# QRAFT Namespace Cleanup Implementation Plan

**Goal:** Give source code, proof profiles and packaged browser artifacts a consistent QRAFT namespace.

**Architecture:** Rename packages and bindings together; change domain separators in both native and Solidity implementations. Rebuild generated assets and mark the previous deployment unavailable for the new protocol. Preserve upstream dependency licenses.

**Tech Stack:** TypeScript, Rust, Solidity, wasm-bindgen, Next.js.

1. Rename source identifiers, crate names, proof profiles and domain strings across tracked files.
2. Correct lengths and encoded constants affected by the shorter namespace; regenerate WASM and checksums.
3. Gate transaction submission until compatible contracts are deployed, and document the deployment requirement.
4. Verify native, browser and application checks; scan file contents, binaries and paths.
5. Prepare a clean Git snapshot on a separate branch with no historical commits, retaining recovery material outside the project. Publish history replacement only through an explicitly authorized operation.
