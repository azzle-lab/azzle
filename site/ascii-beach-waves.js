(function () {
  if (window.matchMedia("(max-width: 700px), (pointer: coarse)").matches) return;
  if (document.getElementById("ascii-wave-bg")) return;

  const canvas = document.createElement("canvas");
  canvas.id = "ascii-wave-bg";
  canvas.className = "ascii-wave-bg";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    zIndex: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    opacity: "0.18",
  });
  document.body.prepend(canvas);

  const MYTH = "you can't stop this wave.";
  let mythEl = null;
  if (document.body.classList.contains("page-home")) {
    mythEl = document.createElement("p");
    mythEl.className = "wave-myth";
    mythEl.textContent = MYTH;
    document.body.appendChild(mythEl);
  }

  const ctx = canvas.getContext("2d");
  const CHAR_W = 6.75;
  const CHAR_H = 11.25;
  const CHARGE_MAX_MS = 10000;
  const IMPULSE_LIFE = 8.8;
  const MIN_HOLD_MS = 120;
  const TWO_PI = Math.PI * 2;
  const SCHUMANN_HZ = 7.83;
  const SHORE_OMEGA = TWO_PI * (SCHUMANN_HZ / 100);
  const THROW_OMEGA = TWO_PI * (SCHUMANN_HZ / 10);
  let cols;
  let rows;
  let width;
  let height;
  let coastCurve = [];
  let sandNoise = [];
  let time = 0;
  let lastNow = performance.now();
  let pointerX = -1000;
  let pointerY = -1000;
  let charging = false;
  let chargeStart = 0;
  let chargePointerId = null;
  let chargeX = -1000;
  let chargeY = -1000;
  const impulses = [];
  const word = "AZZLE";

  const DEEP = [6, 26, 46];
  const MID = [15, 66, 92];
  const SHALLOW = [46, 134, 171];
  const FOAM_LO = [150, 210, 220];
  const FOAM_HI = [255, 255, 255];
  const WET = [120, 96, 66];
  const DRY = [222, 199, 150];
  const waterChars = [" ", ".", "'", "`", "-", ":", "~", "="];
  const foamChars = [".", ":", "*", "o", "x", "O", "#", "@"];
  const sandChars = [" ", " ", ".", "`", "'", ","];

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(first, second, amount) {
    return first + (second - first) * amount;
  }

  function hash(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function color(first, second, amount) {
    amount = clamp(amount, 0, 1);
    return `rgb(${Math.round(lerp(first[0], second[0], amount))},${Math.round(lerp(first[1], second[1], amount))},${Math.round(lerp(first[2], second[2], amount))})`;
  }

  function buildStatic() {
    coastCurve = new Array(cols);
    for (let column = 0; column < cols; column += 1) {
      const x = column / cols;
      coastCurve[column] = 0.07 * Math.sin(x * 3.1 + 0.4)
        + 0.035 * Math.sin(x * 6.7 + 2.1)
        + 0.02 * Math.sin(x * 13.3 + 4);
    }

    sandNoise = new Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        sandNoise[row * cols + column] = hash(column, row);
      }
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    cols = Math.ceil(width / CHAR_W) + 1;
    rows = Math.ceil(height / CHAR_H) + 1;
    ctx.font = `${CHAR_H - 2}px monospace`;
    ctx.textBaseline = "top";
    buildStatic();
  }

  function isLightTheme() {
    return document.documentElement.dataset.theme === "light";
  }

  function isHomepage() {
    return document.body.classList.contains("page-home");
  }

  function charge01() {
    if (!charging) return 0;
    return clamp((performance.now() - chargeStart) / CHARGE_MAX_MS, 0, 1);
  }

  function ballPixel() {
    if (charging) return { x: chargeX, y: chargeY };
    return { x: pointerX, y: pointerY };
  }

  function isInteractiveTarget(event) {
    const el = event.target;
    if (!(el instanceof Element)) return false;
    return Boolean(el.closest("a, button, input, textarea, select, label, summary, option, [role='button'], [contenteditable='true'], .azzle-nav, .home-quicknav, [data-rd-wallet-mount]"));
  }

  function sampleField(xN, yN, charge, originX, originY) {
    let field = 0;
    const hasOrigin = originX > -100 && originY > -100;
    if (charge > 0.002 && hasOrigin) {
      const dx = xN - originX;
      const dy = yN - originY;
      const dist = Math.hypot(dx, dy);
      const radius = 0.018 + charge * 0.09;
      const gather = Math.exp(-(dist * dist) / (radius * radius * 1.8));
      field += charge * gather * Math.sin(THROW_OMEGA * time - dist * 46) * (0.16 + charge * 0.55);
    }

    for (let i = 0; i < impulses.length; i += 1) {
      const impulse = impulses[i];
      const age = time - impulse.t0;
      if (age < 0 || age > IMPULSE_LIFE) continue;
      const dx = xN - impulse.x;
      const dy = yN - impulse.y;
      const dist = Math.hypot(dx, dy) + 1e-5;
      const strength = impulse.strength;
      const decay = Math.exp(-age * 0.22) * (1 - age / IMPULSE_LIFE);
      const ringR = age * (0.11 + strength * 0.045);
      const ring = Math.exp(-((dist - ringR) * (dist - ringR)) / (0.0016 + strength * 0.0024));
      const circ = Math.sin(dist * 56 - age * THROW_OMEGA) + 0.42 * Math.sin(dist * 31 - age * THROW_OMEGA * 2);
      const packetY = yN - (impulse.y - age * (0.118 + strength * 0.04));
      const packetX = dx / (0.085 + strength * 0.09);
      const packet = Math.exp(-(packetY * packetY) / (0.0032 + strength * 0.0048) - packetX * packetX);
      const counter = Math.sin(yN * 52 + age * THROW_OMEGA + impulse.x * 8);
      const downY = yN - (impulse.y + age * 0.07);
      const down = Math.exp(-(downY * downY) / 0.006 - (dx * dx) / 0.018);
      const withBeach = Math.sin(yN * 50 - age * THROW_OMEGA);
      field += strength * decay * (0.62 * ring * circ + 1.05 * packet * counter + 0.28 * down * withBeach);
    }
    return field;
  }

  function pruneImpulses() {
    let write = 0;
    for (let i = 0; i < impulses.length; i += 1) {
      if (time - impulses[i].t0 <= IMPULSE_LIFE) {
        impulses[write] = impulses[i];
        write += 1;
      }
    }
    impulses.length = write;
  }

  function fireImpulse() {
    const heldMs = performance.now() - chargeStart;
    const held = clamp(heldMs / CHARGE_MAX_MS, 0, 1);
    charging = false;
    chargePointerId = null;
    if (heldMs < MIN_HOLD_MS || chargeX < 0 || width < 1 || height < 1) return;
    impulses.push({
      x: chargeX / width,
      y: chargeY / height,
      t0: time,
      strength: 0.22 + 0.78 * Math.pow(held, 0.82),
    });
    if (impulses.length > 6) impulses.shift();
    if (mythEl) {
      mythEl.classList.remove("is-thrown");
      void mythEl.offsetWidth;
      mythEl.classList.add("is-thrown");
    }
  }

  function updatePointer(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function startCharge(event) {
    if (event.button != null && event.button !== 0) return;
    if (isInteractiveTarget(event)) return;
    charging = true;
    chargeStart = performance.now();
    chargePointerId = event.pointerId;
    chargeX = event.clientX;
    chargeY = event.clientY;
    pointerX = chargeX;
    pointerY = chargeY;
  }

  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("pointerleave", () => {
    if (charging) return;
    pointerX = -1000;
    pointerY = -1000;
  });
  window.addEventListener("pointerdown", startCharge);
  window.addEventListener("pointerup", (event) => {
    if (!charging) return;
    if (chargePointerId != null && event.pointerId !== chargePointerId) return;
    fireImpulse();
  });
  window.addEventListener("pointercancel", () => {
    if (charging) fireImpulse();
  });

  function frame() {
    const now = performance.now();
    time += Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;
    pruneImpulses();
    const light = isLightTheme();
    const homepage = isHomepage();
    const charge = charge01();
    const surge = 0.045 * Math.sin(time * 0.55);
    const waveEnvelope = 0.5 + 0.5 * Math.sin(time * 0.32 - 0.6);
    const foamWidth = 0.014 + 0.02 * waveEnvelope;
    const origin = ballPixel();
    const originX = origin.x > 0 ? origin.x / width : -1;
    const originY = origin.y > 0 ? origin.y / height : -1;
    const revealRadius = (homepage ? 112 : 82) * (1 + charge * 0.12);
    const innerRadius = revealRadius * 0.72;
    const ringInner = innerRadius + 2;
    const ringOuter = ringInner + CHAR_H;
    const chargeAngle = charge * TWO_PI;

    canvas.style.opacity = homepage ? (impulses.length || charge > 0 ? "0.42" : "0.3") : light ? "0.08" : "0.18";
    if (homepage) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = light ? "#eef7f4" : "#04121c";
      ctx.fillRect(0, 0, width, height);
    }
    const windowGradient = homepage
      ? (() => {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        if (light) {
          gradient.addColorStop(0, "rgba(190, 255, 0, .82)");
          gradient.addColorStop(.42, "rgba(52, 211, 153, .74)");
          gradient.addColorStop(.72, "rgba(59, 130, 246, .7)");
          gradient.addColorStop(1, "rgba(217, 70, 239, .62)");
        } else {
          gradient.addColorStop(0, "rgba(220, 255, 40, .95)");
          gradient.addColorStop(.42, "rgba(45, 212, 191, .9)");
          gradient.addColorStop(.72, "rgba(59, 130, 246, .86)");
          gradient.addColorStop(1, "rgba(232, 121, 249, .8)");
        }
        return gradient;
      })()
      : null;

    for (let row = 0; row < rows; row += 1) {
      const y = row / rows;
      const pixelY = row * CHAR_H;

      for (let column = 0; column < cols; column += 1) {
        const x = column / cols;
        const field = sampleField(x, y, charge, originX, originY);
        const ripple = 0.03 * Math.sin(x * 9 - SHORE_OMEGA * time)
          + 0.016 * Math.sin(x * 19 + SHORE_OMEGA * time + 1.2);
        const shoreY = 0.5 + coastCurve[column] + surge + ripple + field * 0.24;
        const edgeNoise = 0.012 * Math.sin(x * 46 + time * 3.4)
          + 0.007 * Math.sin(x * 91 - time * 5.7 + row * 0.3);
        const distance = (y - shoreY) - edgeNoise;
        const foamBack = foamWidth * 2;
        const crest = Math.abs(field);
        const interferenceFoam = distance < 0 && crest > 0.15;
        let character;
        let fill;

        if (interferenceFoam || (distance > -foamWidth * 0.4 && distance < foamBack)) {
          const center = foamWidth * 0.15;
          let intensity = 1 - clamp(Math.abs(distance - center) / (foamWidth + foamBack * 0.5), 0, 1);
          intensity = Math.max(intensity, clamp((crest - 0.12) / 0.55, 0, 1));
          const beat = 0.5 + 0.5 * Math.sin(field * 9.5 + SHORE_OMEGA * time);
          intensity *= 0.62 + 0.38 * Math.sin(x * 55 + SHORE_OMEGA * time + row * 0.9);
          intensity = clamp(intensity * (0.72 + 0.28 * beat), 0, 1);
          const sparkle = hash(column + Math.floor(time * 6), row) > 0.93 ? 1 : 0;
          const index = clamp(Math.floor(intensity * (foamChars.length - 1)) + sparkle, 0, foamChars.length - 1);
          character = foamChars[index];
          fill = color(
            light ? [180, 225, 220] : FOAM_LO,
            light ? [255, 255, 255] : FOAM_HI,
            intensity,
          );
        } else if (distance <= -foamWidth * 0.4) {
          const depth = clamp(-distance, 0, 0.5) / 0.5;
          const incoming = Math.sin(distance * 55 - SHORE_OMEGA * time + x * 6);
          const opposed = Math.sin(distance * 55 + THROW_OMEGA * time + field * 14);
          const flow = incoming + field * 1.35 + opposed * clamp(crest * 1.1, 0, 0.85);
          const index = flow > 0.55 ? 6 : flow > 0.15 ? 4 : flow > -0.3 ? 1 : 0;
          character = waterChars[index];
          const colorT = clamp(depth - field * 0.12, 0, 1);
          fill = colorT > 0.55
            ? color(light ? [45, 108, 128] : MID, light ? [20, 62, 84] : DEEP, (colorT - 0.55) / 0.45)
            : color(light ? [125, 198, 207] : SHALLOW, light ? [75, 155, 178] : MID, colorT / 0.55);
        } else {
          const wetness = clamp(distance - foamBack, 0, 0.25) / 0.25;
          const noise = sandNoise[row * cols + column];
          const index = noise > 0.93 ? 3 : noise > 0.8 ? 4 : noise > 0.55 ? 2 : 0;
          character = sandChars[index];
          fill = color(light ? [175, 145, 104] : WET, light ? [244, 220, 168] : DRY, wetness);
        }

        const pixelX = column * CHAR_W;
        const pixelCenterY = pixelY + CHAR_H * 0.5;
        const dx = pixelX - origin.x;
        const dy = pixelCenterY - origin.y;
        const pointerDistance = Math.hypot(dx, dy);
        let pointerReveal = false;
        if (pointerDistance < ringOuter) {
          let tau = Math.atan2(dx, -dy);
          if (tau < 0) tau += TWO_PI;
          const onRing = pointerDistance >= ringInner;
          const inCore = pointerDistance < innerRadius;
          if (inCore || onRing) {
            pointerReveal = true;
            if (onRing) {
              const letterIndex = Math.floor((tau / TWO_PI) * 36) % word.length;
              character = word[letterIndex];
              const lit = charge > 0.001 && tau <= chargeAngle + 0.06;
              const head = lit && Math.abs(tau - chargeAngle) < 0.18;
              const glow = lit
                ? (light ? 0.55 : 0.62) + charge * 0.38 + (head ? 0.18 : 0)
                : (light ? 0.18 : 0.2) + charge * 0.08;
              fill = light
                ? `rgba(28, 62, 58, ${glow})`
                : `rgba(230, 255, 74, ${glow})`;
            } else {
              const wordIndex = Math.floor((column + Math.floor(time * 2)) / 2) % word.length;
              character = word[wordIndex];
              const reveal = 1 - pointerDistance / innerRadius;
              fill = light
                ? `rgba(28, 62, 58, ${0.28 + reveal * 0.5 + charge * 0.22})`
                : `rgba(230, 255, 74, ${0.3 + reveal * 0.55 + charge * 0.22})`;
            }
          }
        }

        ctx.fillStyle = homepage && character.trim() && !pointerReveal ? windowGradient : fill;
        ctx.fillText(character, pixelX, pixelY);
      }
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
})();
