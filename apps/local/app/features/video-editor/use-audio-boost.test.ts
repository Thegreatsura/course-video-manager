import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { connectAudioBoost } from "./use-audio-boost";

/**
 * A fake of the Web Audio API that keeps its one rule that matters here: an
 * element is bound for life to the first MediaElementAudioSourceNode made for
 * it, and asking for a second one throws — even from a new AudioContext.
 */
function fakeWebAudio() {
  const boundElements = new WeakSet<object>();

  class FakeNode {
    outputs = new Set<FakeNode>();
    connect(node: FakeNode) {
      this.outputs.add(node);
    }
    disconnect() {
      this.outputs.clear();
    }
  }

  class FakeGainNode extends FakeNode {
    gain = { value: 1 };
  }

  class FakeAudioContext {
    destination = new FakeNode();
    createGain() {
      return new FakeGainNode();
    }
    createMediaElementSource(element: object) {
      if (boundElements.has(element)) {
        throw new Error(
          "InvalidStateError: HTMLMediaElement already connected previously to a different MediaElementSourceNode"
        );
      }
      boundElements.add(element);
      return new FakeNode();
    }
  }

  const contexts: FakeAudioContext[] = [];
  const sources: FakeNode[] = [];

  return {
    createAudioContext: () => {
      const context = new FakeAudioContext();
      const create = context.createMediaElementSource.bind(context);
      context.createMediaElementSource = (element) => {
        const source = create(element);
        sources.push(source);
        return source;
      };
      contexts.push(context);
      return fromAny<AudioContext, FakeAudioContext>(context);
    },
    /** The gain the element is heard through, or null if it is silent. */
    audibleGain(): number | null {
      for (const source of sources) {
        for (const node of source.outputs) {
          const reachesSpeakers = contexts.some((c) =>
            node.outputs.has(c.destination)
          );
          if (node instanceof FakeGainNode && reachesSpeakers) {
            return node.gain.value;
          }
        }
      }
      return null;
    },
  };
}

describe("connectAudioBoost", () => {
  it("survives Strict Mode's mount → unmount → mount and stays boosted", () => {
    const audio = fakeWebAudio();
    const video = fromAny<HTMLMediaElement, object>({});

    const unmount = connectAudioBoost(video, 20, audio.createAudioContext);
    unmount();
    connectAudioBoost(video, 20, audio.createAudioContext);

    expect(audio.audibleGain()).toBeCloseTo(10);
  });
});
