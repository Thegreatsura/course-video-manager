/**
 * The mic both Recorders capture: OBS's mic source and the CVM recorder's
 * dshow input are this Voicemeeter output, and the browser's silence detector
 * on the OBS path opens it too, so all of them hear the same audio.
 */
export const MIC_NAME = "Voicemeeter Out B1";

/** Whether a device's name or label is the mic, matched as the recorder service matches it (`findByName`). */
export const isMicDevice = (label: string): boolean =>
  label.toLowerCase().includes(MIC_NAME.toLowerCase());
