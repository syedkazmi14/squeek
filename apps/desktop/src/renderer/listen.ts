// Records one spoken question from the microphone. In automatic mode it stops by
// itself once the person has finished talking; held Ctrl instead stops on release.

// How long a pause ends the question.
const SILENCE_MS = 1300;
// Give up if nothing is said for this long after listening starts.
const NO_SPEECH_MS = 7000;
// Hard cap on one question.
const MAX_MS = 25000;
// Room noise is measured for this long, then speech must be clearly louder.
const CALIBRATE_MS = 300;
const MIN_THRESHOLD = 0.015;
// Someone who starts talking straight away raises the "noise" measurement; capping
// the threshold keeps ordinary speech above it.
const MAX_THRESHOLD = 0.05;

export interface Recording {
  /** Ends listening; `done` then resolves with what was said so far. */
  stop(): void;
  /** Ends listening and throws the recording away. */
  cancel(): void;
  /** The recorded audio (webm/opus), or undefined if nothing was said. */
  done: Promise<Uint8Array | undefined>;
}

export async function record(auto = true): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const recorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus",
  });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const started = performance.now();
  let noise = 0;
  let calibrations = 0;
  let heard = false;
  let lastLoud = started;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.sqrt(sum / samples.length);
    const now = performance.now();
    if (now - started < CALIBRATE_MS) {
      noise = (noise * calibrations + level) / ++calibrations;
      return;
    }
    if (level > Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, noise * 3))) {
      heard = true;
      lastLoud = now;
    }
    if (
      (auto && heard && now - lastLoud > SILENCE_MS) ||
      (auto && !heard && now - started > NO_SPEECH_MS) ||
      now - started > MAX_MS
    )
      stop();
  }, 50);

  let discarded = false;
  function stop(): void {
    clearInterval(timer);
    if (recorder.state !== "inactive") recorder.stop();
  }
  function cancel(): void {
    discarded = true;
    stop();
  }

  const done = new Promise<Uint8Array | undefined>((resolve) => {
    recorder.addEventListener("stop", () => {
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => {});
      if (discarded || !heard || !chunks.length) {
        resolve(undefined);
        return;
      }
      void new Blob(chunks, { type: "audio/webm" })
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)));
    });
  });
  recorder.start(250);
  return { stop, cancel, done };
}
