/**
 * THE STILL QUEUE (#2323). The editor's Clip list shows every Clip's
 * first-frame still, and an uncached still takes the server 1.5-3.2 s to
 * decode. The app is plain HTTP/1.1, so the browser opens six connections to
 * it: forty `<img>`s asked for at once took all six and parked them in the
 * Still Gate's queue, and the Clip's `<video>` could not load until every
 * still had arrived.
 *
 * So a still only gets its `src` once the queue admits it, at most
 * {@link STILLS_IN_FLIGHT} at a time, in the order they asked. A waiting still
 * has sent no request, so it holds no connection.
 *
 * VIDEOS FIRST (#2421). Two in flight still went ahead of the videos when
 * Footage is slow to serve (/mnt/d): the editor opens on two CVM-recorder
 * Clips, six `<video>`s (mic, camera, screen) each loading in several range
 * requests, and between them the browser handed a free connection to a still
 * (an image outranks media), whose decode then read the same drive. The
 * current Clip took about twice as long to play. So no still is admitted
 * while any `<video>` on the page is loading: a `<video>`
 * is a `media` ticket from the moment it starts loading (or stalls) until it
 * can play, stops fetching with a frame in hand, fails, or goes away.
 *
 * A still is a `ticket`: one `<img>` asking for one URL. A ticket leaves the
 * queue when its image loads or fails, or when its `<img>` goes away.
 */
export const STILLS_IN_FLIGHT = 2;

export namespace stillQueueReducer {
  export type State = {
    /** Tickets whose `<img>` has its `src`, oldest first. */
    loading: readonly string[];
    /** Tickets waiting their turn, oldest first. */
    waiting: readonly string[];
    /** Tickets whose image has loaded or failed: they keep their `src`. */
    settled: readonly string[];
    /** `<video>`s still loading what they need to play: no still goes while any is. */
    media: readonly string[];
  };

  export type Action =
    | { type: "still-mounted"; ticket: string }
    | { type: "still-settled"; ticket: string }
    | { type: "still-unmounted"; ticket: string }
    /** A `<video>` mounted with a src, started loading, or stalled for data. */
    | { type: "video-loading"; ticket: string }
    /**
     * A `<video>` stopped fetching for now (its `suspend` event), at this
     * `readyState`. Chrome also pauses between the range requests of one
     * load, at HAVE_METADATA: only a pause with a frame in hand counts.
     */
    | { type: "video-suspended"; ticket: string; readyState: number }
    /** A `<video>` can play (`canplay`). */
    | { type: "video-can-play"; ticket: string }
    /** A `<video>` failed to load. */
    | { type: "video-failed"; ticket: string }
    | { type: "video-unmounted"; ticket: string };
}

export const createInitialStillQueueState = (): stillQueueReducer.State => ({
  loading: [],
  waiting: [],
  settled: [],
  media: [],
});

/** Moves waiting tickets into the free slots, once no video is loading. */
const admit = (state: stillQueueReducer.State): stillQueueReducer.State => {
  const free =
    state.media.length > 0
      ? 0
      : Math.max(0, STILLS_IN_FLIGHT - state.loading.length);
  if (free === 0 || state.waiting.length === 0) return state;
  return {
    ...state,
    loading: [...state.loading, ...state.waiting.slice(0, free)],
    waiting: state.waiting.slice(free),
  };
};

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: a frame to show. */
const HAVE_CURRENT_DATA = 2;

const drop = (list: readonly string[], ticket: string) =>
  list.filter((t) => t !== ticket);

export const stillQueueReducer = (
  state: stillQueueReducer.State,
  action: stillQueueReducer.Action
): stillQueueReducer.State => {
  switch (action.type) {
    case "still-mounted":
      if (
        state.loading.includes(action.ticket) ||
        state.waiting.includes(action.ticket) ||
        state.settled.includes(action.ticket)
      ) {
        return state;
      }
      return admit({ ...state, waiting: [...state.waiting, action.ticket] });
    case "still-settled":
      // A settled still stays on screen; it only gives up its slot.
      if (!state.loading.includes(action.ticket)) return state;
      return admit({
        ...state,
        loading: drop(state.loading, action.ticket),
        settled: [...state.settled, action.ticket],
      });
    case "still-unmounted":
      return admit({
        ...state,
        loading: drop(state.loading, action.ticket),
        waiting: drop(state.waiting, action.ticket),
        settled: drop(state.settled, action.ticket),
      });
    case "video-loading":
      if (state.media.includes(action.ticket)) return state;
      return { ...state, media: [...state.media, action.ticket] };
    case "video-suspended":
      if (action.readyState < HAVE_CURRENT_DATA) return state;
      return videoDone(state, action.ticket);
    case "video-can-play":
    case "video-failed":
    case "video-unmounted":
      return videoDone(state, action.ticket);
  }
};

const videoDone = (
  state: stillQueueReducer.State,
  ticket: string
): stillQueueReducer.State => {
  if (!state.media.includes(ticket)) return state;
  return admit({ ...state, media: drop(state.media, ticket) });
};

/** Whether a ticket's `<img>` may have its `src` yet. */
export const isStillAdmitted = (
  state: stillQueueReducer.State,
  ticket: string
): boolean => state.loading.includes(ticket) || state.settled.includes(ticket);
