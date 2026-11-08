export function decision({ listeners, playing, connected, mustPause }) {
  if (!listeners || mustPause) return playing ? 'pause' : 'leave';
  if (!playing) return 'idle';
  return connected ? 'stream' : 'join';
}
