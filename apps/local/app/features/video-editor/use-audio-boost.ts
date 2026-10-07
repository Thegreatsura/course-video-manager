import { useEffect } from "react";

/**
 * Module-scope cache: tracks the permanent element → source binding
 * created by createMediaElementSource. The Web Audio API forbids
 * calling createMediaElementSource on an element that was already
 * connected, so we reuse the existing source on re-mounts.
 * WeakMap lets entries be GC'd when the element is removed from the DOM.
 */
const sourceCache = new WeakMap<
  HTMLMediaElement,
  {
    source: MediaElementAudioSourceNode;
    context: AudioContext;
  }
>();

/**
 * Routes `video` through a GainNode boosting it by `boostDb`, returning the
 * teardown. Safe to call again for the same element after teardown — React
 * Strict Mode's mount → unmount → mount does exactly that — because the
 * element's source node is created once and reused.
 */
export function connectAudioBoost(
  video: HTMLMediaElement,
  boostDb: number,
  createAudioContext: () => AudioContext = () => new AudioContext()
): () => void {
  let cached = sourceCache.get(video);

  if (!cached) {
    const context = createAudioContext();
    const source = context.createMediaElementSource(video);
    cached = { source, context };
    sourceCache.set(video, cached);
  }

  const { source, context } = cached;
  const gain = context.createGain();
  gain.gain.value = Math.pow(10, boostDb / 20);

  source.connect(gain);
  gain.connect(context.destination);

  return () => {
    source.disconnect();
    gain.disconnect();
  };
}

/**
 * Connects a video element to a Web Audio graph with a GainNode
 * to boost audio volume beyond the native 1.0 maximum.
 *
 * Tolerates React Strict Mode double-invoke by caching the
 * element → source binding in a module-scope WeakMap.
 */
export function useAudioBoost(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  boostDb: number
) {
  // Set up the audio graph (source → gain → destination)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return connectAudioBoost(video, boostDb);
  }, [videoRef, boostDb]);
}
