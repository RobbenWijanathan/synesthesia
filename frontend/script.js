// ---- Config ----
const API_BASE = "http://localhost:8000";
const STEM_NAMES = ["vocals", "drums", "bass", "other"];
const DEFAULT_VISUALS = {
  vocals: "aura",
  drums: "spectrum",
  bass: "ferro",
  other: "flowfield",
};

// ---- DOM references ----
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusEl = document.getElementById("status");
const playerSection = document.getElementById("player-section");
const playPauseBtn = document.getElementById("playPauseBtn");
const seekBar = document.getElementById("seekBar");
const timeDisplay = document.getElementById("timeDisplay");

const audioElements = {};
STEM_NAMES.forEach((name) => {
  audioElements[name] = document.getElementById(`audio-${name}`);
  audioElements[name].crossOrigin = "anonymous";
});

// ---- Web Audio + visualizer state (created lazily, after a user gesture) ----
let audioContext = null;
const analysers = {};
const stemPanels = {}; // { vocals: { canvas, ctx, buffer, redLayer, blueLayer, ... } }
let isPlaying = false;
let isSeeking = false;

// ---- Upload and separate ----
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = "Pick a file first.";
    return;
  }

  statusEl.textContent = "Separating stems, this can take a minute...";
  uploadBtn.disabled = true;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${API_BASE}/separate`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server responded ${response.status}`);
    }

    const data = await response.json();
    loadStems(data.stems);
  } catch (err) {
    statusEl.textContent = `Separation failed: ${err.message}`;
    uploadBtn.disabled = false;
  }
});

// ---- Point each <audio> element at its stem URL ----
function loadStems(stems) {
  STEM_NAMES.forEach((name) => {
    audioElements[name].src = `${API_BASE}${stems[name]}`;
  });

  const ready = STEM_NAMES.map(
    (name) =>
      new Promise((resolve) => {
        audioElements[name].addEventListener("loadedmetadata", resolve, {
          once: true,
        });
      })
  );

  Promise.all(ready).then(() => {
    statusEl.textContent = "Stems ready.";
    playerSection.hidden = false;
    setupAudioGraph();
  });
}

// ---- Web Audio graph: one AnalyserNode per stem ----
function setupAudioGraph() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  STEM_NAMES.forEach((name) => {
    const source = audioContext.createMediaElementSource(audioElements[name]);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    analysers[name] = analyser;
  });

  initVisualizerPanels();
  startVisualizerLoop();
}

function makeOffscreenCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// ---- Build one canvas + type selector + offscreen buffer per stem ----
function initVisualizerPanels() {
  STEM_NAMES.forEach((name) => {
    const canvas = document.querySelector(
      `canvas.stem-canvas[data-stem="${name}"]`
    );
    const select = document.querySelector(
      `select.visual-select[data-stem="${name}"]`
    );
    const chaosEl = document.querySelector(
      `.chaos-value[data-stem="${name}"]`
    );
    const bufferLength = analysers[name].frequencyBinCount;

    VISUALIZER_TYPES.forEach((type) => {
      const option = document.createElement("option");
      option.value = type.id;
      option.textContent = type.label;
      select.appendChild(option);
    });

    const defaultId = DEFAULT_VISUALS[name];
    select.value = defaultId;

    const panel = {
      canvas,
      ctx: canvas.getContext("2d"),
      select,
      chaosEl,
      chaosState: {},
      freqData: new Uint8Array(bufferLength),
      waveData: new Uint8Array(bufferLength),
      visualizer: VISUALIZER_TYPES.find((t) => t.id === defaultId).create(),
      // Visualizers draw into this offscreen buffer, not the visible canvas
      // directly. The glitch composite pass then draws buffer -> visible
      // canvas each frame, so every visualizer gets the same treatment.
      buffer: makeOffscreenCanvas(canvas.width, canvas.height),
      redLayer: makeOffscreenCanvas(canvas.width, canvas.height),
      blueLayer: makeOffscreenCanvas(canvas.width, canvas.height),
    };
    panel.bufferCtx = panel.buffer.getContext("2d");

    stemPanels[name] = panel;

    select.addEventListener("change", () => {
      const type = VISUALIZER_TYPES.find((t) => t.id === select.value);
      // A fresh create() call resets any particle/phase state for the new type
      stemPanels[name].visualizer = type.create();
    });
  });
}

// ---- Master transport (play/pause/seek across all 4 stems) ----
playPauseBtn.addEventListener("click", async () => {
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (isPlaying) {
    STEM_NAMES.forEach((name) => audioElements[name].pause());
    playPauseBtn.textContent = "Play";
  } else {
    STEM_NAMES.forEach((name) => audioElements[name].play());
    playPauseBtn.textContent = "Pause";
  }
  isPlaying = !isPlaying;
});

seekBar.addEventListener("input", () => {
  isSeeking = true;
  const duration = audioElements.vocals.duration || 0;
  const target = (seekBar.value / 100) * duration;
  STEM_NAMES.forEach((name) => {
    audioElements[name].currentTime = target;
  });
});

seekBar.addEventListener("change", () => {
  isSeeking = false;
});

audioElements.vocals.addEventListener("timeupdate", () => {
  const { currentTime, duration } = audioElements.vocals;

  if (!isSeeking && duration) {
    seekBar.value = (currentTime / duration) * 100;
  }
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(
    duration
  )}`;

  STEM_NAMES.forEach((name) => {
    if (name === "vocals") return;
    const drift = Math.abs(audioElements[name].currentTime - currentTime);
    if (drift > 0.05) {
      audioElements[name].currentTime = currentTime;
    }
  });
});

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

// ---- Master render loop: analyse -> chaos score -> draw -> glitch composite ----
function startVisualizerLoop() {
  function draw() {
    requestAnimationFrame(draw);

    STEM_NAMES.forEach((name) => {
      const analyser = analysers[name];
      const panel = stemPanels[name];

      analyser.getByteFrequencyData(panel.freqData);
      analyser.getByteTimeDomainData(panel.waveData);

      const { chaos, transient } = computeChaos(
        panel.freqData,
        panel.freqData.length,
        panel.chaosState
      );

      if (panel.chaosEl) {
        panel.chaosEl.textContent = Math.round(chaos * 100);
      }

      // Occasional frame-hold: skip redrawing the buffer so the last frame
      // freezes for a beat. Only kicks in once chaos is already high.
      const freeze = chaos > 0.75 && Math.random() < 0.12;
      if (!freeze) {
        panel.visualizer.draw({
          ctx: panel.bufferCtx,
          canvas: panel.buffer,
          freqData: panel.freqData,
          waveData: panel.waveData,
          bufferLength: panel.freqData.length,
          chaos,
          transient,
        });
      }

      compositeWithGlitch({
        ctx: panel.ctx,
        canvas: panel.canvas,
        buffer: panel.buffer,
        redLayer: panel.redLayer,
        blueLayer: panel.blueLayer,
        chaos,
        transient,
      });
    });
  }

  draw();
}
