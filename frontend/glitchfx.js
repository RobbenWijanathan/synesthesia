// Shared glitch post-processing, applied on top of whatever a visualizer
// draws to its offscreen buffer. Kept separate from visualizers.js so every
// visualizer gets the same treatment without six copies of the same
// canvas-hack code.
//
// Deliberately built from drawImage/fillRect calls only — no getImageData/
// putImageData per-pixel loops — so this can run every frame, on 4 canvases
// at once, without dropping frame rate.

// ---- Chaos score: how "insane" this stem is right now, 0..1 ----
// Combines raw energy with a transient (a sudden jump above a short rolling
// average), so both a sustained loud stem and one sharp hit register — the
// hit registers harder. `state` is a small per-stem object the caller keeps
// around between frames (just `{ smoothed: number }`).
function computeChaos(freqData, bufferLength, state) {
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) sum += freqData[i];
  const energy = sum / bufferLength / 255;

  state.smoothed =
    state.smoothed === undefined
      ? energy
      : state.smoothed * 0.85 + energy * 0.15;
  const transient = Math.max(0, energy - state.smoothed);

  const raw = energy * 0.6 + transient * 4;
  const chaos = Math.min(1, raw);

  return { energy, transient, chaos };
}

// ---- Composite pass: buffer -> visible canvas, glitch scaled by chaos ----
function compositeWithGlitch({
  ctx,
  canvas,
  buffer,
  redLayer,
  blueLayer,
  chaos,
  transient,
}) {
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(buffer, 0, 0);

  // Chromatic aberration: tint two copies of the buffer red/blue, screen-
  // blend them back on top shifted opposite directions. No per-pixel loop —
  // the tint itself is a "multiply" fillRect over a drawImage copy.
  const offset = Math.round(chaos * 10);
  if (offset > 0) {
    tintLayer(redLayer, buffer, "#ff0033");
    tintLayer(blueLayer, buffer, "#00e5ff");

    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.85;
    ctx.drawImage(redLayer, -offset, 0);
    ctx.drawImage(blueLayer, offset, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Block displacement: copy small strips of the canvas onto itself at a
  // horizontal offset — a cheap stand-in for datamosh block corruption.
  if (chaos > 0.35) {
    const blockCount = Math.floor(chaos * 6);
    for (let i = 0; i < blockCount; i++) {
      const sx = Math.random() * canvas.width;
      const sy = Math.random() * canvas.height;
      const sw = 10 + Math.random() * canvas.width * 0.35;
      const sh = 3 + Math.random() * 14;
      const dx = sx + (Math.random() - 0.5) * canvas.width * 0.4;
      ctx.drawImage(canvas, sx, sy, sw, sh, dx, sy, sw, sh);
    }
  }

  // Row-shift: a cheap stand-in for pixel sorting. Copies whole 1px-tall
  // rows sideways instead of sorting pixel runs (a true sort needs a
  // per-pixel loop; this gets the streaking look without the cost).
  if (chaos > 0.5) {
    const rowCount = Math.floor(chaos * 12);
    for (let i = 0; i < rowCount; i++) {
      const y = Math.floor(Math.random() * canvas.height);
      const shift = (Math.random() - 0.5) * canvas.width * 0.5 * chaos;
      ctx.drawImage(canvas, 0, y, canvas.width, 1, shift, y, canvas.width, 1);
    }
  }

  // Scanline noise
  if (chaos > 0.2) {
    for (let y = 0; y < canvas.height; y += 4) {
      if (Math.random() < chaos * 0.35) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.2 * chaos})`;
        ctx.fillRect(0, y, canvas.width, 2);
      }
    }
  }

  // Transient strobe: a one-frame color-invert flash on a sharp hit
  if (transient > 0.22) {
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
}

function tintLayer(layerCanvas, source, color) {
  const lctx = layerCanvas.getContext("2d");
  lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  lctx.drawImage(source, 0, 0);
  lctx.globalCompositeOperation = "multiply";
  lctx.fillStyle = color;
  lctx.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
  lctx.globalCompositeOperation = "source-over";
}
