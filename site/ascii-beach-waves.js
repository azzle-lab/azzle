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

  const ctx = canvas.getContext("2d");
  const CHAR_W = 9;
  const CHAR_H = 15;
  let cols;
  let rows;
  let width;
  let height;
  let coastCurve = [];
  let sandNoise = [];
  let time = 0;
  let pointerX = -1000;
  let pointerY = -1000;
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

  function updatePointer(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function frame() {
    time += 0.016;
    const light = isLightTheme();
    const homepage = isHomepage();
    const surge = 0.045 * Math.sin(time * 0.55);
    const waveEnvelope = 0.5 + 0.5 * Math.sin(time * 0.32 - 0.6);
    const foamWidth = 0.014 + 0.02 * waveEnvelope;

    canvas.style.opacity = homepage ? "0.3" : light ? "0.08" : "0.18";
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
        const ripple = 0.03 * Math.sin(x * 9 - time * 1.4)
          + 0.016 * Math.sin(x * 19 + time * 2.1 + 1.2);
        const shoreY = 0.5 + coastCurve[column] + surge + ripple;
        const edgeNoise = 0.012 * Math.sin(x * 46 + time * 3.4)
          + 0.007 * Math.sin(x * 91 - time * 5.7 + row * 0.3);
        const distance = (y - shoreY) - edgeNoise;
        const foamBack = foamWidth * 2;
        let character;
        let fill;

        if (distance > -foamWidth * 0.4 && distance < foamBack) {
          const center = foamWidth * 0.15;
          let intensity = 1 - clamp(Math.abs(distance - center) / (foamWidth + foamBack * 0.5), 0, 1);
          intensity *= 0.65 + 0.35 * Math.sin(x * 55 + time * 4.2 + row * 0.9);
          intensity = clamp(intensity, 0, 1);
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
          const flow = Math.sin(distance * 55 - time * 2.6 + x * 6);
          const index = flow > 0.55 ? 6 : flow > 0.15 ? 4 : flow > -0.3 ? 1 : 0;
          character = waterChars[index];
          fill = depth > 0.55
            ? color(light ? [45, 108, 128] : MID, light ? [20, 62, 84] : DEEP, (depth - 0.55) / 0.45)
            : color(light ? [125, 198, 207] : SHALLOW, light ? [75, 155, 178] : MID, depth / 0.55);
        } else {
          const wetness = clamp(distance - foamBack, 0, 0.25) / 0.25;
          const noise = sandNoise[row * cols + column];
          const index = noise > 0.93 ? 3 : noise > 0.8 ? 4 : noise > 0.55 ? 2 : 0;
          character = sandChars[index];
          fill = color(light ? [175, 145, 104] : WET, light ? [244, 220, 168] : DRY, wetness);
        }

        const pixelX = column * CHAR_W;
        const pixelCenterY = pixelY + CHAR_H * 0.5;
        const pointerDistance = Math.hypot(pixelX - pointerX, pixelCenterY - pointerY);
        const revealRadius = homepage ? 150 : 110;
        let pointerReveal = false;
        if (pointerDistance < revealRadius) {
          const reveal = 1 - pointerDistance / revealRadius;
          const wordIndex = Math.floor((column + Math.floor(time * 2)) / 2) % word.length;
          character = word[wordIndex];
          pointerReveal = true;
          fill = light
            ? `rgba(28, 62, 58, ${0.32 + reveal * 0.58})`
            : `rgba(230, 255, 74, ${0.34 + reveal * 0.66})`;
        }

        ctx.fillStyle = homepage && character.trim() && !pointerReveal ? windowGradient : fill;
        ctx.fillText(character, pixelX, pixelY);
      }
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("pointerleave", () => {
    pointerX = -1000;
    pointerY = -1000;
  });
  resize();
  requestAnimationFrame(frame);
})();
