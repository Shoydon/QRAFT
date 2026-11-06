import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Serialize every process using the disposable gas carrier; never steal a dead owner's lock. */
export async function withCarrierLock<T>(directory: string, operation: () => Promise<T>, options: {
  timeoutMs?: number; pollMs?: number; onWait?: () => Promise<void>;
} = {}): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'carrier.lock');
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  let notified = false;
  for (;;) {
    let lock;
    try { lock = await open(path, 'wx', 0o600); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
      let owner: string;
      try { owner = await readFile(path, 'utf8'); }
      catch (readError) {
        if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT') continue;
        throw readError;
      }
      // Another process can still be writing its PID immediately after open(wx).
      if (owner) {
        if (!/^[1-9][0-9]*$/.test(owner) || !Number.isSafeInteger(Number(owner))) throw Error('Invalid local gas lock. Preserve it for reconciliation.');
        try { process.kill(Number(owner), 0); }
        catch (ownerError) {
          if (ownerError && typeof ownerError === 'object' && 'code' in ownerError && ownerError.code === 'ESRCH') throw Error('An interrupted local gas operation needs journal reconciliation before retrying.');
          throw ownerError;
        }
      }
      if (Date.now() >= deadline) throw Error('The local gas queue is busy. Retry the same wallet setup shortly.');
      if (!notified) { await options.onWait?.(); notified = true; }
      await new Promise<void>(resolve => setTimeout(resolve, options.pollMs ?? 500));
      continue;
    }
    try { await lock.writeFile(String(process.pid)); await lock.sync(); }
    catch (error) { await lock.close(); throw error; }
    await lock.close();
    try { return await operation(); }
    finally {
      // Never delete a lock that another process or operator replaced.
      if (await readFile(path, 'utf8') !== String(process.pid)) throw Error('Local gas lock ownership changed. Preserve the journal.');
      await unlink(path);
    }
  }
}
