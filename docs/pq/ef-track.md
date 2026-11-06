# EF Mumbai integration and deployment status

Checked on November 6, 2026. The [EF prize page](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation) has separate Anon-RPC, frame alternative mempool, and CROPS tracks. It permits one EF prize per project. Anon-RPC qualification requires anonymous RPC reads by default; alternative mempool qualification requires actual sidecar submission or an admitted transaction. A native frame receipt alone does not establish alternative mempool use.

## Use Nym for anonymous browser reads

The default is `@anon-rpc/browser-harness` 0.4.0 with the official Nym specifier on Ethereum mainnet:

```
0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0
```

The [official wallet guide](https://ethereum.github.io/anon-rpc/wallets/) documents this worker. Nym needs no Tor KPS gateway configuration. Its approximately 18 MB bundle and mixnet connection can delay startup. Worker readiness is separate from a successful RPC request; new account creation checks the RPC chain before asking the helper to provision or fund anything.

The direct bootstrap endpoint, `https://ethereum-rpc.publicnode.com`, reads the worker specifier. Browser chain requests then use the sandboxed, hash-pinned worker to reach `https://rpc1.privacy.ethrex.xyz`. Connection failures stop reads; they do not enable direct fallback. The local gas/proof helper and CLI diagnostics use direct RPC. Passthrough is explicitly non-anonymous and is not the default. Tor is an optional separately configured worker, not a silent fallback.

## Keep the active deployment distinct from the EF sidecar devnet

| Purpose | Network / endpoint | Current status |
| --- | --- | --- |
| Active PQ wallet and privacy pool | Ethrex chain **8141**, `https://rpc1.privacy.ethrex.xyz` | Deployed; manifest pins genesis, anchor, and runtimes |
| EF frame execution RPC | Chain **1337**, `https://altmempool.forshtat.com` | Reachable; not the active QRAFT deployment |
| EF mining sidecar | `https://altmempool.forshtat.com/rpc` | Alternative mempool endpoint |
| EF gateway sidecar | `https://altmempoolgateway.forshtat.com/rpc` | Workshop submission endpoint; gossips to miner and forwards reads |
| EF explorer | `https://explorer.altmempool.wtf/` | Use for admission/inclusion evidence |

The [devnet guide](https://docs.altmempool.wtf/guides/devnet/) documents chain 1337 and the execution/mining endpoints. The [workshop source](https://github.com/forshtat/mempool-workshop) uses the gateway endpoint. Both networks answered chain-ID probes during this check. Endpoint availability does not establish contract compatibility or admission.

For an EF alternative mempool deployment, deploy **both the paymaster and privacy pool on chain 1337**, alongside compatible account factory, ML-DSA verifier, and proof-verifier infrastructure. The current chain-8141 manifest must not be pointed at chain 1337: those addresses, code hashes, notes, and transaction encoding belong to the existing deployment.

Before that deployment:

1. Pin the execution fork and sidecar version from the workshop, and inspect live `skandha_config`. The workshop pins EIP revisions; it does not promise compatibility with every latest draft.
2. Port and test frame encoding, verification prefix, keyed nonces (nonce manager `0x…8250`), recent roots (`0x…8272`), gas accounting, and paymaster sponsorship against that fork. Existing chain-8141 raw frames are not evidence of compatibility.
3. Deploy and fund the compatible infrastructure. Verify factory/paymaster stake, delay, reputation, and storage access against actual sidecar admission rules. Keep user authorization ML-DSA; an operator funding transaction does not make transport or consensus post-quantum.
4. Produce a separate chain-1337 manifest with independently checked genesis, anchor, runtimes, account configuration, pool denomination, and addresses. Preserve existing chain-8141 note recovery.
5. Submit through `eth_sendFrameTransaction` to the gateway sidecar, inspect admission/status and `eth_getFrameTransactionReceipt`, and save explorer evidence. Direct execution `eth_sendRawTransaction` or privileged submission bypasses this admission evidence.

The current workshop documents a faucet; the generated devnet guide still describes shared-key funding and no faucet. Prefer current workshop source and the live explorer, and recheck before funding. These are disposable devnets that can reset.

## What the application currently demonstrates

The active chain-8141 application has recorded a native 0.0001 ETH deposit, browser V5 proof, 663 public verifier calls, recovery after a browser restart, and exact native ETH withdrawal. See [recorded integration evidence](application-checks.json). That prior run is not a fresh sidecar test.

The active chain-8141 pools have bounded paymasters for native deposit and withdrawal gas. The helper uses native operator frames for public setup and computation, including factory account creation and test principal funding. **Chain-1337 alternative mempool submission is not implemented.** No ERC-4337 paymaster or bundler endpoint is interchangeable with this EIP-8141 sidecar.

ML-DSA authorization, SHA3-512 notes, and the transparent proof are the application security scope. The proof remains experimental. Ethereum/devnet consensus, Nym, TLS, operator gas keys, and availability have separate limits. See [security boundaries](application-security.md).
