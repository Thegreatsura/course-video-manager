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
  });

const graphOf = (args: readonly string[]) =>
  args[args.indexOf("-filter_complex") + 1]!.split(";");

describe("the previews (#2144)", () => {
  it("send camera.mkv's own packets as the take's camera preview, with no encoder of its own (#2203)", () => {
    const take = capture().camera;
    // camera.mkv keeps its chain: CFR, BT.709, 1440p.
    expect(graphOf(take)).toContain(
      "[0:v]setpts=PTS-1000.000/TB,hwupload_cuda,fps=30000/1001:start_time=0,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale_cuda=2560:1440:interp_algo=bicubic[cam]"
    );
    const args = take.join(" ");
    expect(args.match(/h264_nvenc/g)).toHaveLength(1);
    expect(args).toContain("-bf 2 -g 60 -fps_mode passthrough -delay 1");
    expect(args).not.toContain("libx264");
    // The file is written straight (no fifo) and fails the take if it
    // cannot be; the feed drops, retries and is ignored when it fails.
    expect(args).toContain(
      "[f=matroska:use_fifo=0:onfail=abort:cluster_time_limit=1000:flush_packets=1]camera.mkv|[f=flv:onfail=ignore]tcp://127.0.0.1:9"
    );
    expect(args).toContain("drop_pkts_on_overflow=1");
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

  it("are full size: the camera at camera.mkv's 1440p, the screen unscaled at 60 fps", () => {
    expect(
      graphOf(
        cameraPreviewArgs({
          camera: "c",
          port: 1,
          stillPort: 2,
          encoder: "nvenc",
        })
      ).join(";")
    ).toContain("[p]scale_cuda=2560:1440");
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
