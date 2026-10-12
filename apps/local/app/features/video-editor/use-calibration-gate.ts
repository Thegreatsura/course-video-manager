import { useEffect, useMemo, useReducer } from "react";
import type {
  CalibrationValidity,
  LastPassedCalibration,
} from "@/av-calibration-constants";
import {
  calibrationGateReducer,
  createInitialCalibrationGateState,
  cvmRecorderGate,
  obsGate,
} from "./calibration-gate-reducer";

/** How often the gate looks at the clock again. */
const TICK_MS = 30_000;

export type CalibrationGate = {
  cvm: CalibrationValidity;
  obs: CalibrationValidity;
};

/** The gate for both Recorders, from the loader's calibration and the clock. */
export const useCalibrationGate = (o: {
  lastPassed: LastPassedCalibration | null;
  checkedAtMs: number;
  /** The OBS path's mic track label; null with none open. */
  browserInputLabel: string | null;
}): CalibrationGate => {
  const [state, dispatch] = useReducer(
    calibrationGateReducer,
    o,
    createInitialCalibrationGateState
  );
  // Bridges the clock in.
  useEffect(() => {
    const tick = () => dispatch({ type: "clock-ticked", nowMs: Date.now() });
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);
  // Bridges a revalidated loader in.
  useEffect(() => {
    dispatch({ type: "calibration-loaded", lastPassed: o.lastPassed });
  }, [o.lastPassed?.id]);
  return useMemo(
    () => ({
      cvm: cvmRecorderGate(state),
      obs: obsGate(state, o.browserInputLabel),
    }),
    [state, o.browserInputLabel]
  );
};
