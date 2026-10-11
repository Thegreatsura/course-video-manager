import { spawn } from "node:child_process";

/**
 * The Windows wall clock, readable from WSL at any moment. ffmpeg.exe stamps
 * every input with it (-use_wallclock_as_timestamps), so T0 must be read from
 * it too: WSL's own clock drifts from Windows' (the rig measured ~4% on this
 * machine), which would shift every file's time zero.
 *
 * A PowerShell loop prints UtcNow every 20 ms (spawning PowerShell per read
 * costs ~0.5 s); `now()` is the latest tick plus the few ms since it arrived.
 */
export const startWindowsClock = async () => {
  const child = spawn(
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "while ($true) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 20 }",
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "ignore"] }
  );
  let lastWindowsMs = NaN;
  let lastAt = 0;
  let buffer = "";
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`the Windows clock (PowerShell) exited with ${code}`))
    );
    child.stdout.on("data", (d: Buffer) => {
      buffer += d.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      const value = Number(lines.filter(Boolean).at(-1));
      if (Number.isFinite(value) && value > 0) {
        lastWindowsMs = value;
        lastAt = performance.now();
        resolve();
      }
    });
  });
  return {
    now: () => Math.round(lastWindowsMs + (performance.now() - lastAt)),
    stop: () => child.kill(),
  };
};
