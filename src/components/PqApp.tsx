"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { Hex } from "viem";
import Link from "next/link";
import { WORDMARK } from "@/config/brand";
import { TRANSPORT } from "@/config/transport";
import { checkRecipient, formatEth, truncateMiddle } from "@/lib/format";
import { createAnonRpcTransport } from "@/lib/transport/anon-rpc";
import type { TransportStatus } from "@/lib/transport/types";
import { DEFAULT_PQ_POOL, PQ_POOLS, registeredPqPool, parseRegisteredPqNote } from '@/lib/pq/registry';
import { PqAccountClient, type PqSendResult } from "@/lib/pq/account";
import { createPqNote, serializePqNote, type PqNote } from "@/lib/pq/note";
import {
  PQ_DEPLOYMENT,
  PqIntentError,
  PqPoolClient,
  type PreparedPqWithdrawal,
} from "@/lib/pq/pool";
import {
  Button,
  Card,
  Hero,
  Mono,
  Notice,
  Rail,
  Row,
  RowGroup,
  StatusLine,
} from "./primitives";
import { Sheet } from "./Sheet";
import { WalletSetup, walletSetupStep, WALLET_SETUP_STEPS } from "./WalletSetup";
import { WalletPasskeyController, type WalletConnection } from "./WalletPasskeyController";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  RetryIcon,
} from "./icons";

const IDLE: TransportStatus = {
  phase: "idle",
  network: TRANSPORT.worker.label,
  detail: null,
  code: null,
  lastLatencyMs: null,
  requestCount: 0,
};
type Tab = "deposit" | "withdraw";
type DepositStage =
  | "amount"
  | "note"
  | "confirm"
  | "busy"
  | "receipt"
  | "unknown"
  | "failed";
type WithdrawStage =
  | "import"
  | "checking"
  | "status"
  | "recipient"
  | "review"
  | "busy"
  | "receipt"
  | "unknown"
  | "failed";
type NoteCheck = "spent" | "pending" | "unknown";
type Confirmed = Extract<PqSendResult, { kind: "confirmed" }>;

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof SyntaxError)
    return "That file could not be read. Choose the original saved file.";
  return error instanceof Error && error.message
    ? error.message.split("\n")[0]!
    : fallback;
}
function saveText(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function noteReference(note: PqNote) {
  return truncateMiddle(note.commitment, 10, 8);
}

function TransactionReference({ hash }: { hash: Hex }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2">
      <Mono>{truncateMiddle(hash, 10, 8)}</Mono>
      <button
        type="button"
        className="text-xs text-ink-60 underline underline-offset-4"
        onClick={() => {
          void navigator.clipboard.writeText(hash).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy hash"}
      </button>
    </div>
  );
}

function InclusionNotice() {
  return (
    <Notice tone="neutral" title="Keep your note securely">
      This receipt confirms inclusion, not finality. Keep the file through final
      settlement. A reorg can restore an unspent note; a leaked note can link a
      withdrawal to its deposit.
    </Notice>
  );
}

export function PqApp() {
  const transport = useMemo(
    () => (typeof window === "undefined" ? null : createAnonRpcTransport()),
    [],
  );
  const [selectedPool, setSelectedPool] = useState(DEFAULT_PQ_POOL);
  const pool = useMemo(
    () => (transport ? new PqPoolClient(transport, selectedPool) : null),
    [transport, selectedPool],
  );
  const subscribe = useMemo(
    () => (listener: () => void) =>
      transport ? transport.subscribe(() => listener()) : () => {},
    [transport],
  );
  const snapshot = useMemo(
    () => () => transport?.getStatus() ?? IDLE,
    [transport],
  );
  const status = useSyncExternalStore(subscribe, snapshot, () => IDLE);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const accountRef = useRef<PqAccountClient | null>(null);
  const creationSeed = useRef<Uint8Array | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({
    deposit: null,
    withdraw: null,
  });
  const walletInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("deposit");
  const [account, setAccount] = useState<PqAccountClient | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  const [walletDownloaded, setWalletDownloaded] = useState(false);
  const [walletAcknowledged, setWalletAcknowledged] = useState(false);
  const [walletBackedUp, setWalletBackedUp] = useState(false);
  const [serviceEnabled, setServiceEnabled] = useState<boolean | null>(null);
  const [serviceReason, setServiceReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "transaction" | "wallet:create" | "wallet:import">(false);
  const isBusy = Boolean(busy);
  const [progress, setProgress] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<number | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [unspent, setUnspent] = useState<number | null>(null);
  const [depositStage, setDepositStage] = useState<DepositStage>("amount");
  const [depositNote, setDepositNote] = useState<PqNote | null>(null);
  const [noteCopied, setNoteCopied] = useState(false);
  const [noteCopyFailed, setNoteCopyFailed] = useState(false);
  const [noteAcknowledged, setNoteAcknowledged] = useState(false);
  const [depositOwner, setDepositOwner] = useState<Hex | null>(null);
  const [depositResult, setDepositResult] = useState<PqSendResult | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [withdrawStage, setWithdrawStage] = useState<WithdrawStage>("import");
  const [withdrawNote, setWithdrawNote] = useState<PqNote | null>(null);
  const withdrawalPool = useMemo(() => transport && withdrawNote
    ? new PqPoolClient(transport, registeredPqPool(withdrawNote.pool)) : pool,
    [transport, withdrawNote, pool]);
  const AMOUNT = formatEth(BigInt(tab === "withdraw" && withdrawNote
    ? withdrawNote.denominationWei : selectedPool.denominationWei));
  const [noteCheck, setNoteCheck] = useState<NoteCheck>("unknown");
  const [recipient, setRecipient] = useState("");
  const [prepared, setPrepared] = useState<PreparedPqWithdrawal | null>(null);
  const [withdrawResult, setWithdrawResult] = useState<PqSendResult | null>(
    null,
  );
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawCancelable, setWithdrawCancelable] = useState(false);

  useEffect(() => {
    mounted.current = true;
    transport?.start();
    const controller = new AbortController();
    void fetch("/api/pq/accounts", { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as { enabled?: unknown; reason?: unknown };
        if (mounted.current) {
          setServiceEnabled(response.ok && result.enabled === true);
          setServiceReason(typeof result.reason === "string" ? result.reason : null);
        }
      })
      .catch(() => {
        if (mounted.current && !controller.signal.aborted) {
          setServiceEnabled(false);
          setServiceReason("The wallet service could not be reached. Refresh the page to retry.");
        }
      });
    return () => {
      mounted.current = false;
      controller.abort();
      abort.current?.abort();
      accountRef.current?.lock();
      creationSeed.current?.fill(0);
      creationSeed.current = null;
      transport?.stop();
    };
  }, [transport]);

  useEffect(() => {
    if (!pool || status.phase !== "ready") return;
    let alive = true;
    void pool.snapshot().then(
      (result) => {
        if (alive) {
          setUnspent(result.unspent);
          setReadError(null);
        }
      },
      (error) => {
        if (alive) {
          setUnspent(null);
          setReadError(safeMessage(error, "Pool reads are unavailable."));
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [pool, status.phase]);

  function updateProgress(label: string) {
    if (mounted.current) {
      setProgress(label);
      const step = walletSetupStep(label);
      if (step !== null) setSetupStep(step);
    }
  }
  async function refreshBalance(client: PqAccountClient) {
    try {
      const value = await client.balance();
      if (mounted.current && accountRef.current === client) setBalance(value);
    } catch {
      if (mounted.current && accountRef.current === client) setBalance(null);
    }
  }
  async function refreshPool() {
    if (!pool) return;
    if (mounted.current) setUnspent(null);
    try {
      const result = await pool.snapshot();
      if (mounted.current) {
        setUnspent(result.unspent);
        setReadError(null);
      }
    } catch {
      if (mounted.current)
        setReadError(
          "The latest anonymity set could not be read. Your confirmed receipt is unchanged.",
        );
    }
  }
  function begin(label: string, operation: "transaction" | "wallet:create" | "wallet:import" = "transaction"): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(operation);
    setProgress(label);
    return true;
  }
  function end() {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  }
  async function connectWallet(file?: File, setup: WalletConnection = {}): Promise<PqAccountClient | null> {
    if (!transport || (!setup.alreadyBusy && !begin(
      file ? "Checking the saved PQ wallet" : "Preparing your ML-DSA account",
      file ? "wallet:import" : "wallet:create",
    ))) return null;
    setWalletError(null);
    let opened: PqAccountClient | null = null;
    try {
      const restoring = !!setup.plaintextBackup;
      if (!restoring) {
        setSetupStep(0);
        setSetupOpen(true);
      }
      updateProgress(`Connecting through ${TRANSPORT.worker.label} and checking the RPC network`);
      if (!restoring) {
        const chainId = await transport.request<string>("eth_chainId");
        if (BigInt(chainId) !== BigInt(PQ_DEPLOYMENT.chainId))
          throw Error(`This wallet requires chain ${PQ_DEPLOYMENT.chainId}. The configured RPC reports another network.`);
      }
      updateProgress(restoring ? "Verifying saved PQ account ownership" : "Provisioning and verifying your ML-DSA account");
      if (setup.seed && setup.seed !== creationSeed.current) {
        creationSeed.current?.fill(0);
        creationSeed.current = setup.seed.slice();
      }
      if (!restoring && !creationSeed.current) creationSeed.current = crypto.getRandomValues(new Uint8Array(32));
      const client = opened = restoring
        ? await PqAccountClient.restore(setup.plaintextBackup!, transport, { backupAcknowledged: setup.backupAcknowledged, signal: setup.signal, onProgress: updateProgress })
        : await PqAccountClient.create(transport, { seed: creationSeed.current!, onProgress: updateProgress });
      if (!restoring) {
        setSetupStep(10);
        setProgress("Encrypting your wallet on this device");
      }
      await setup.onReady?.(client);
      setSetupStep(WALLET_SETUP_STEPS);
      if (!mounted.current) { client.lock(); return null; }
      accountRef.current?.lock();
      creationSeed.current?.fill(0);
      creationSeed.current = null;
      accountRef.current = client;
      setAccount(client);
      setWalletDownloaded(false);
      setWalletAcknowledged(client.isBackedUp);
      setWalletBackedUp(client.isBackedUp);
      if (client.isBackedUp) setWalletOpen(false);
      await refreshBalance(client);
      return client;
    } catch (error) {
      if (opened !== accountRef.current) opened?.lock();
      if (mounted.current) setWalletError(safeMessage(error, "The PQ wallet could not be opened. Your keys have not been shared."));
      return null;
    } finally { if (!setup.alreadyBusy) end(); }
  }
  function reconnectReads() {
    if (busyRef.current || transport?.getStatus().phase === "starting") return;
    setWalletError(null);
    setReadError(null);
    transport?.stop();
    transport?.start();
  }
  function downloadWallet(encrypted: string) {
    if (!account || busyRef.current) return;
    try {
      saveText(encrypted, `qraft-pq-wallet-encrypted-${stamp()}.json`);
      setWalletDownloaded(true);
    } catch {
      setWalletError("The wallet is locked. Restore the saved backup.");
    }
  }
  function confirmWalletBackup() {
    if (!account || !walletDownloaded || !walletAcknowledged) return;
    account.markBackedUp();
    setWalletBackedUp(true);
    setWalletOpen(false);
  }
  function lockWallet() {
    if (busyRef.current) return;
    accountRef.current?.lock();
    accountRef.current = null;
    setAccount(null);
    setBalance(null);
    setWalletBackedUp(false);
    setWalletDownloaded(false);
    setWalletAcknowledged(false);
    setWalletOpen(false);
  }
  function generateNote() {
    if (busyRef.current) return;
    setDepositNote(createPqNote(selectedPool));
    setNoteCopied(false);
    setNoteCopyFailed(false);
    setNoteAcknowledged(false);
    setDepositResult(null);
    setDepositError(null);
    setDepositStage("note");
  }
  async function copyNote() {
    if (!depositNote) return;
    try {
      await navigator.clipboard.writeText(serializePqNote(depositNote));
      setNoteCopyFailed(false);
      setNoteCopied(true);
    } catch {
      setNoteCopyFailed(true);
    }
  }
  function acceptDeposit(result: PqSendResult) {
    setDepositResult(result);
    setDepositStage(
      result.kind === "confirmed"
        ? "receipt"
        : result.kind === "unknown"
          ? "unknown"
          : "failed",
    );
    setDepositError("reason" in result ? result.reason : null);
  }
  async function submitDeposit(reconcile = false) {
    if (
      !pool ||
      !account ||
      !depositNote ||
      !walletBackedUp ||
      !noteCopied ||
      !noteAcknowledged ||
      !begin(
        reconcile
          ? "Rechecking the saved native transaction"
          : "Preparing the native ETH deposit",
      )
    )
      return;
    const client = account;
    const controller = new AbortController();
    abort.current = controller;
    setDepositStage("busy");
    setDepositError(null);
    if (!reconcile) setDepositOwner(client.address);
    try {
      if (
        reconcile &&
        depositOwner?.toLowerCase() !== client.address.toLowerCase()
      )
        throw Error(
          "Restore the PQ wallet that submitted this deposit before reconciling it.",
        );
      const result = reconcile
        ? await pool.reconcileDeposit(
            client,
            depositNote,
            depositResult && "hash" in depositResult
              ? depositResult.hash
              : undefined,
            updateProgress,
            controller.signal,
          )
        : await pool.deposit(
            client,
            depositNote,
            updateProgress,
            controller.signal,
          );
      if (mounted.current) acceptDeposit(result);
      if (result.kind === "confirmed") void refreshPool();
      await refreshBalance(client);
    } catch (error) {
      if (mounted.current) {
        setDepositStage(reconcile || client.pending ? "unknown" : "failed");
        setDepositError(
          safeMessage(
            error,
            "The deposit could not be completed. Keep your saved note.",
          ),
        );
      }
    } finally {
      end();
    }
  }
  async function checkNote(note: PqNote) {
    if (!pool || !begin("Checking the PQ note onchain")) return;
    const notePool = new PqPoolClient(transport!, registeredPqPool(note.pool));
    setWithdrawNote(note);
    setWithdrawStage("checking");
    setWithdrawError(null);
    try {
      const result = await notePool.noteStatus(note);
      if (!mounted.current) return;
      if (!result.spent && result.leaf) {
        const controller = new AbortController();
        abort.current = controller;
        const saved = await notePool.restorePrepared(note, controller.signal);
        if (!mounted.current) return;
        if (saved) {
          setPrepared(saved);
          setRecipient(saved.recipient);
          setWithdrawStage("unknown");
          setWithdrawError(
            "A saved withdrawal exists for this note. Its recipient is fixed; resume the same proof and native intent.",
          );
        } else setWithdrawStage("recipient");
      } else {
        setNoteCheck(result.spent ? "spent" : "pending");
        setWithdrawStage("status");
      }
    } catch (error) {
      if (mounted.current) {
        setNoteCheck("unknown");
        setWithdrawError(
          safeMessage(error, "This note cannot be checked right now."),
        );
        setWithdrawStage("status");
      }
    } finally {
      end();
    }
  }
  async function importNote(file?: File) {
    if (!file || !pool || busyRef.current) return;
    try {
      if (file.size > 8192)
        throw Error("That file is too large to be a PQ note.");
      const { note } = parseRegisteredPqNote(await file.text());
      if (!mounted.current || busyRef.current) return;
      setPrepared(null);
      setRecipient("");
      setWithdrawResult(null);
      await checkNote(note);
    } catch (error) {
      if (mounted.current)
        setWithdrawError(safeMessage(error, "This is not a valid PQ note."));
    }
  }
  async function runWithdrawal(resume = false) {
    const checked = checkRecipient(recipient);
    if (
      !withdrawalPool ||
      !account ||
      !withdrawNote ||
      !checked.ok ||
      !walletBackedUp ||
      !begin(
        resume
          ? "Resuming the same saved withdrawal"
          : "Preparing your PQ withdrawal",
      )
    )
      return;
    const client = account;
    setWithdrawStage("busy");
    setWithdrawError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let current = prepared;
      if (!resume || !current) {
        setWithdrawCancelable(true);
        current = await withdrawalPool.prepare(
          withdrawNote,
          checked.address,
          updateProgress,
          controller.signal,
        );
        if (mounted.current) setPrepared(current);
      } else current = { ...current, signal: controller.signal };
      controller.signal.throwIfAborted();
      if (mounted.current) setWithdrawCancelable(false);
      const result = await withdrawalPool.withdraw(client, current, updateProgress);
      if (!mounted.current) return;
      setWithdrawResult(result);
      if (result.kind === "confirmed") void refreshPool();
      setWithdrawStage(
        result.kind === "confirmed"
          ? "receipt"
          : result.kind === "unknown"
            ? "unknown"
            : "failed",
      );
      if ("reason" in result) setWithdrawError(result.reason);
      await refreshBalance(client);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof PqIntentError) {
        setWithdrawResult(error.result);
        setWithdrawStage(
          error.result.kind === "unknown" ? "unknown" : "failed",
        );
        setWithdrawError(error.message);
      } else if (controller.signal.aborted) {
        setWithdrawStage("review");
        setWithdrawError(
          "Proof preparation was stopped. Your note is unchanged; no withdrawal was submitted.",
        );
      } else {
        setWithdrawStage(client.pending ? "unknown" : "failed");
        setWithdrawError(
          safeMessage(
            error,
            "The PQ withdrawal stopped. Keep your note and saved transaction.",
          ),
        );
      }
    } finally {
      if (mounted.current) setWithdrawCancelable(false);
      end();
    }
  }
  async function reconcileWallet() {
    if (withdrawStage === "unknown" && prepared) {
      await runWithdrawal(true);
      return;
    }
    if (depositStage === "unknown" && depositNote) {
      await submitDeposit(true);
      return;
    }
    if (!account || !begin("Rechecking the saved native transaction")) return;
    setWalletError(null);
    setWalletOpen(true);
    try {
      const result = await account.reconcile({ onProgress: updateProgress });
      if (mounted.current)
        setWalletError(
          result.kind === "confirmed"
            ? "The saved transaction is confirmed. Check the note state before another action."
            : "reason" in result
              ? result.reason
              : null,
        );
      await refreshBalance(account);
    } catch {
      if (mounted.current)
        setWalletError(
          "The saved transaction remains unresolved. Keep its hash and reconcile again.",
        );
    } finally {
      end();
    }
  }
  function onTabsKey(event: KeyboardEvent) {
    if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home"
        ? "deposit"
        : event.key === "End"
          ? "withdraw"
          : tab === "deposit"
            ? "withdraw"
            : "deposit";
    setTab(next);
    tabButtons.current[next]?.focus();
  }
  const readReady = status.phase === "ready";
  const accountReady = !!account && walletBackedUp;
  const accountNeedsBackup = !!account && !walletBackedUp;
  const depositInsufficient =
    balance !== null && balance < BigInt(selectedPool.denominationWei);
  const recipientCheck = checkRecipient(recipient);

  function renderWalletGate() {
    return !accountReady ? (
      <Notice
        tone="neutral"
        title={
          accountNeedsBackup
            ? "Save your PQ wallet backup first"
            : "Open a PQ wallet"
        }
        action={
          <Button variant="primary" onClick={() => setWalletOpen(true)}>
            {accountNeedsBackup
              ? "Back up PQ wallet"
              : "Create or import PQ wallet"}
          </Button>
        }
      >
        Your private note controls the deposit. The separate ML-DSA wallet signs
        native transactions. The QRAFT paymaster pays transaction gas.
      </Notice>
    ) : null;
  }
  function renderProgress() {
    return (
      <div className="space-y-4">
        <Hero
          value={AMOUNT}
          unit="ETH"
          caption={progress || "Preparing"}
          tone="pending"
        />
        <Rail fraction={null} label={progress || "Preparing"} />
        <p
          role="status"
          className="text-center text-sm leading-relaxed text-ink-60"
        >
          {progress}
        </p>
      </div>
    );
  }
  function renderReceipt(result: Confirmed, withdrawal: boolean) {
    return (
      <div className="space-y-5">
        <div className="flex justify-center">
          <StatusLine tone="good">
            Confirmed in block{" "}
            {Number(BigInt(result.receipt.blockNumber)).toLocaleString("en-US")}
          </StatusLine>
        </div>
        <Hero
          value={AMOUNT}
          unit="ETH"
          caption={
            withdrawal
              ? `Withdrawn to ${truncateMiddle(recipient, 10, 8)}`
              : "Deposited into the PQ pool"
          }
        />
        <RowGroup>
          <Row label="Transaction">
            <TransactionReference hash={result.hash} />
          </Row>
          <Row label="Authorization">ML-DSA-44 · native frames</Row>
          <Row label={withdrawal ? "Recipient receives" : "Asset"}>
            Native ETH
          </Row>
        </RowGroup>
        <InclusionNotice />
        <Button
          className="w-full"
          onClick={() => {
            if (withdrawal) {
              setWithdrawStage("import");
              setWithdrawNote(null);
              setPrepared(null);
              setWithdrawResult(null);
            } else {
              setDepositStage("amount");
              setDepositNote(null);
              setDepositResult(null);
            }
          }}
        >
          {withdrawal ? "Withdraw another note" : "Deposit another note"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-3.5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to the QRAFT home page"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-sunk text-ink-60 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)] transition-colors hover:bg-rule/60 hover:text-ink"
            >
              <ArrowLeftIcon width={17} height={17} />
            </Link>
            <span className="relative text-sm font-semibold tracking-[0.16em]">
              {WORDMARK}
              <span
                className="spectral-bar absolute -bottom-[5px] left-0 h-[2px] w-full rounded-full"
                aria-hidden="true"
              />
            </span>
          </div>
          <Button
            variant="primary"
            size="md"
            className="min-w-34 max-w-[calc(100vw-9rem)] bg-black! font-semibold text-white! hover:bg-neutral-800! sm:min-w-36 sm:max-w-none"
            disabled={isBusy}
            onClick={() => setWalletOpen(true)}
          >
            {account
              ? `${truncateMiddle(account.address)} · PQ`
              : "Connect wallet"}
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col px-4 pb-6 sm:pt-5 sm:px-6">
        <div className="mx-auto w-full max-w-[34rem]">
          {account?.pending && !busy ? (
            <div className="mb-4">
              <Notice
                tone="unknown"
                title="A native transaction is unresolved"
                action={
                  <Button onClick={() => void reconcileWallet()}>
                    Reconcile saved transaction
                  </Button>
                }
              >
                Keep the saved intent. Do not submit another transaction with a
                new nonce.
              </Notice>
            </div>
          ) : null}
          <div
            role="tablist"
            aria-label="Pool actions"
            onKeyDown={onTabsKey}
            className="mx-auto grid w-full max-w-[17rem] grid-cols-2 gap-1 rounded-pill border border-rule bg-sunk p-1"
          >
            {(["deposit", "withdraw"] as const).map((item) => (
              <button
                key={item}
                ref={(element) => {
                  tabButtons.current[item] = element;
                }}
                type="button"
                role="tab"
                id={`pq-tab-${item}`}
                aria-controls={`pq-panel-${item}`}
                aria-selected={tab === item}
                tabIndex={tab === item ? 0 : -1}
                disabled={isBusy}
                onClick={() => setTab(item)}
                className={`relative h-9 rounded-pill text-sm font-medium capitalize transition-colors disabled:cursor-wait ${tab === item ? "bg-surface text-ink shadow-sm" : "text-ink-60 hover:text-ink"}`}
              >
                {item}
                {tab === item ? (
                  <span
                    className="spectral-bar absolute inset-x-5 bottom-[3px] h-[2px] rounded-full"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
          </div>
          <div className="-mx-4 -my-12 mt-0 overflow-hidden px-4 py-8 sm:-mx-8 sm:px-8 sm:py-12">
            <div
              className="flex items-start gap-20 transition-transform duration-[380ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
              style={{
                transform:
                  tab === "deposit"
                    ? "translateX(0)"
                    : "translateX(calc(-100% - 5rem))",
              }}
            >
              <div
                className="w-full shrink-0"
                role="tabpanel"
                id="pq-panel-deposit"
                aria-labelledby="pq-tab-deposit"
                inert={tab !== "deposit"}
              >
                <Card as="section" className="overflow-hidden">
                  <div className="p-5 sm:p-6">
                    {depositStage === "amount" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption={
                            unspent === null
                              ? "Reading the anonymity set…"
                              : `${unspent} unspent ${AMOUNT} ETH ${unspent === 1 ? "note" : "notes"}`
                          }
                        />
                        <fieldset disabled={!!busy || !!account?.pending} className="space-y-2">
                          <legend className="mb-2 text-sm font-medium">Deposit amount</legend>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {PQ_POOLS.map(option => (
                              <label key={option.pool} className={`cursor-pointer rounded-pill border px-3 py-2.5 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${selectedPool.pool === option.pool ? "border-ink bg-ink text-paper" : "border-rule hover:bg-sunk"}`}>
                                <input type="radio" name="deposit-amount" className="sr-only"
                                  checked={selectedPool.pool === option.pool}
                                  onChange={() => { if (!busyRef.current && !account?.pending) { setSelectedPool(option); setUnspent(null); setReadError(null); } }} />
                                {formatEth(BigInt(option.denominationWei))} ETH
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <p className="text-center text-sm leading-relaxed text-ink-60">
                          A fixed native ETH deposit, protected by a SHA3-512
                          note and a transparent withdrawal proof.
                        </p>
                        <Button
                          variant="primary"
                          size="lg"
                          className="w-full"
                          iconAfter={<ArrowRightIcon width={17} height={17} />}
                          onClick={generateNote}
                        >
                          Generate a PQ note
                        </Button>
                      </div>
                    ) : null}
                    {depositStage === "note" && depositNote ? (
                      <div className="space-y-5">
                        <div>
                          <h1 className="text-xl font-semibold tracking-tight">
                            Save your PQ note
                          </h1>
                          <p className="mt-2 text-sm leading-relaxed text-ink-60">
                            This file is the only thing that can withdraw this
                            deposit. It is a bearer secret, not a receipt to
                            share.
                          </p>
                        </div>
                        <div className="border-y border-rule py-4">
                          <span className="text-xs text-ink-60">
                            Public commitment
                          </span>
                          <p className="mt-2">
                            <Mono>{noteReference(depositNote)}</Mono>
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            aria-label="Private note, hidden"
                            value={"*".repeat(44)}
                            className="min-w-0 flex-1 rounded-control border border-rule bg-sunk px-3.5 font-mono text-sm tracking-[0.15em] text-ink-45"
                          />
                          <Button
                            variant={noteCopied ? "secondary" : "primary"}
                            className="shrink-0"
                            icon={
                              noteCopied ? (
                                <CheckIcon width={17} height={17} />
                              ) : (
                                <CopyIcon width={17} height={17} />
                              )
                            }
                            onClick={() => void copyNote()}
                          >
                            {noteCopied ? "Copied" : "Copy note"}
                          </Button>
                        </div>
                        {noteCopyFailed ? (
                          <p className="text-xs text-state-bad" role="alert">
                            Your browser would not give this page the clipboard.
                            Copy is unavailable here.
                          </p>
                        ) : null}
                        <label className="flex gap-3 rounded-control border border-rule p-3.5 text-sm leading-relaxed">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
                            disabled={!noteCopied}
                            checked={noteAcknowledged}
                            onChange={(event) =>
                              setNoteAcknowledged(event.target.checked)
                            }
                          />
                          <span>
                            I saved this note somewhere I can find it
                            again. Losing it means losing access to this
                            deposit.
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            icon={<ArrowLeftIcon width={17} height={17} />}
                            onClick={() => setDepositStage("amount")}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            className="flex-1"
                            disabled={!noteCopied || !noteAcknowledged}
                            onClick={() => setDepositStage("confirm")}
                          >
                            Continue
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {depositStage === "confirm" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption="Native ETH into the PQ pool"
                        />
                        <RowGroup>
                          <Row label="From">
                            {account ? (
                              <Mono>
                                {truncateMiddle(account.address, 10, 8)}
                              </Mono>
                            ) : (
                              "No PQ wallet open"
                            )}
                          </Row>
                          <Row label="Wallet balance">
                            {balance === null
                              ? "Unreadable"
                              : `${formatEth(balance)} ETH`}
                          </Row>
                          <Row label="Gas">Paid by your PQ account</Row>
                          <Row label="User authorization">ML-DSA-44</Row>
                        </RowGroup>
                        {renderWalletGate()}
                        {accountReady ? (
                          <Notice
                            tone="neutral"
                            title="Your funding account is public"
                          >
                            Reusing this account for withdrawal can link both actions.
                            For privacy, withdraw using a separate PQ wallet.
                          </Notice>
                        ) : null}
                        {depositInsufficient ? (
                          <Notice tone="bad" title="Not enough native ETH">
                            This account needs {AMOUNT} ETH for the deposit. The
                            paymaster covers gas. Fund its address on chain 8141 before
                            depositing.
                          </Notice>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => setDepositStage("note")}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            className="flex-1"
                            disabled={
                              !accountReady ||
                              !readReady ||
                              serviceEnabled !== true ||
                              depositInsufficient ||
                              !!account?.pending
                            }
                            onClick={() => void submitDeposit()}
                          >
                            Deposit {AMOUNT} ETH
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {depositStage === "busy" ? renderProgress() : null}
                    {depositStage === "receipt" &&
                    depositResult?.kind === "confirmed"
                      ? renderReceipt(depositResult, false)
                      : null}
                    {depositStage === "unknown" || depositStage === "failed" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption={
                            depositStage === "unknown"
                              ? "Deposit outcome unknown"
                              : "Deposit did not complete"
                          }
                          tone={depositStage === "unknown" ? "unknown" : "bad"}
                        />
                        <Notice
                          tone={depositStage === "unknown" ? "unknown" : "bad"}
                          title="Keep the saved note"
                        >
                          {depositError ??
                            "The transaction could not be confirmed. Check its saved hash before another action."}
                        </Notice>
                        {depositResult && "hash" in depositResult ? (
                          <RowGroup>
                            <Row label="Transaction">
                              <TransactionReference hash={depositResult.hash} />
                            </Row>
                          </RowGroup>
                        ) : null}
                        {depositOwner ? (
                          <p className="text-xs leading-relaxed text-ink-60">
                            Submitting PQ wallet:{" "}
                            <Mono>{truncateMiddle(depositOwner, 10, 8)}</Mono>
                          </p>
                        ) : null}
                        {!account ? renderWalletGate() : null}
                        <Button
                          variant="primary"
                          className="w-full"
                          icon={<RetryIcon width={16} height={16} />}
                          disabled={!accountReady || !readReady}
                          onClick={() =>
                            depositStage === "unknown"
                              ? void submitDeposit(true)
                              : setDepositStage("confirm")
                          }
                        >
                          {depositStage === "unknown"
                            ? "Reconcile this deposit"
                            : "Review the same saved note"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>
              <div
                className="w-full shrink-0"
                role="tabpanel"
                id="pq-panel-withdraw"
                aria-labelledby="pq-tab-withdraw"
                inert={tab !== "withdraw"}
              >
                <Card as="section" className="overflow-hidden">
                  <div className="p-5 sm:p-6">
                    {withdrawStage === "import" ? (
                      <div className="space-y-5">
                        <div>
                          <h1 className="text-xl font-semibold tracking-tight">
                            Import your PQ note
                          </h1>
                          <p className="mt-2 text-sm leading-relaxed text-ink-60">
                            The file is read on this device and stays in memory.
                            No wallet is needed to check the note.
                          </p>
                        </div>
                        <input
                          ref={noteInput}
                          type="file"
                          accept=".txt,text/plain"
                          className="sr-only"
                          aria-label="PQ note file"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            void importNote(file);
                          }}
                        />
                        <Button
                          variant="primary"
                          size="lg"
                          className="w-full"
                          icon={<FileIcon width={17} height={17} />}
                          disabled={isBusy}
                          onClick={() => noteInput.current?.click()}
                        >
                          Choose PQ note file
                        </Button>
                        {withdrawError ? (
                          <p role="alert" className="text-sm text-state-bad">
                            {withdrawError}
                          </p>
                        ) : null}
                        <p className="text-xs leading-relaxed text-ink-60">
                          The note selects its registered ETH pool automatically. Older
                          classical notes cannot be migrated by changing their
                          label.
                        </p>
                      </div>
                    ) : null}
                    {withdrawStage === "checking" ? renderProgress() : null}
                    {withdrawStage === "status" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption={
                            noteCheck === "spent"
                              ? "This PQ note has already been withdrawn"
                              : noteCheck === "pending"
                                ? "No confirmed deposit found"
                                : "This note cannot be checked right now"
                          }
                          tone={
                            noteCheck === "spent"
                              ? "spent"
                              : noteCheck === "pending"
                                ? "pending"
                                : "unknown"
                          }
                        />
                        <p className="text-sm leading-relaxed text-ink-60">
                          {noteCheck === "spent"
                            ? "Its nullifier is already spent onchain. This file no longer controls funds."
                            : (withdrawError ??
                              "Keep the note file and check its original deposit. Nothing has been submitted.")}
                        </p>
                        {withdrawNote ? (
                          <RowGroup>
                            <Row label="Public commitment">
                              <Mono>{noteReference(withdrawNote)}</Mono>
                            </Row>
                          </RowGroup>
                        ) : null}
                        {noteCheck !== "spent" && withdrawNote ? (
                          <Button
                            variant="primary"
                            className="w-full"
                            disabled={isBusy || !readReady}
                            onClick={() =>
                              withdrawNote && void checkNote(withdrawNote)
                            }
                          >
                            Check again
                          </Button>
                        ) : null}
                        <Button
                          className="w-full"
                          onClick={() => {
                            setWithdrawStage("import");
                            setWithdrawError(null);
                          }}
                        >
                          Use a different PQ note
                        </Button>
                      </div>
                    ) : null}
                    {withdrawStage === "recipient" ? (
                      <div className="space-y-5">
                        <div className="flex justify-center">
                          <StatusLine tone="good">Ready to withdraw</StatusLine>
                        </div>
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption="Where should the native ETH go?"
                        />
                        <label className="block text-sm font-medium">
                          Recipient address
                          <input
                            value={recipient}
                            onChange={(event) =>
                              setRecipient(event.target.value)
                            }
                            placeholder="0x…"
                            autoComplete="off"
                            spellCheck={false}
                            className="mt-2 h-12 w-full rounded-control border border-rule-strong bg-surface px-3.5 font-mono text-sm"
                          />
                        </label>
                        {recipient.trim() && !recipientCheck.ok ? (
                          <p role="alert" className="text-sm text-state-bad">
                            {recipientCheck.reason}
                          </p>
                        ) : (
                          <p className="text-xs leading-relaxed text-ink-60">
                            Use a fresh address with no public link to the
                            account that funded your deposit. Use a PQ account
                            recipient to keep post-quantum authorization after
                            payout; ordinary wallet recipients use their own
                            signature scheme.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => setWithdrawStage("import")}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            className="flex-1"
                            disabled={!recipientCheck.ok}
                            onClick={() => setWithdrawStage("review")}
                          >
                            Review withdrawal
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {withdrawStage === "review" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption={`To ${truncateMiddle(recipient, 10, 8)}`}
                        />
                        <RowGroup>
                          <Row label="Recipient">
                            <Mono>{truncateMiddle(recipient, 10, 8)}</Mono>
                          </Row>
                          <Row label="Privacy proof">
                            Transparent V5 · hash / FRI
                          </Row>
                          <Row label="Account authorization">ML-DSA-44</Row>
                          <Row label="Native transaction gas">
                            QRAFT paymaster
                          </Row>
                        </RowGroup>
                        {renderWalletGate()}
                        <Notice
                          tone="neutral"
                          title="The complete proof takes time"
                        >
                          The proof is generated and checked on this device. Its
                          public encoding is about 10 MB; full onchain
                          verification uses hundreds of bounded calls. Use
                          desktop Chromium with sufficient memory, and keep this
                          page open.
                        </Notice>
                        <p className="text-xs leading-relaxed text-ink-60">
                          The local helper receives only the public proof and
                          pays for permissionless verification. It cannot
                          authorize spending your note. Using the deposit
                          account again can publicly link both actions.
                        </p>
                        {withdrawError ? (
                          <p
                            role="alert"
                            className="text-sm text-state-unknown"
                          >
                            {withdrawError}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => setWithdrawStage("recipient")}
                          >
                            Back
                          </Button>
                          <Button
                            variant="primary"
                            className="flex-1"
                            disabled={
                              !accountReady ||
                              !readReady ||
                              serviceEnabled !== true ||
                              !!account?.pending
                            }
                            onClick={() => void runWithdrawal()}
                          >
                            Generate PQ proof and withdraw
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {withdrawStage === "busy" ? (
                      <div className="space-y-5">
                        {renderProgress()}
                        <p className="text-xs leading-relaxed text-ink-60">
                          Keep this page open. No note secret or signing seed is
                          sent to the RPC or the helper.
                        </p>
                        {withdrawCancelable ? (
                          <Button
                            variant="ghost"
                            className="w-full"
                            onClick={() => abort.current?.abort()}
                          >
                            Cancel proof preparation
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {withdrawStage === "receipt" &&
                    withdrawResult?.kind === "confirmed"
                      ? renderReceipt(withdrawResult, true)
                      : null}
                    {withdrawStage === "unknown" ||
                    withdrawStage === "failed" ? (
                      <div className="space-y-5">
                        <Hero
                          value={AMOUNT}
                          unit="ETH"
                          caption={
                            withdrawStage === "unknown"
                              ? "Withdrawal outcome unknown"
                              : "Withdrawal stopped"
                          }
                          tone={withdrawStage === "unknown" ? "unknown" : "bad"}
                        />
                        <Notice
                          tone={withdrawStage === "unknown" ? "unknown" : "bad"}
                          title="Keep your note and saved intent"
                        >
                          {withdrawError ??
                            "The complete withdrawal has not been confirmed. Do not create a replacement transaction while its outcome is unknown."}
                        </Notice>
                        {withdrawResult && "hash" in withdrawResult ? (
                          <RowGroup>
                            <Row label="Native transaction">
                              <TransactionReference
                                hash={withdrawResult.hash}
                              />
                            </Row>
                          </RowGroup>
                        ) : null}
                        {renderWalletGate()}
                        {prepared ? (
                          <RowGroup>
                            <Row label="Fixed recipient">
                              <Mono>
                                {truncateMiddle(prepared.recipient, 10, 8)}
                              </Mono>
                            </Row>
                          </RowGroup>
                        ) : null}
                        {prepared ? (
                          <Button
                            variant="primary"
                            className="w-full"
                            disabled={
                              !accountReady ||
                              !readReady ||
                              serviceEnabled !== true
                            }
                            onClick={() => void runWithdrawal(true)}
                          >
                            Resume the same withdrawal
                          </Button>
                        ) : withdrawStage === "failed" ? (
                          <Button
                            className="w-full"
                            onClick={() => setWithdrawStage("review")}
                          >
                            Review before preparing again
                          </Button>
                        ) : (
                          <p className="text-sm text-ink-60">
                            Restore the submitting PQ wallet and reconcile its
                            saved transaction before continuing.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              className="rounded-pill px-3 py-1.5 text-xs text-ink-60 hover:bg-sunk hover:text-ink"
              onClick={() => setReadOpen(true)}
            >
              <StatusLine
                tone={
                  readReady
                    ? "good"
                    : status.phase === "failed"
                      ? "bad"
                      : "pending"
                }
                pulse={status.phase === "starting"}
              >
                Ethrex devnet · {status.network} reads
                {TRANSPORT.worker.anonymizing ? "" : " (not anonymous)"} ·{" "}
                {readReady
                  ? "worker ready"
                  : status.phase === "starting"
                    ? "connecting"
                    : status.phase === "failed"
                      ? "unavailable"
                      : "not connected"}
              </StatusLine>
            </button>
          </div>
          {readError && !busy ? (
            <p
              role="status"
              className="mt-3 text-center text-xs leading-relaxed text-ink-60"
            >
              {readError}
            </p>
          ) : null}
        </div>
      </main>
      <WalletPasskeyController
        account={account} transport={transport} getPendingSeed={() => creationSeed.current} setPendingSeed={seed => { creationSeed.current = seed; }}
        begin={begin} end={end} show={() => setWalletOpen(true)} error={setWalletError}
        connect={connectWallet} exportEncrypted={downloadWallet} confirm={confirmWalletBackup} lock={lockWallet}
        onSetupStart={() => { setSetupStep(0); setSetupOpen(true); }}
        requireProtection={() => { setWalletBackedUp(false); setWalletDownloaded(false); setWalletAcknowledged(false); setWalletOpen(true); }}
      >
      {wallet => (
      <Sheet
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        title="PQ wallet"
      >
        <input
          ref={walletInput}
          type="file"
          accept=".json,application/json,text/plain"
          className="sr-only"
          aria-label="PQ wallet backup"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void wallet.importFile(file);
          }}
        />
        {!account ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-ink-60">
              Create an ML-DSA-44 account or restore its saved backup. Its
              signing key is encrypted with your passkey. Reloading locks the wallet
              until you choose to unlock it with your passkey.
            </p>
            <Button
              variant="primary"
              className="w-full"
              busy={isBusy && busy !== "wallet:import"}
              disabled={isBusy || !!wallet.localhostUrl || (!wallet.hasVault && serviceEnabled !== true)}
              onClick={() => void wallet.create()}
            >
              {wallet.primaryLabel}
            </Button>
            <Button
              className="w-full"
              busy={busy === "wallet:import"}
              disabled={isBusy}
              onClick={() => walletInput.current?.click()}
            >
              Import PQ wallet backup
            </Button>
            {busy ? (
              <p role="status" className="text-sm text-ink-60">
                {progress}
              </p>
            ) : null}
            {setupStep !== null ? (
              <Button className="w-full" onClick={() => setSetupOpen(true)}>
                View wallet setup
              </Button>
            ) : null}
            <div className="space-y-3" role="status" aria-live="polite">
              {!busy ? (
                <p className="text-xs leading-relaxed text-ink-60">
                  {status.phase === "starting"
                    ? `Loading ${status.network} and connecting to its anonymous network. You can choose an action while it connects.`
                    : status.phase === "failed" || status.phase === "not-configured"
                      ? status.detail
                      : readReady
                        ? `${status.network} worker ready. Account ownership is verified through anonymous RPC before the wallet opens.`
                        : `Create or import a wallet to connect through ${status.network} and verify ownership.`}
                </p>
              ) : null}
              {serviceEnabled === null ? <p className="text-xs text-ink-60">Checking the local gas helper…</p> : null}
              {serviceEnabled === false ? (
                <p className="text-xs leading-relaxed text-ink-60">{serviceReason ?? "Local account provisioning is off. Set QRAFT_LOCAL_PQ_SERVICE=1, supply a funded chain 8141 key at .local/deployer.json, and restart the server. You can still import an existing backup."}</p>
              ) : null}
            </div>
            {!busy && (!readReady || !!walletError) ? (
              <Button
                className="w-full"
                disabled={status.phase === "starting"}
                onClick={reconnectReads}
              >
                Retry anonymous connection
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <RowGroup>
              <Row label="PQ account">
                <Mono>{truncateMiddle(account.address, 10, 8)}</Mono>
              </Row>
              <Row label="Authorization">ML-DSA-44</Row>
              <Row label="Native ETH balance">
                {balance === null ? "Unreadable" : formatEth(balance)}
              </Row>
              <Row label="Backup">
                {walletBackedUp ? "Acknowledged" : "Required before signing"}
              </Row>
            </RowGroup>
            {setupStep !== null ? (
              <Button className="w-full" onClick={() => setSetupOpen(true)}>
                View wallet setup
              </Button>
            ) : null}
            <Notice
              tone="neutral"
              title="Wallet backup and private note are different"
            >
              This backup controls your public PQ account. A private note file
              controls each pool deposit. Keep both securely; losing one cannot
              be fixed by the other.
            </Notice>
            {!wallet.protected ? <Button className="w-full" variant="primary" disabled={isBusy} onClick={() => void wallet.create()}>Protect with passkey</Button> : null}
            <Button
              variant={walletDownloaded ? "secondary" : "primary"}
              className="w-full"
              disabled={isBusy || !wallet.protected}
              icon={<DownloadIcon width={17} height={17} />}
              onClick={wallet.download}
            >
              {walletDownloaded
                ? "Download PQ backup again"
                : "Download PQ wallet backup"}
            </Button>
            {!walletBackedUp ? (
              <>
                <label className="flex gap-3 text-sm leading-relaxed">
                  <input
                    type="checkbox"
                    disabled={!walletDownloaded || isBusy}
                    checked={walletAcknowledged}
                    onChange={(event) =>
                      setWalletAcknowledged(event.target.checked)
                    }
                    className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
                  />
                  <span>
                    I saved the encrypted wallet backup securely and can access
                    its matching passkey. Both are needed to restore this account.
                  </span>
                </label>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!walletDownloaded || !walletAcknowledged || isBusy}
                  onClick={() => void wallet.confirmBackup()}
                >
                  I saved my PQ wallet backup
                </Button>
              </>
            ) : null}
            {account.pending ? (
              <Button
                className="w-full"
                busy={isBusy}
                onClick={() => void reconcileWallet()}
              >
                Reconcile saved transaction
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="w-full"
              disabled={isBusy}
              onClick={wallet.lock}
            >
              Lock PQ wallet
            </Button>
          </div>
        )}
        {wallet.localhostUrl ? (
          <p className="mt-4 text-sm leading-relaxed text-ink-60">
            Passkeys require a domain name. <a className="underline" href={wallet.localhostUrl}>Open this app on localhost</a> to set up or unlock your wallet.
          </p>
        ) : null}
        {walletError ? (
          <p
            role="alert"
            className="mt-4 text-sm leading-relaxed text-state-unknown"
          >
            {walletError}
          </p>
        ) : null}
      </Sheet>
      )}
      </WalletPasskeyController>
      <Sheet
        open={readOpen}
        onClose={() => setReadOpen(false)}
        title="Read path and security scope"
      >
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-ink-60">
            Browser pool and account reads use the hash-pinned {status.network}{" "}
            worker.
            {TRANSPORT.worker.anonymizing
              ? " This worker routes reads through its anonymizing network."
              : " This configured diagnostic worker does not anonymize reads."}
            There is no silent direct-read fallback. Worker readiness does not
            guarantee that every RPC request succeeds.
          </p>
          <RowGroup>
            <Row label="Worker">
              {status.network}
              {TRANSPORT.worker.anonymizing ? "" : " · not anonymous"}
            </Row>
            <Row label="Successful reads">{status.requestCount}</Row>
            <Row label="Bootstrap">Direct public specifier lookups</Row>
            <Row label="Notes">SHA3-512 · 64-byte secret</Row>
            <Row label="Proof">Transparent V5 · hash / FRI</Row>
            <Row label="User signing">ML-DSA-44 · native frames</Row>
          </RowGroup>
          {status.detail ? (
            <Notice tone="unknown" title="Read path status">
              {status.detail}
            </Notice>
          ) : null}
          <p className="text-sm leading-relaxed text-ink-60">
            The local helper sends public account, authorization and
            proof-computation traffic directly to RPC from this machine. Those
            requests are not anonymized. Its test gas carrier does not own your
            PQ account or note. Consensus, browser delivery, TLS and Nym have
            separate trust assumptions; this is not a claim that all
            infrastructure is post-quantum.
          </p>
          <Button
            className="w-full"
            disabled={isBusy || status.phase === "starting"}
            onClick={reconnectReads}
          >
            Reconnect anonymous reads
          </Button>
        </div>
      </Sheet>
      <WalletSetup open={setupOpen} step={setupStep ?? 0} progress={progress} error={walletError} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
