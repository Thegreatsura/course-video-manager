import { describe, expect, it } from "vitest";
import {
  buildCaptureArgs,
  cameraPreviewArgs,
  previewOutput,
  screenPreviewArgs,
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
    cameraPreviewEncoder: "nvenc",
  });

const graphOf = (args: readonly string[]) =>
  args[args.indexOf("-filter_complex") + 1]!.split(";");

describe("the previews (#2144)", () => {
  it("split the camera off before the shared clock's CFR while recording", () => {
    const graph = graphOf(capture().camera);
    const preview = graph.find((chain) => chain.endsWith("[camprev]"))!;
    const recorded = graph.find((chain) => chain.endsWith("[cam]"))!;
    expect(preview).not.toContain("fps=");
    // camera.mkv keeps its chain: CFR, BT.709, 1440p.
    expect(recorded).toBe(
      "[camr]fps=30000/1001:start_time=0,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale_cuda=2560:1440:interp_algo=bicubic[cam]"
    );
  });

  it("stream each as low-latency H.264 on NVENC: no B-frames, no lookahead, a keyframe a second (#2194)", () => {
    const out = previewOutput(9, 30, "nvenc").join(" ");
    expect(out).toContain(
      "-c:v h264_nvenc -preset p1 -tune ull -zerolatency 1 -delay 0 -rc-lookahead 0 -bf 0"
    );
    expect(out).toContain("-g 30 -forced-idr 1 -no-scenecut 1");
    expect(out).toContain("[f=flv:onfail=ignore]tcp://127.0.0.1:9");
    expect(out).toContain("drop_pkts_on_overflow=1");
    expect(out).not.toContain("libx264");
  });

  it("fall back to #2192's libx264, with the frames brought down to the CPU for it", () => {
    const out = previewOutput(9, 30, "x264").join(" ");
    expect(out).toContain("-c:v libx264 -preset ultrafast -tune zerolatency");
    expect(out).toContain("keyint_min=30:scenecut=0");
    expect(out).not.toContain("nvenc");
    const screen = (encoder: "nvenc" | "x264") =>
      screenPreviewArgs({ screenIndex: 1, port: 9, encoder }).join(" ");
    expect(screen("x264")).toContain(
      "ddagrab=output_idx=1:framerate=60,hwdownload,format=bgra -map"
    );
    expect(screen("nvenc")).toContain(
      "ddagrab=output_idx=1:framerate=60,scale_d3d11=format=nv12 -map"
    );
    const camera = (encoder: "nvenc" | "x264") =>
      graphOf(
        cameraPreviewArgs({ camera: "c", port: 1, stillPort: 2, encoder })
      ).find((chain) => chain.endsWith("[prev]"))!;
    expect(camera("x264")).toContain("hwdownload");
    expect(camera("nvenc")).not.toContain("hwdownload");
  });

  it("carry the camera preview in a take on the camera feed's encoder, beside camera.mkv's own NVENC", () => {
    const take = (cameraPreviewEncoder: "nvenc" | "x264") =>
      buildCaptureArgs({
        t0Ms: 1_000_000,
        tag: "t",
        screenIndex: 0,
        camera: "Cam Link 4K",
        mic: "Mic",
        silenceLength: "short",
        thresholdDb: -40,
        cameraPreviewPort: 9,
        cameraPreviewEncoder,
      }).camera.join(" ");
    expect(take("x264")).toContain("-preset p5 -tune hq");
    expect(take("x264")).toContain("-c:v libx264");
    expect(take("nvenc").match(/h264_nvenc/g)).toHaveLength(2);
  });

  it("are full size: the camera at camera.mkv's 1440p, the screen unscaled at 60 fps", () => {
    expect(graphOf(capture().camera).join(";")).toContain(
      "[camp]scale_cuda=2560:1440"
    );
    const screen = screenPreviewArgs({
      screenIndex: 1,
      port: 9,
      encoder: "nvenc",
    }).join(" ");
    expect(screen).toContain(
      "ddagrab=output_idx=1:framerate=60,scale_d3d11=format=nv12 -map"
    );
  });

  it("let only the preview-only Cam Link drop frames it falls behind on", () => {
    const rtbuf = (args: readonly string[]) =>
      args[args.indexOf("-rtbufsize") + 1];
    expect(
      rtbuf(
        cameraPreviewArgs({
          camera: "c",
          port: 1,
          stillPort: 2,
          encoder: "nvenc",
        })
      )
    ).toBe("64M");
    expect(rtbuf(capture().camera)).toBe("1500M");
  });
});
