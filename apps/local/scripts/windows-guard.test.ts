import { describe, expect, it } from "vitest";
import { reasonsToRefuse } from "./windows-guard";

const ffmpegExe =
  "/init /mnt/c/Users/me/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg/bin/ffmpeg.exe";

describe("the Windows guard", () => {
  it("refuses while the recorder service runs", () => {
    expect(
      reasonsToRefuse({
        linux: [
          "node /repo/apps/local/node_modules/.bin/../tsx/dist/cli.mjs recorder-service/start-recorder-service.ts",
        ],
      })
    ).toHaveLength(1);
    expect(
      reasonsToRefuse({
        linux: [
          "/usr/bin/node --import tsx /repo/apps/local/recorder-service/service-process.ts",
        ],
      })
    ).toHaveLength(1);
  });

  it("refuses while a recorder ffmpeg.exe runs, even with the service gone", () => {
    expect(
      reasonsToRefuse({
        linux: [
          `${ffmpegExe} -i tcp://127.0.0.1:5000 -metadata comment=cvm-recorder-1234 camera.mkv`,
        ],
      })
    ).toHaveLength(1);
  });

  it("refuses while OBS runs", () => {
    expect(
      reasonsToRefuse({ linux: [], windows: ["explorer.exe", "OBS64.EXE"] })
    ).toEqual(["OBS is running (OBS64.EXE)."]);
  });

  it("allows another harness's ffmpeg.exe, and anything else", () => {
    expect(
      reasonsToRefuse({
        linux: [
          `${ffmpegExe} -f lavfi -i testsrc out.mkv`,
          "node vitest run recorder-service/recording-session.test.ts",
        ],
        windows: ["explorer.exe", "ffmpeg.exe", "Code.exe"],
      })
    ).toEqual([]);
  });
});
