import { redirect } from "react-router";
import { AV_CALIBRATION_PATH } from "@/av-calibration-constants";

/**
 * The AV Calibration page's old URL, from when it was the Audio Calibration
 * (#2094): a bookmark still lands on the page.
 */
export const loader = () => redirect(AV_CALIBRATION_PATH, 301);
