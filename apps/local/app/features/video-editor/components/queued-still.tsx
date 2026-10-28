import {
  useEffect,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import {
  createInitialStillQueueState,
  isStillAdmitted,
  stillQueueReducer,
} from "../still-queue-reducer";

// One queue for the whole page: the browser's six connections are per origin,
// not per component.
let queue = createInitialStillQueueState();
const listeners = new Set<() => void>();

const dispatch = (action: stillQueueReducer.Action) => {
  const next = stillQueueReducer(queue, action);
  if (next === queue) return;
  queue = next;
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * A Clip still that waits its turn in the Still Queue before it asks the
 * server for anything, so stills never take the connections a Clip's
 * `<video>` needs (#2323). Until then it draws an empty box the same size.
 */
export const QueuedStill = (props: {
  src: string;
  alt: string;
  className?: string;
}) => {
  const ticket = `${useId()} ${props.src}`;

  // Bridges mount and unmount to the queue; it decides nothing.
  useEffect(() => {
    dispatch({ type: "still-mounted", ticket });
    return () => dispatch({ type: "still-unmounted", ticket });
  }, [ticket]);

  const admitted = useSyncExternalStore(
    subscribe,
    () => isStillAdmitted(queue, ticket),
    () => false
  );

  if (!admitted) {
    return <div className={cn(props.className, "bg-muted")} />;
  }

  const settled = () => dispatch({ type: "still-settled", ticket });
  return (
    <img
      src={props.src}
      alt={props.alt}
      className={props.className}
      onLoad={settled}
      onError={settled}
    />
  );
};

/**
 * Holds every still in the Still Queue while this `<video>` loads, so the
 * Clip's videos always get the browser's connections, and the server's
 * Footage reads, first (videos first). A layout effect, so the video counts
 * before any still in the same commit can be admitted. Bridges the element's
 * events to the queue; the reducer decides what they mean.
 */
export const useStillsWaitForVideo = (
  ref: RefObject<HTMLVideoElement | null>,
  src: string | null
) => {
  const id = useId();
  useLayoutEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const ticket = `${id} ${src}`;
    const loading = () => dispatch({ type: "video-loading", ticket });
    const suspended = () =>
      dispatch({
        type: "video-suspended",
        ticket,
        readyState: video.readyState,
      });
    const canPlay = () => dispatch({ type: "video-can-play", ticket });
    const failed = () => dispatch({ type: "video-failed", ticket });
    const listeners = [
      ["loadstart", loading],
      ["waiting", loading],
      ["suspend", suspended],
      ["canplay", canPlay],
      ["error", failed],
    ] as const;

    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) loading();
    for (const [event, listener] of listeners) {
      video.addEventListener(event, listener);
    }
    return () => {
      for (const [event, listener] of listeners) {
        video.removeEventListener(event, listener);
      }
      dispatch({ type: "video-unmounted", ticket });
    };
  }, [ref, src, id]);
};
