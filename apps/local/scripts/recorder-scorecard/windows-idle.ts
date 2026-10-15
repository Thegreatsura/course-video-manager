import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * EVERY WINDOWS PROCESS THE SCORECARD STARTS RUNS AT IDLE PRIORITY ON CORES
 * 6-9. `nice` and `taskset` stop at WSL's edge, and a harness at Normal
 * priority on every core once starved Matt's real Cam Link capture.
 *
 * So each one is started through `idle-launch.exe`, compiled once per run
 * from the C# below. It puts itself in a Windows job object whose limits
 * are Idle priority class and affinity 0x3C0 (cores 6-9), then starts the
 * real program, which is born in that job: Windows applies both limits to
 * it and everything it starts, from its first instruction. The job also
 * kills them all when the launcher goes, so nothing outlives a killed
 * launcher. `assertIdle` reads them back from the processes themselves.
 */

export const AFFINITY_MASK = 0x3c0;

const SOURCE = `
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class IdleLaunch {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit;
    public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref ExtendedLimits info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  const uint LIMIT_AFFINITY = 0x10, LIMIT_PRIORITY_CLASS = 0x20, LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const uint IDLE_PRIORITY_CLASS = 0x40;

  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\"");
    int slashes = 0;
    foreach (char c in a) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') sb.Append('\\\\', slashes * 2 + 1);
      else sb.Append('\\\\', slashes);
      slashes = 0;
      sb.Append(c);
    }
    sb.Append('\\\\', slashes * 2);
    return sb.Append('"').ToString();
  }

  public static int Main(string[] args) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var info = new ExtendedLimits();
    info.Basic.LimitFlags = LIMIT_AFFINITY | LIMIT_PRIORITY_CLASS | LIMIT_KILL_ON_JOB_CLOSE;
    info.Basic.Affinity = (UIntPtr)${AFFINITY_MASK};
    info.Basic.PriorityClass = IDLE_PRIORITY_CLASS;
    if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(ExtendedLimits))))
      { Console.Error.WriteLine("idle-launch: SetInformationJobObject failed " + Marshal.GetLastWin32Error()); return 125; }
    if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
      { Console.Error.WriteLine("idle-launch: AssignProcessToJobObject failed " + Marshal.GetLastWin32Error()); return 125; }
    // A leading --tag=<marker> only marks this launcher's command line, so it can be found.
    int at = args.Length > 0 && args[0].StartsWith("--tag=") ? 1 : 0;
    var rest = new StringBuilder();
    for (int i = at + 1; i < args.Length; i++) { if (i > at + 1) rest.Append(' '); rest.Append(Quote(args[i])); }
    var psi = new ProcessStartInfo(args[at], rest.ToString());
    psi.UseShellExecute = false;
    psi.WorkingDirectory = Environment.CurrentDirectory;
    var p = Process.Start(psi);
    p.WaitForExit();
    return p.ExitCode;
  }
}
`;

const POWERSHELL =
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

const toWindows = (wslPath: string) =>
  execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();

/** PowerShell's -EncodedCommand: no quoting to get wrong. */
export const encodeCommand = (command: string) =>
  Buffer.from(command, "utf16le").toString("base64");

let launcher: string | undefined;
/** The run's marker, on every launcher's command line (`killRun`). */
let runTag: string | undefined;
export const setRunTag = (marker: string) => {
  runTag = marker;
};

/**
 * Compiles `idle-launch.exe` into `dir` (a WSL path). The compiling
 * PowerShell lowers itself to Idle on cores 6-9 first; csc inherits both.
 */
export const buildIdleLauncher = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, "idle-launch.exe");
  const src = path.join(dir, "idle-launch.cs");
  fs.writeFileSync(src, SOURCE);
  const command = [
    "$me = [Diagnostics.Process]::GetCurrentProcess()",
    `$me.ProcessorAffinity = [IntPtr]${AFFINITY_MASK}`,
    "$me.PriorityClass = 'Idle'",
    `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${toWindows(src)}')) -OutputAssembly '${toWindows(exe)}' -OutputType ConsoleApplication`,
  ].join("; ");
  const run = spawnSync(
    POWERSHELL,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodeCommand(command),
    ],
    { cwd: "/mnt/c", encoding: "utf8", timeout: 120_000 }
  );
  if (!fs.existsSync(exe))
    throw new Error(
      `Could not build idle-launch.exe: ${run.stderr || run.stdout}`
    );
  // WSL runs a Windows .exe from its own disk only when it is executable.
  fs.chmodSync(exe, 0o755);
  launcher = exe;
  return exe;
};

/** The launcher, once built; refuses to start a Windows process without it. */
export const idleLauncher = () => {
  if (!launcher)
    throw new Error(
      "idle-launch.exe is not built: no Windows process may start."
    );
  return launcher;
};

/** Lets a child process (the service) use the launcher built by its parent. */
export const useIdleLauncher = (exe: string) => {
  if (!fs.existsSync(exe)) throw new Error(`No idle-launch.exe at ${exe}`);
  launcher = exe;
};

/** Starts a Windows program (by its WSL path, or a name on Windows' PATH) at Idle on cores 6-9. */
export const spawnIdle = (
  exe: string,
  args: readonly string[],
  o: { cwd: string; stdio?: ("pipe" | "ignore")[] }
) =>
  spawn(
    idleLauncher(),
    [
      ...(runTag ? [`--tag=${runTag}`] : []),
      exe.startsWith("/") ? toWindows(exe) : exe,
      ...args,
    ],
    {
      cwd: o.cwd,
      stdio: o.stdio ?? ["pipe", "pipe", "pipe"],
    }
  );

/** PowerShell, at Idle on cores 6-9. */
export const spawnPowerShellIdle = (command: string) =>
  spawnIdle(
    POWERSHELL,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodeCommand(command),
    ],
    { cwd: "/mnt/c", stdio: ["ignore", "pipe", "pipe"] }
  );
