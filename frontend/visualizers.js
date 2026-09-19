// Modular visualizer registry. Each entry has a create() factory that
// returns an object with a draw(frame) method. frame now includes `chaos`
// (0..1, how insane this stem is right now) and `transient` (0..1, a sharp
// spike just happened) — every visualizer below uses these to scale its
// own intensity, on top of whatever glitchfx.js layers on afterward.

const VISUALIZER_TYPES = [
  { id: "spectrum", label: "Spectrum", create: createSpectrumVisualizer },
  { id: "ascii", label: "ASCII Art", create: createAsciiVisualizer },
  { id: "aura", label: "Aura", create: createAuraVisualizer },
  { id: "ferro", label: "Ferro", create: createFerroVisualizer },
  { id: "flowfield", label: "Flow Field", create: createFlowFieldVisualizer },
  { id: "fractal", label: "Fractal", create: createFractalVisualizer },
];

// ---- Spectrum ----
// Thin lines only, never bars. Several independently-broken traces overlap,
// each with per-point jitter, random hard discontinuities, and randomly
// lifted pen strokes so the line reads as torn apart rather than one clean
// continuous curve.
function createSpectrumVisualizer() {
  return {
    draw({ ctx, canvas, freqData, bufferLength, chaos }) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      const traceCount = 3 + Math.floor(chaos * 3);

      for (let t = 0; t < traceCount; t++) {
        const hue = (t * 70 + chaos * 200 + Math.random() * 20) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${0.5 + Math.random() * 0.5})`;
        ctx.lineWidth = 1 + Math.random();

        ctx.beginPath();
        let penDown = false;

        for (let i = 0; i < bufferLength; i++) {
          const amp = freqData[i] / 255;
          const x = (i / bufferLength) * w;

          let y = midY - amp * h * 0.45;

          // Instability: per-point jitter, always present, worse with chaos
          y += (Math.random() - 0.5) * (6 + chaos * 40);

          // Occasional hard discontinuity — a point that snaps away from
          // its neighbors instead of following the signal
          if (Math.random() < 0.04 + chaos * 0.08) {
            y = Math.random() * h;
          }

          // Fragmentation: randomly lift the pen so the trace breaks into
          // disconnected segments rather than running edge to edge
          const shouldBreak = Math.random() < 0.05 + chaos * 0.1;

          if (shouldBreak || !penDown) {
            ctx.moveTo(x, y);
            penDown = true;
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }

      // A handful of stray tear marks across the frame, so it never sits
      // still and clean even during a quiet passage
      const tearCount = 2 + Math.floor(chaos * 6);
      for (let i = 0; i < tearCount; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const len = 4 + Math.random() * 30;
        ctx.strokeStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.4})`;
        ctx.lineWidth = 0.5 + Math.random();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + (Math.random() - 0.5) * len,
          y + (Math.random() - 0.5) * len
        );
        ctx.stroke();
      }
    },
  };
}

// ---- ASCII Art ----
// Characters start corrupting into glitch symbols and cycling hue as
// chaos climbs, instead of a flat cyan gradient.
function createAsciiVisualizer() {
  const chars = " .:-=+*#%@";
  const glitchChars = "@#%&$?!<>/\\|~^";
  const cols = 48;
  const rows = 18;

  return {
    draw({ ctx, canvas, freqData, bufferLength, chaos }) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cellW = canvas.width / cols;
      const cellH = canvas.height / rows;
      ctx.font = `${cellH}px monospace`;
      ctx.textBaseline = "top";

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const freqIndex = Math.floor((x / cols) * bufferLength);
          const rowFactor = 1 - y / rows;
          const jitter = Math.random() * (0.15 + chaos * 0.5);
          const amplitude = Math.min(
            1,
            (freqData[freqIndex] / 255) * rowFactor + jitter
          );

          let ch;
          if (Math.random() < chaos * 0.15) {
            ch = glitchChars[Math.floor(Math.random() * glitchChars.length)];
          } else {
            const charIndex = Math.floor(amplitude * (chars.length - 1));
            ch = chars[charIndex];
          }

          if (ch !== " ") {
            const hue = 180 + chaos * 180;
            ctx.fillStyle = `hsl(${hue}, 100%, ${60 + Math.random() * 20 * chaos}%)`;
            ctx.fillText(ch, x * cellW, y * cellH);
          }
        }
      }
    },
  };
}

// ---- Aura ----
// More particles, wider swings, hue cycling, and a camera-shake kick in
// once chaos passes 0.5.
function createAuraVisualizer() {
  const particleCount = 300;
  const particles = Array.from({ length: particleCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: Math.random() * 100,
    speed: 0.2 + Math.random() * 0.5,
    hueOffset: Math.random() * 360,
  }));

  return {
    draw({ ctx, canvas, freqData, bufferLength, chaos }) {
      ctx.save();

      if (chaos > 0.5) {
        const shake = (chaos - 0.5) * 20;
        ctx.translate(
          (Math.random() - 0.5) * shake,
          (Math.random() - 0.5) * shake
        );
      }

      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += freqData[i];
      const avg = sum / bufferLength / 255;

      particles.forEach((p) => {
        p.angle += p.speed * (0.01 + chaos * 0.04);
        const r = p.radius * (0.5 + avg * (1.5 + chaos * 3));
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r;

        const hue = (p.hueOffset + chaos * 300) % 360;
        ctx.fillStyle = `hsla(${hue}, 90%, 70%, ${0.3 + avg * 0.7})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + avg * 2 + chaos * 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    },
  };
}

// ---- Ferro ----
// More layers, faster drift, and bigger spikes as chaos rises. Still a
// canvas-2D approximation of the tangled-fiber look, not true metaballs.
function createFerroVisualizer() {
  let t = 0;

  return {
    draw({ ctx, canvas, waveData, bufferLength, chaos }) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.15;

      t += 0.02 + chaos * 0.08;

      const layers = 6 + Math.floor(chaos * 10);
      for (let layer = 0; layer < layers; layer++) {
        ctx.beginPath();
        for (let i = 0; i <= bufferLength; i++) {
          const idx = i % bufferLength;
          const amp = (waveData[idx] - 128) / 128;
          const angle = (i / bufferLength) * Math.PI * 2;
          const noise =
            Math.sin(angle * (6 + chaos * 10) + t + layer) *
            (0.3 + chaos * 0.4);
          const r =
            baseRadius +
            amp * baseRadius * (1.5 + chaos * 2) +
            noise * baseRadius * 0.5 +
            layer * 6;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const hue = 200 + chaos * 160 + layer * 4;
        ctx.strokeStyle = `hsla(${hue}, 80%, 80%, ${0.15 + layer * 0.03})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
  };
}

// ---- Flow Field ----
// More particles, faster field distortion, multi-hue trails instead of a
// flat red.
function createFlowFieldVisualizer() {
  const particleCount = 250;
  let particles = null;
  let t = 0;

  function resetParticle(canvas) {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      life: Math.random() * 100,
      hueOffset: Math.random() * 60,
    };
  }

  return {
    draw({ ctx, canvas, freqData, bufferLength, chaos }) {
      if (!particles) {
        particles = Array.from({ length: particleCount }, () =>
          resetParticle(canvas)
        );
      }

      ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + chaos * 0.05})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += freqData[i];
      const energy = sum / bufferLength / 255;

      t += 0.01 + chaos * 0.05;

      particles.forEach((p) => {
        const angle =
          Math.sin(p.x * (0.01 + chaos * 0.02) + t) *
          Math.cos(p.y * (0.01 + chaos * 0.02) - t) *
          Math.PI *
          2;
        const speed = 1 + energy * (6 + chaos * 10);
        p.x += Math.cos(angle) * speed;
        p.y += Math.sin(angle) * speed;
        p.life -= 1;

        const hue = (p.hueOffset + chaos * 280) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${0.5 + energy * 0.5})`;
        ctx.fillRect(p.x, p.y, 2 + chaos * 2, 2 + chaos * 2);

        if (
          p.life <= 0 ||
          p.x < 0 ||
          p.x > canvas.width ||
          p.y < 0 ||
          p.y > canvas.height
        ) {
          Object.assign(p, resetParticle(canvas));
        }
      });
    },
  };
}

// ---- Fractal ----
// Deeper recursion, hue-shifted branches, and an occasional third branch
// spawning at high chaos. Depth cap is generous but the length floor
// (len < 3) is what actually bounds branch count in practice.
function createFractalVisualizer() {
  return {
    draw({ ctx, canvas, freqData, bufferLength, chaos }) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += freqData[i];
      const energy = sum / bufferLength / 255;

      const maxDepth = 3 + Math.floor(energy * 4) + Math.floor(chaos * 2);

      function branch(x, y, len, angle, depth) {
        if (depth === 0 || len < 3) return;

        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;

        const hue = 140 + chaos * 180 + depth * 8;
        ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.3 + depth * 0.08})`;
        ctx.lineWidth = Math.max(1, depth * 0.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const spread = 0.3 + energy * 0.6 + chaos * 0.5;
        const freqIndex = Math.floor((depth / maxDepth) * bufferLength);
        const wiggle = (freqData[freqIndex] / 255) * (0.5 + chaos);

        branch(x2, y2, len * 0.7, angle - spread - wiggle, depth - 1);
        branch(x2, y2, len * 0.7, angle + spread + wiggle, depth - 1);

        if (chaos > 0.6 && Math.random() < 0.3) {
          branch(x2, y2, len * 0.5, angle + (Math.random() - 0.5) * 2, depth - 1);
        }
      }

      branch(
        canvas.width / 2,
        canvas.height,
        canvas.height * 0.25,
        -Math.PI / 2,
        maxDepth
      );
    },
  };
}