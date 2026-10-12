/**
 * Recorder parity: the measuring half of `pnpm recorder-parity` — what ffmpeg
 * is asked to measure, how its output is read, and the verdict against the
 * thresholds. Pure (no ffmpeg, no filesystem), so its seam is tested on
 * captured ffmpeg output; `recorder-parity.ts` runs the commands.
 *
 * One OBS Clip and one CVM-recorder Clip are each rendered through the real
 * segmented export (`clipSegmentArgs`), and every metric below is read off
 * those two segment files, so a difference here is a difference a mixed
 * Video's viewer sees or hears between the two Clips.
 */
import type { MicEq } from "@cvm/core/features/videos/recorder";

/** One side's picture and sound, as measured off its rendered segment. */
export type SideMetrics = {
  readonly picture: PictureFields;
  readonly levels: LumaLevels;
  /** blurdetect's mean: higher is blurrier. */
  readonly blurMean: number;
  readonly lufs: number;
  readonly bands: BandLevels;
  /** Picture minus sound duration of the segment, in ms. */
  readonly avDurationSkewMs: number;
};

export type PictureFields = {
  readonly width: number;
  readonly height: number;
  readonly fps: string;
  readonly pixFmt: string;
  readonly colorRange: string;
  readonly colorSpace: string;
  readonly colorPrimaries: string;
  readonly colorTransfer: string;
};

/** Per-frame signalstats, averaged over the sample (8-bit code values). */
export type LumaLevels = {
  readonly ymin: number;
  readonly ymax: number;
  readonly yavg: number;
};

/** RMS level of each band (dB), split where OBS's 3-Band Equalizer splits. */
export type BandLevels = {
  readonly lowDb: number;
  readonly midDb: number;
  readonly highDb: number;
};

export const BANDS = ["low", "mid", "high"] as const;
export type Band = (typeof BANDS)[number];

/**
 * The audio filter isolating one band, at OBS's 3-Band Equalizer split
 * points (800 Hz and 5 kHz). Each edge is two cascaded 2-pole filters
 * (24 dB/octave), steep enough that a 6 dB shelf shows in its band.
 */
export const bandFilter = (band: Band): string => {
  const lp = (f: number) => `lowpass=f=${f},lowpass=f=${f}`;
  const hp = (f: number) => `highpass=f=${f},highpass=f=${f}`;
  switch (band) {
    case "low":
      return lp(800);
    case "mid":
      return `${hp(800)},${lp(5000)}`;
    case "high":
      return hp(5000);
  }
};

/** The measuring filters, each appended to `ffmpeg -i <file> … -f null -`. */
export const MEASURE_FILTERS = {
  /** blurdetect logs `blur mean`; signalstats prints per-frame Y stats. */
  picture: "blurdetect,signalstats,metadata=mode=print",
  loudness: "ebur128",
  band: (band: Band) =>
    `${bandFilter(band)},astats=measure_perchannel=none:measure_overall=RMS_level`,
} as const;

const number = (text: string, re: RegExp, what: string): number => {
  const match = text.match(re);
  if (!match) throw new Error(`No ${what} in the ffmpeg output`);
  return Number(match[1]);
};

/** The per-frame YMIN/YMAX/YAVG `signalstats,metadata=mode=print` printed. */
export const parseLumaLevels = (stderr: string): LumaLevels => {
  const mean = (key: string) => {
    const values = [
      ...stderr.matchAll(
        new RegExp(`lavfi\\.signalstats\\.${key}=(-?[\\d.]+)`, "g")
      ),
    ].map((m) => Number(m[1]));
    if (values.length === 0) {
      throw new Error(`No signalstats ${key} in the ffmpeg output`);
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  return { ymin: mean("YMIN"), ymax: mean("YMAX"), yavg: mean("YAVG") };
};

/** blurdetect's summary line, `blur mean: 8.46`. */
export const parseBlurMean = (stderr: string): number =>
  number(stderr, /blur mean:\s*(-?[\d.]+)/, "blurdetect mean");

/** ebur128's summary integrated loudness, `I: -18.3 LUFS`. */
export const parseIntegratedLufs = (stderr: string): number =>
  number(
    stderr,
    /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-inf) LUFS/,
    "integrated loudness"
  );

/** astats' overall `RMS level dB: -23.4` (`-inf` for silence). */
export const parseRmsLevel = (stderr: string): number => {
  const match = stderr.match(/Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+|-inf)/);
  if (!match) throw new Error("No astats RMS level in the ffmpeg output");
  return match[1] === "-inf" ? -Infinity : Number(match[1]);
};

/**
 * `ffprobe -show_streams -of json`: the first video stream's colour fields
 * and the picture-minus-sound duration skew.
 */
export const parseProbe = (
  json: string
): { picture: PictureFields; avDurationSkewMs: number | null } => {
  const { streams } = JSON.parse(json) as {
    streams: Record<string, string | number | undefined>[];
  };
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("No video stream in the ffprobe output");
  const audio = streams.find((s) => s.codec_type === "audio");
  const str = (v: unknown) => (v === undefined ? "unknown" : String(v));
  return {
    picture: {
      width: Number(video.width),
      height: Number(video.height),
      fps: str(video.r_frame_rate),
      pixFmt: str(video.pix_fmt),
      colorRange: str(video.color_range),
      colorSpace: str(video.color_space),
      colorPrimaries: str(video.color_primaries),
      colorTransfer: str(video.color_transfer),
    },
    avDurationSkewMs:
      audio?.duration !== undefined && video.duration !== undefined
        ? Math.round((Number(video.duration) - Number(audio.duration)) * 1000)
        : null,
  };
};

/**
 * The thresholds two Clips of one Video must meet, and why each is where it is.
 */
export const THRESHOLDS = {
  /**
   * 1 LU: about the smallest loudness step a listener hears between adjacent
   * Clips. The export's normalize pass moves the whole Video, so a step
   * between Clips survives it.
   */
  lufs: 1,
  /**
   * 4 code values: limited range sits at 16–235. Full-range picture shown as
   * limited (or the reverse) moves the ends by ~16; exposure and content
   * differences between two takes move them by a few.
   */
  lumaEnds: 4,
  /** 12 code values of average luma: an exposure or gamma mismatch, not content. */
  lumaAverage: 12,
  /**
   * 20% of blurdetect's mean: two takes from one camera land within ~10%;
   * a 1440p source scaled where OBS sent 1080p, or a softer encode, moves it
   * further.
   */
  blurRelative: 0.2,
  /**
   * 3 dB on each band's level relative to the mid band: half the 6.1 dB high
   * cut, so a missing or doubled EQ fails while sentence-to-sentence
   * spectral wobble (1–2 dB) passes.
   */
  bandShapeDb: 3,
  /** 1.5 dB between the EQ the export should apply and what it applied. */
  eqAppliedDb: 1.5,
  /** One 60 fps frame of picture-vs-sound duration in a segment. */
  avSkewMs: 17,
} as const;

export type Check = {
  readonly area: "picture" | "audio";
  readonly name: string;
  readonly obs: string;
  readonly cvm: string;
  readonly pass: boolean;
  readonly rule: string;
};

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toFixed(digits) : String(n);

const shape = (b: BandLevels) => ({
  low: b.lowDb - b.midDb,
  high: b.highDb - b.midDb,
});

/**
 * Every parity check between an OBS Clip's segment and a CVM-recorder Clip's,
 * plus — when the CVM Clip's raw mic was measured over the same span — whether
 * the export applied the Mic EQ it was asked to.
 */
export const compareSides = (input: {
  readonly obs: SideMetrics;
  readonly cvm: SideMetrics;
  readonly cvmRawMicBands: BandLevels | null;
  readonly micEq: MicEq | null;
}): Check[] => {
  const { obs, cvm } = input;
  const same = (name: string, key: keyof PictureFields): Check => ({
    area: "picture",
    name,
    obs: String(obs.picture[key]),
    cvm: String(cvm.picture[key]),
    pass: obs.picture[key] === cvm.picture[key],
    rule: "identical",
  });
  const within = (
    area: Check["area"],
    name: string,
    a: number,
    b: number,
    limit: number,
    unit: string
  ): Check => ({
    area,
    name,
    obs: fmt(a),
    cvm: fmt(b),
    pass: Math.abs(a - b) <= limit,
    rule: `|Δ| ≤ ${limit}${unit} (Δ ${fmt(b - a)})`,
  });
  const obsShape = shape(obs.bands);
  const cvmShape = shape(cvm.bands);
  const blurDelta = (cvm.blurMean - obs.blurMean) / obs.blurMean;
  const checks: Check[] = [
    {
      area: "picture",
      name: "resolution",
      obs: `${obs.picture.width}x${obs.picture.height}`,
      cvm: `${cvm.picture.width}x${cvm.picture.height}`,
      pass:
        obs.picture.width === cvm.picture.width &&
        obs.picture.height === cvm.picture.height,
      rule: "identical",
    },
    same("frame rate", "fps"),
    same("pixel format", "pixFmt"),
    same("colour range", "colorRange"),
    same("colour matrix", "colorSpace"),
    same("colour primaries", "colorPrimaries"),
    same("transfer", "colorTransfer"),
    within(
      "picture",
      "YMIN",
      obs.levels.ymin,
      cvm.levels.ymin,
      THRESHOLDS.lumaEnds,
      ""
    ),
    within(
      "picture",
      "YMAX",
      obs.levels.ymax,
      cvm.levels.ymax,
      THRESHOLDS.lumaEnds,
      ""
    ),
    within(
      "picture",
      "YAVG",
      obs.levels.yavg,
      cvm.levels.yavg,
      THRESHOLDS.lumaAverage,
      ""
    ),
    {
      area: "picture",
      name: "blur (blurdetect mean, lower is sharper)",
      obs: fmt(obs.blurMean, 2),
      cvm: fmt(cvm.blurMean, 2),
      pass: Math.abs(blurDelta) <= THRESHOLDS.blurRelative,
      rule: `|Δ| ≤ ${THRESHOLDS.blurRelative * 100}% (Δ ${fmt(blurDelta * 100)}%)`,
    },
    within(
      "audio",
      "integrated loudness (LUFS)",
      obs.lufs,
      cvm.lufs,
      THRESHOLDS.lufs,
      " LU"
    ),
    within(
      "audio",
      "low band vs mid (dB)",
      obsShape.low,
      cvmShape.low,
      THRESHOLDS.bandShapeDb,
      " dB"
    ),
    within(
      "audio",
      "high band vs mid (dB)",
      obsShape.high,
      cvmShape.high,
      THRESHOLDS.bandShapeDb,
      " dB"
    ),
    {
      area: "audio",
      name: "picture − sound duration in segment (ms)",
      obs: String(obs.avDurationSkewMs),
      cvm: String(cvm.avDurationSkewMs),
      pass:
        Math.abs(obs.avDurationSkewMs) <= THRESHOLDS.avSkewMs &&
        Math.abs(cvm.avDurationSkewMs) <= THRESHOLDS.avSkewMs,
      rule: `each ≤ ${THRESHOLDS.avSkewMs} ms`,
    },
  ];
  if (input.cvmRawMicBands && input.micEq) {
    const raw = input.cvmRawMicBands;
    const eq = input.micEq;
    for (const band of BANDS) {
      const expected = eq[`${band}Db`];
      const applied = cvm.bands[`${band}Db`] - raw[`${band}Db`];
      checks.push({
        area: "audio",
        name: `Mic EQ ${band} band applied (dB, export − raw mic)`,
        obs: "baked in by OBS",
        cvm: `${fmt(applied)} (asked ${fmt(expected)})`,
        pass: Math.abs(applied - expected) <= THRESHOLDS.eqAppliedDb,
        rule: `|Δ| ≤ ${THRESHOLDS.eqAppliedDb} dB`,
      });
    }
  }
  return checks;
};

/** The markdown report: what was compared, the images, and every check. */
export const renderReport = (input: {
  readonly title: string;
  readonly context: readonly string[];
  readonly images: readonly { readonly label: string; readonly file: string }[];
  readonly checks: readonly Check[];
  readonly notes: readonly string[];
}): string => {
  const failed = input.checks.filter((c) => !c.pass);
  const row = (c: Check) =>
    `| ${c.area} | ${c.name} | ${c.obs} | ${c.cvm} | ${c.rule} | ${c.pass ? "pass" : "**FAIL**"} |`;
  return [
    `# ${input.title}`,
    "",
    failed.length === 0
      ? `All ${input.checks.length} checks pass.`
      : `${failed.length} of ${input.checks.length} checks fail: ${failed.map((c) => c.name).join("; ")}.`,
    "",
    ...input.context.map((line) => `- ${line}`),
    "",
    ...input.images.flatMap((img) => [
      `## ${img.label}`,
      "",
      `![${img.label}](${img.file})`,
      "",
    ]),
    "## Checks",
    "",
    "| area | check | OBS | CVM | threshold | result |",
    "| --- | --- | --- | --- | --- | --- |",
    ...input.checks.map(row),
    "",
    ...(input.notes.length > 0
      ? ["## Notes", "", ...input.notes.map((n) => `- ${n}`), ""]
      : []),
  ].join("\n");
};
