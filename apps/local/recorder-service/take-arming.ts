import type { Launcher } from "./launcher";
import { Refusal } from "./refusal";
import {
  armTake,
  sameTake,
  type ArmedTake,
  type TakeSettings,
} from "./recording-session";

/** How long Record waits for a writer it had to arm on the spot. */
const ARM_TIMEOUT_MS = 10_000;

/** How long after an armed writer quits before another is armed. */
const REARM_DELAY_MS = 1_000;

/**
 * THE NEXT TAKE'S WRITER (#2207): kept armed on the live camera capture's
 * relay, with what the next take would record with (`wanted`), so Record
 * only has to tell it T0. One at a time: the relay takes one writer, so a
 * writer armed with other settings quits before the next one starts.
 */
export const createTakeArming = (o: {
  launch: Launcher;
  /** Windows wall-clock ms. */
  now: () => number;
  /** What the next take records with, if one can be armed now. */
  wanted: () => TakeSettings | undefined;
}) => {
  let armed: ArmedTake | undefined;

  const arm = (settings: TakeSettings) => {
    const take: ArmedTake = armTake({
      launch: o.launch,
      now: o.now,
      settings,
      onQuit: (errors) => {
        if (armed !== take) return;
        armed = undefined;
        console.error(
          `recorder: the armed camera writer quit before Record${errors.length ? `: ${errors.join(" ")}` : ""}; arming another`
        );
        setTimeout(rearm, REARM_DELAY_MS);
      },
    });
    armed = take;
    return take;
  };

  /** Quits the armed writer, if any; done once its folder is gone. */
  const disarm = async () => {
    const take = armed;
    armed = undefined;
    await take?.disarm();
  };

  /** Arms what `wanted` says, if it is not armed already; none if it says none. Not awaited. */
  function rearm() {
    const wanted = o.wanted();
    if (armed && (!wanted || !sameTake(armed.settings, wanted))) {
      const old = armed;
      armed = undefined;
      void old.disarm().then(rearm);
      return;
    }
    if (!armed && wanted) arm(wanted);
  }

  return {
    rearm,
    disarm,
    /** Whether a writer is armed now. */
    isArmed: () => armed !== undefined,
    /**
     * The writer for a take with these settings, ready to begin: the armed
     * one, or one armed now and waited for. Refuses when none starts.
     */
    takeFor: async (settings: TakeSettings): Promise<ArmedTake> => {
      if (armed && !sameTake(armed.settings, settings)) await disarm();
      const take = armed ?? arm(settings);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          take.ready,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("it did not connect in time")),
              ARM_TIMEOUT_MS
            );
          }),
        ]);
      } catch (e) {
        if (armed === take) await disarm();
        throw new Refusal(
          `The camera writer did not start: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        clearTimeout(timer);
      }
      if (armed === take) armed = undefined;
      return take;
    },
  };
};
