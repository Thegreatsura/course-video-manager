import { spawn } from "node:child_process";
import http from "node:http";
import { RECORDER_SERVICE_PORT } from "../../recorder-service/protocol";

/**
 * The scorecard's reach into Windows: its own ffmpeg.exe processes (found by
 * the run's marker in their command line, and nothing else), the GPU, and
 * the Windows wall clock. Read-only, except `killMarked`, which only ever
 * stops an ffmpeg.exe whose command line carries this run's marker.
 */

const POWERSHELL =
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const NVIDIA_SMI = "/mnt/c/Windows/System32/nvidia-smi.exe";

export const runPowerShell = (command: string, timeoutMs = 30_000) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(
        POWERSHELL,
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { cwd: "/mnt/c", stdio: ["ignore", "pipe", "pipe"] }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.once("error", (e) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: e.message });
      });
    }
  );

/** A marker or tag as a PowerShell single-quoted literal; refuses anything unexpected. */
const literal = (s: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(s))
    throw new Error(`Refusing an unexpected process marker: ${s}`);
  return `'${s}'`;
};

const marked = (marker: string) =>
  `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.CommandLine -like ('*' + ${literal(marker)} + '*') }`;

/**
 * Stops this run's ffmpeg.exe processes: every one with `marker`, or only
 * those that also carry one of `tags`. Returns how many it stopped.
 */
export const killMarked = async (marker: string, tags?: readonly string[]) => {
  const tagFilter = tags?.length
    ? `| Where-Object { $cl = $_.CommandLine; @(${tags.map(literal).join(",")}) | Where-Object { $cl -like ('*' + $_ + '*') } }`
    : "";
  const { stdout } = await runPowerShell(
    `$p = @(${marked(marker)} ${tagFilter}); foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count`
  );
  return Number(stdout.trim()) || 0;
};

export type ProcessSample = {
  atMs: number;
  processes: { pid: number; cpu100ns: number; workingSet: number }[];
};

/** This run's ffmpeg.exe processes: CPU time so far and working set. */
export const sampleMarked = async (marker: string): Promise<ProcessSample> => {
  const { stdout } = await runPowerShell(
    `${marked(marker)} | ForEach-Object { "$($_.ProcessId)\`t$($_.KernelModeTime + $_.UserModeTime)\`t$($_.WorkingSetSize)" }`
  );
  return {
    atMs: Date.now(),
    processes: stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, cpu, ws] = line.split("\t").map(Number);
        return { pid: pid ?? 0, cpu100ns: cpu ?? 0, workingSet: ws ?? 0 };
      }),
  };
};

export const logicalCpus = async () =>
  Number(
    (
      await runPowerShell(
        "(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors"
      )
    ).stdout.trim()
  ) || 1;

/** Average CPU of the processes in both samples, as % of the whole machine; and their working set at the end (MB). */
export const cpuBetween = (
  a: ProcessSample,
  b: ProcessSample,
  cpus: number
) => {
  const before = new Map(a.processes.map((p) => [p.pid, p.cpu100ns]));
  let cpu100ns = 0;
  for (const p of b.processes) {
    const was = before.get(p.pid);
    if (was !== undefined) cpu100ns += p.cpu100ns - was;
  }
  const wallMs = Math.max(1, b.atMs - a.atMs);
  return {
    cpuPctOfMachine: (cpu100ns / 1e4 / wallMs / cpus) * 100,
    cpuCores: cpu100ns / 1e4 / wallMs,
    workingSetMb:
      b.processes.reduce((s, p) => s + p.workingSet, 0) / (1024 * 1024),
    processes: b.processes.length,
  };
};

export type GpuReading = {
  gpuPct: number;
  encoderPct: number;
  memoryMb: number;
};

/** The whole GPU, sampled every 500 ms until `stop()`; averages of what it read. */
export const sampleGpu = () => {
  const readings: GpuReading[] = [];
  const child = spawn(
    NVIDIA_SMI,
    [
      "--query-gpu=utilization.gpu,utilization.encoder,memory.used",
      "--format=csv,noheader,nounits",
      "-lms",
      "500",
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "ignore"] }
  );
  let buffer = "";
  child.stdout.on("data", (d: Buffer) => {
    buffer += d.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const [g, e, m] = line.split(",").map((x) => Number(x.trim()));
      if ([g, e, m].every((x) => Number.isFinite(x)))
        readings.push({ gpuPct: g!, encoderPct: e!, memoryMb: m! });
    }
  });
  child.once("error", () => {});
  return {
    stop: (): GpuReading | null => {
      child.kill();
      if (readings.length === 0) return null;
      const avg = (k: keyof GpuReading) =>
        readings.reduce((s, r) => s + r[k], 0) / readings.length;
      return {
        gpuPct: avg("gpuPct"),
        encoderPct: avg("encoderPct"),
        memoryMb: avg("memoryMb"),
      };
    },
  };
};

/**
 * Windows wall time less WSL's (`Date.now()`), in ms. A tick is printed
 * before it is read, so each says too little by how late it was read: the
 * largest of a second's worth is the closest.
 */
export const windowsClockOffset = () =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(
      POWERSHELL,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "for ($i = 0; $i -lt 60; $i++) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 15 }",
      ],
      { cwd: "/mnt/c", stdio: ["ignore", "pipe", "ignore"] }
    );
    let best = -Infinity;
    let buffer = "";
    child.stdout.on("data", (d: Buffer) => {
      const at = Date.now();
      buffer += d.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const v = Number(line);
        if (Number.isFinite(v) && v > 0) best = Math.max(best, v - at);
      }
    });
    child.once("close", () =>
      Number.isFinite(best)
        ? resolve(best)
        : reject(new Error("Could not read the Windows clock"))
    );
  });

/**
 * What Matt's own recorder service (port 5177) is doing, read from its
 * /health: the scorecard never runs beside a take of his, and would rather
 * not share the GPU with his open recorder either.
 */
export const liveRecorderState = () =>
  new Promise<"recording" | "open" | "closed">((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: RECORDER_SERVICE_PORT,
        path: "/health",
        timeout: 2000,
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () =>
          resolve(
            /"kind":"recording"/.test(body)
              ? "recording"
              : /"kind":"open"/.test(body)
                ? "open"
                : "closed"
          )
        );
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve("closed"));
  });
