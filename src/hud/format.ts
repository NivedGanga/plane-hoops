export const GATES_PER_SEGMENT = 8;

/** Return progress through the current eight-gate segment without ending an endless run. */
export function formatGateProgress(totalCleared: number): string {
  const cleared = Math.max(0, Math.floor(totalCleared));
  const segmentProgress = cleared === 0 ? 0 : ((cleared - 1) % GATES_PER_SEGMENT) + 1;
  return `${segmentProgress} / ${GATES_PER_SEGMENT}`;
}

/** Format elapsed run time as MM:SS.hh, matching the flight HUD's precision. */
export function formatElapsedTime(elapsedSeconds: number): string {
  const centiseconds = Math.floor(Math.max(0, elapsedSeconds) * 100 + 1e-6);
  const totalSeconds = Math.floor(centiseconds / 100);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = centiseconds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}
