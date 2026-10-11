import fs from "node:fs";
import path from "node:path";
import { runToEnd, type Launcher } from "./launcher";
import type { FfmpegCheck } from "./protocol";

/**
 * What the recorder asks Windows before it records: which ffmpeg, which
 * NVIDIA driver, which DirectShow devices and which screens. Each is read by
 * name and opens nothing for capture.
 */

/**
 * The only ffmpeg the recorder runs on. 8.1 and 9.x need NVIDIA driver 610+
 * for NVENC (Matt has 591.74), and every number in the rig was measured on
 * 8.0.1, so another build is refused rather than quietly changing the capture.
 */
export const FFMPEG_VERSION = "8.0.1";

const INSTALL =
  `Install it with: winget install Gyan.FFmpeg --version ${FFMPEG_VERSION}, ` +
  `then keep it there with: winget pin add Gyan.FFmpeg --version ${FFMPEG_VERSION}`;

export const checkFfmpeg = async (launch: Launcher): Promise<FfmpegCheck> => {
  const { stdout, stderr } = await runToEnd(
    launch({
      tool: "ffmpeg",
      args: ["-hide_banner", "-version"],
      cwd: "/mnt/c",
    })
  );
  const version = stdout.match(/ffmpeg version (\S+)/)?.[1];
  if (!version) {
    return {
      ok: false,
      message: `ffmpeg.exe did not report a version (${(stderr || stdout).trim().slice(0, 200) || "no output"}). The recorder needs ${FFMPEG_VERSION}. ${INSTALL}.`,
    };
  }
  if (version !== FFMPEG_VERSION && !version.startsWith(`${FFMPEG_VERSION}-`)) {
    return {
      ok: false,
      message: `ffmpeg.exe is ${version}, but the recorder needs ${FFMPEG_VERSION} (newer builds need NVIDIA driver 610+ for NVENC). ${INSTALL}.`,
    };
  }
  return { ok: true, version };
};

/**
 * A warning when the NVIDIA driver differs from the one the service saw at
 * its last start-up, which it keeps in `stateDir`. A driver change only
 * warns: ffmpeg 8.0.1's NVENC keeps working on newer drivers.
 */
export const checkNvidiaDriver = async (
  launch: Launcher,
  stateDir: string
): Promise<string | undefined> => {
  const { code, stdout } = await runToEnd(
    launch({
      tool: "nvidia-smi",
      args: ["--query-gpu=driver_version", "--format=csv,noheader"],
    })
  );
  const driver = stdout.trim().split(/\r?\n/)[0]?.trim();
  if (code !== 0 || !driver) {
    return "Could not read the NVIDIA driver version (nvidia-smi failed). NVENC may not be available.";
  }
  const file = path.join(stateDir, "nvidia-driver.txt");
  const previous = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim()
    : undefined;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, `${driver}\n`);
  if (previous && previous !== driver) {
    return `The NVIDIA driver changed from ${previous} to ${driver} since the recorder last started. Recording carries on; if NVENC fails, this is why.`;
  }
  return undefined;
};

export type DshowDevice = { name: string; kind: "video" | "audio" };

/**
 * The DirectShow devices, by name. ffmpeg prints them on stderr and its exit
 * code is no signal (8.0.1 exits 0 after "Error opening input file dummy",
 * older builds 1), so both streams are read whatever the exit code.
 */
export const listDshowDevices = async (
  launch: Launcher
): Promise<{ devices: DshowDevice[]; raw: string }> => {
  const { stdout, stderr } = await runToEnd(
    launch({
      tool: "ffmpeg",
      args: [
        "-hide_banner",
        "-list_devices",
        "true",
        "-f",
        "dshow",
        "-i",
        "dummy",
      ],
      cwd: "/mnt/c",
    })
  );
  const raw = `${stderr}\n${stdout}`.replace(/\r/g, "").trim();
  const devices: DshowDevice[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/\] "(.+)" \((video|audio)\)/);
    if (m?.[1] && (m[2] === "video" || m[2] === "audio")) {
      devices.push({ name: m[1], kind: m[2] });
    }
  }
  return { devices, raw };
};

export type Screen = {
  index: number;
  width: number;
  height: number;
  name: string;
};

/** ddagrab's outputs in its output_idx order, each with its monitor's EDID name. */
export const listScreens = async (launch: Launcher): Promise<Screen[]> => {
  const { stdout } = await runToEnd(
    launch({ tool: "powershell", script: "screens.ps1", args: [] })
  );
  return stdout
    .replace(/\r/g, "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, , , width, height, , name] = line.split("\t");
      return {
        index: Number(index),
        width: Number(width),
        height: Number(height),
        name: name ?? "?",
      };
    });
};
