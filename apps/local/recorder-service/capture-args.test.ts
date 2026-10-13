import { describe, expect, it } from "vitest";
import {
  buildCaptureArgs,
  cameraPreviewArgs,
  previewOutput,
} from "./capture-args";

const capture = () =>
  buildCaptureArgs({
    t0Ms: 1_000_000,
    tag: "t",
    screenIndex: 0,
    camera: "Cam Link 4K",
    mic: "Mic",
    silenceLength: "short",
    thresholdDb: -40,
    cameraPreviewPort: 9,
  });

const graphOf = (args: readonly string[]) =>
  args[args.indexOf("-filter_complex") + 1]!.split(";");

describe("the previews (#2144)", () => {
  it("split the camera off before the shared clock's CFR while recording", () => {
    const graph = graphOf(capture().camera);
    const preview = graph.find((chain) => chain.endsWith("[camprev]"))!;
    const recorded = graph.find((chain) => chain.endsWith("[cam]"))!;
    expect(preview).not.toContain("fps=");
    expect(preview).not.toContain("2560:1440");
    // camera.mkv keeps its chain: CFR, BT.709, 1440p.
    expect(recorded).toBe(
      "[camr]fps=30000/1001:start_time=0,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale_cuda=2560:1440:interp_algo=bicubic[cam]"
    );
  });

  it("send every frame as it comes, with at most two queued", () => {
    const out = previewOutput(9).join(" ");
    expect(out).toContain("-fps_mode passthrough");
    expect(out).toContain("queue_size=2");
    expect(out).toContain("tcp_nodelay=1");
  });

  it("let only the preview-only Cam Link drop frames it falls behind on", () => {
    const rtbuf = (args: readonly string[]) =>
      args[args.indexOf("-rtbufsize") + 1];
    expect(
      rtbuf(cameraPreviewArgs({ camera: "c", port: 1, stillPort: 2 }))
    ).toBe("64M");
    expect(rtbuf(capture().camera)).toBe("1500M");
  });
});
