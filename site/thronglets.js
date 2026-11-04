(() => {
  const canvas = document.getElementById("tg-canvas");
  const tank = document.getElementById("tank");
  const whisper = document.getElementById("tg-whisper");
  const howmany = document.getElementById("tg-howmany");
  const gate = document.getElementById("tg-gate");
  const pick = document.getElementById("tg-pick");
  const unlockBtn = document.getElementById("tg-unlock");
  const seamHint = document.getElementById("tg-seam-hint");
  const drawer = document.getElementById("tg-drawer");
  const boardEl = document.getElementById("tg-board");
  const statsEl = document.getElementById("tg-stats");
  const ranksEl = document.getElementById("tg-ranks");
  const feedBtn = document.getElementById("tg-feed");
  const heyBtn = document.getElementById("tg-attention");
  const washBtn = document.getElementById("tg-wash");
  const fireBtn = document.getElementById("tg-fire");
  const stoneBtn = document.getElementById("tg-stone");
  const ctx = canvas.getContext("2d");

  const calm = new Image();
  const scream = new Image();
  const glasses = new Image();
  const mark = new Image();
  calm.src = "/smolthrong.png";
  scream.src = "/smolthrongscreams.png";
  glasses.src = "/noggles.png";
  mark.src = "/azzlewordmark.png";

  const GRID = 64;
  const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const UNLOCK_AT = 100;
  const TILE_CAP = 140;
  const EVO_MAX = 3;
  const EVO_NAMES = ["pip", "throng", "elder", "lord"];
  const WORDS = ["gloob", "neth", "veth", "pip", "we we", "feed", "hey", "throng"];
  const ACTIONS = ["feed", "hey", "poke", "wash", "unlock", "fire", "stone"];
  const herd = [];
  const crumbs = [];
  const fires = [];
  const rocks = [];
  const bubbles = [];
  const bits = [];
  const tileIndex = new Map();
  const lotIndex = new Map();
  let w = 1, h = 1, nowMs = 0;
  let origin = location.origin;
  let selected = null;
  let serverLots = 0;
  let seenPulse = 0;
  let nextLocal = 1;
  let yours = null;
  let focus = { col: 32, row: 32 };
  let tool = "";
  let me = "";
  let worldLots = [];
  let payToAddr = "";
  let azlAddr = "";
  let joinWei = "";
  let nogglesWei = `1000000${"0".repeat(18)}`;
  let actionWei = `1${"0".repeat(18)}`;
  let unlockWei = `25000${"0".repeat(18)}`;
  let paying = false;
  let placeAt = null;
  let worldStats = null;
  let worldBoard = [];
  let usdcAddr = "";
  let worldAds = new Map();
  let adSale = null;
  let adQuote = null;
  let adPick = { col: 32, row: 32 };
  let adBusy = false;
  const names = new Map();
  const toolBtns = { feed: feedBtn, hey: heyBtn, wash: washBtn, fire: fireBtn, stone: stoneBtn };
  const hand = { x: 0, y: 0, on: false };
  const signName = document.getElementById("tg-sign-name");
  const buyBtn = document.getElementById("tg-buy");
  const buyLotBtn = document.getElementById("tg-buy-lot");
  const nogglesBtn = document.getElementById("tg-noggles");
  const bridgeBtn = document.getElementById("tg-bridge");
  const adBuyBtn = document.getElementById("tg-ad-buy");
  const adLink = document.getElementById("tg-ad-link");
  const adModal = document.getElementById("tg-ad-modal");
  const adForm = document.getElementById("tg-ad-form");
  const adMap = document.getElementById("tg-ad-map");
  const adStatus = document.getElementById("tg-ad-status");

  const AD_CENTER = (GRID - 1) / 2;
  const AD_MAX_DIST = Math.hypot(AD_CENTER, AD_CENTER);
  const AD_TARGET = 18000;
  const AD_POWER = 2;
  let adCents = null;

  function buildAdCents() {
    const weights = new Array(GRID * GRID);
    let sumW = 0;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const d = Math.hypot(col - AD_CENTER, row - AD_CENTER);
        const w = Math.pow(AD_MAX_DIST - d + 0.35, AD_POWER);
        weights[row * GRID + col] = w;
        sumW += w;
      }
    }
    const cents = weights.map((w) => Math.max(1, Math.round((AD_TARGET * w * 100) / sumW)));
    let sumC = cents.reduce((a, b) => a + b, 0);
    const mid = Math.floor(cents.length / 2);
    cents[mid] += AD_TARGET * 100 - sumC;
    if (cents[mid] < 1) cents[mid] = 1;
    return cents;
  }

  function adPriceLocal(col, row) {
    if (!adCents) adCents = buildAdCents();
    return adCents[row * GRID + col] / 100;
  }

  function adOnTile(col, row) {
    return worldAds.get(tileKey(col, row)) || null;
  }

  function fmtUsd(n) {
    return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function deriveAdSale(server) {
    let raised = 0;
    for (const ad of worldAds.values()) {
      const p = Number(ad.priceUsdc);
      raised += Number.isFinite(p) ? p : adPriceLocal(ad.col, ad.row);
    }
    raised = Math.round(raised * 100) / 100;
    const sold = worldAds.size;
    const target = Number(server?.targetUsdc) || AD_TARGET;
    const serverRaised = Number(server?.raisedUsdc) || 0;
    const serverSold = Number(server?.sold) || 0;
    return {
      ...(server || {}),
      targetUsdc: target,
      raisedUsdc: Math.max(serverRaised, raised),
      sold: Math.max(serverSold, sold),
      remainingUsdc: Math.round((target - Math.max(serverRaised, raised)) * 100) / 100,
    };
  }

  function tileKey(col, row) {
    return `${col},${row}`;
  }

  function bootAudio() {}
  function sfx() {}

  function say() {
    return WORDS[(Math.random() * WORDS.length) | 0];
  }

  function tileOf(col, row) {
    return tileIndex.get(tileKey(col, row)) || null;
  }

  function ensureTile(col, row) {
    const key = tileKey(col, row);
    let tile = tileIndex.get(key);
    if (!tile) {
      tile = { col, row, sold: false, edges: [], mine: false };
      tileIndex.set(key, tile);
    }
    return tile;
  }

  function seamOpen(col, row, edge) {
    const step = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[edge];
    if (!step) return false;
    const nc = col + step[0];
    const nr = row + step[1];
    if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) return false;
    const opp = { n: "s", s: "n", e: "w", w: "e" }[edge];
    return Boolean(tileOf(col, row)?.edges.includes(edge) || tileOf(nc, nr)?.edges.includes(opp));
  }

  function shortAddr(addr) {
    const a = String(addr || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(a)) return "";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function lotTitle(label) {
    return label ? `${label}'s LOT` : "UNCLAIMED LOT";
  }

  function lotOnTile(col, row) {
    return lotIndex.get(tileKey(col, row)) || null;
  }

  function lotFor(addr) {
    const key = String(addr || "").toLowerCase();
    if (!key) return null;
    return worldLots.find((lot) => String(lot.agent).toLowerCase() === key) || null;
  }

  function mineLot(lot) {
    return Boolean(me && lot && String(lot.agent).toLowerCase() === me);
  }

  function herdHasNoggles() {
    return worldLots.some((lot) => mineLot(lot) && lot.noggles) || herd.some((t) => !t.dying && t.noggles);
  }

  function edgeToward(from, to) {
    const dc = to.col - from.col;
    const dr = to.row - from.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return "";
    if (dc === 1) return "e";
    if (dc === -1) return "w";
    if (dr === 1) return "s";
    if (dr === -1) return "n";
    return "";
  }

  function ownedTouching(col, row) {
    return worldLots.find((lot) => mineLot(lot) && edgeToward(lot, { col, row })) || null;
  }

  function unlockAim() {
    const here = lotOnTile(focus.col, focus.row);
    if (mineLot(here)) return { col: here.col, row: here.row, edge: "" };
    const from = ownedTouching(focus.col, focus.row);
    if (from) return { col: focus.col, row: focus.row, edge: edgeToward(from, focus) };
    const home = lotFor(me);
    return { col: home?.col ?? focus.col, row: home?.row ?? focus.row, edge: "e" };
  }

  function canBridgeHere() {
    if (lotOnTile(focus.col, focus.row)) return false;
    const from = ownedTouching(focus.col, focus.row);
    if (!from) return false;
    const edge = edgeToward(from, focus);
    if ((from.edges || []).includes(edge)) return false;
    return true;
  }

  function paintSign() {
    if (!signName || !buyBtn) return;
    const lot = lotOnTile(focus.col, focus.row);
    const ad = adOnTile(focus.col, focus.row);
    if (nogglesBtn) nogglesBtn.hidden = !(mineLot(lot) && !herdHasNoggles());
    if (bridgeBtn) {
      bridgeBtn.hidden = !(canBridgeHere() && livingMine() >= UNLOCK_AT);
    }
    if (adBuyBtn) {
      if (ad) {
        adBuyBtn.hidden = true;
      } else {
        adBuyBtn.hidden = false;
        adBuyBtn.textContent = "Buy ad · " + fmtUsd(adPriceLocal(focus.col, focus.row)) + " USDC";
      }
    }
    if (adLink) {
      if (ad) {
        adLink.hidden = false;
        adLink.textContent = ad.project + (ad.tagline ? " · " + ad.tagline : "");
        adLink.href = ad.url || "#";
        if (!ad.url) adLink.removeAttribute("href");
      } else {
        adLink.hidden = true;
      }
    }
    if (lot) {
      const key = String(lot.agent).toLowerCase();
      const label = names.get(key) || shortAddr(lot.agent);
      signName.textContent = mineLot(lot) && lot.taken ? `${label}'s taken lot` : lotTitle(label);
      buyBtn.hidden = true;
      return;
    }
    buyBtn.hidden = false;
    buyBtn.textContent = "Buy this lot · 400000 AZL";
    signName.textContent = canBridgeHere() ? "NEIGHBOR LOT" : "UNCLAIMED LOT";
  }

  async function resolveLabel(addr) {
    const key = String(addr || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(key)) return "";
    if (names.has(key) && !names.get(key).startsWith("0x")) return names.get(key);
    if (!names.has(key)) names.set(key, shortAddr(key));
    paintSign();
    const apply = (name) => {
      const clean = String(name || "").trim();
      if (!clean || /^0x/i.test(clean)) return false;
      names.set(key, clean);
      paintSign();
      return true;
    };
    try {
      const res = await fetch(`https://api.ensideas.com/ens/resolve/${key}`);
      const body = await res.json().catch(() => ({}));
      if (apply(body.name || body.displayName)) return names.get(key);
    } catch { /* try next */ }
    try {
      const res = await fetch(`https://ensdata.net/${key}`);
      const body = await res.json().catch(() => ({}));
      if (apply(body.ens || body.name)) return names.get(key);
    } catch { /* keep short */ }
    return names.get(key);
  }

  function lookAt(col, row) {
    focus = { col, row };
    paintSign();
    paintMap();
    paintPad();
    recount();
  }

  function stepFocus(dir) {
    const step = DIRS[dir];
    if (!step) return;
    const col = focus.col + step[0];
    const row = focus.row + step[1];
    if (col < 0 || row < 0 || col >= GRID || row >= GRID) return;
    bootAudio();
    lookAt(col, row);
  }

  function paintPad() {
    document.querySelectorAll("#tg-pad [data-dir]").forEach((btn) => {
      const step = DIRS[btn.dataset.dir];
      if (!step) return;
      const col = focus.col + step[0];
      const row = focus.row + step[1];
      const off = col < 0 || row < 0 || col >= GRID || row >= GRID;
      btn.disabled = off;
      const lot = off ? null : lotOnTile(col, row);
      btn.classList.toggle("lot", Boolean(lot));
      btn.classList.toggle("taken", Boolean(lot?.taken));
      btn.classList.toggle("mine", Boolean(lot && me && String(lot.agent).toLowerCase() === me && !lot.taken));
    });
  }

  function paintMap() {
    const canvasMap = document.getElementById("tg-map-canvas");
    if (!canvasMap) return;
    const cell = 4;
    const size = GRID * cell;
    if (canvasMap.width !== size) {
      canvasMap.width = size;
      canvasMap.height = size;
    }
    const g = canvasMap.getContext("2d");
    g.fillStyle = "#16110c";
    g.fillRect(0, 0, size, size);
    g.fillStyle = "#1e1912";
    for (let i = 0; i < GRID; i += 8) {
      g.fillRect(i * cell, 0, 1, size);
      g.fillRect(0, i * cell, size, 1);
    }
    for (const lot of worldLots) {
      const mine = me && String(lot.agent).toLowerCase() === me;
      g.fillStyle = lot.taken ? "#3d7cff" : mine ? "#c8f169" : "#5a7a32";
      g.fillRect(lot.col * cell, lot.row * cell, cell - 1, cell - 1);
    }
    for (const ad of worldAds.values()) {
      g.fillStyle = "rgba(243,224,184,.85)";
      g.fillRect(ad.col * cell + 1, ad.row * cell + 1, Math.max(1, cell - 3), Math.max(1, cell - 3));
    }
    g.fillStyle = "#f4f1ea";
    g.fillRect(focus.col * cell - 1, focus.row * cell - 1, cell + 1, cell + 1);
    g.fillStyle = "#c8f169";
    g.fillRect(focus.col * cell, focus.row * cell, cell - 1, cell - 1);
  }

  function floorY() {
    return { back: h * 0.46, front: h * 0.9 };
  }

  function floorX(v) {
    return { left: w * (0.02 + (1 - v) * 0.03), right: w * (0.98 - (1 - v) * 0.03) };
  }

  function project(t) {
    const dc = (t.col ?? focus.col) - focus.col;
    const dr = (t.row ?? focus.row) - focus.row;
    if (dc === 0 && dr === 0) {
      const v = t.v;
      const span = floorX(v);
      return {
        x: span.left + t.u * (span.right - span.left),
        y: floorY().back + v * (floorY().front - floorY().back),
        s: 0.78 + v * 0.28,
        here: true,
      };
    }
    return {
      x: w * 0.5 + dc * w * 0.28 + (t.u - 0.5) * 28,
      y: h * 0.3 + dr * h * 0.07,
      s: 0.28,
      here: false,
    };
  }

  function spray(kind, t, n = 8) {
    const p = project(t);
    for (let i = 0; i < n; i++) {
      bits.push({
        kind,
        x: p.x + (Math.random() - 0.5) * 18,
        y: p.y - 20 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 40,
        life: 0.4 + Math.random() * 0.5,
      });
    }
  }

  function spawn(i, extra) {
    return {
      id: extra?.id || `h-${i + 1}`,
      name: extra?.name || WORDS[i % WORDS.length],
      noggles: Boolean(extra?.noggles),
      washed: Boolean(extra?.washed),
      agent: extra?.agent || "local",
      col: extra?.col ?? 32,
      row: extra?.row ?? 32,
      u: extra?.x ?? (0.2 + (i % 5) * 0.13 + Math.random() * 0.03),
      v: extra?.y ?? (0.2 + Math.floor(i / 5) * 0.15 + Math.random() * 0.03),
      tu: 0.5,
      tv: 0.5,
      face: Math.random() < 0.5 ? 1 : -1,
      phase: Math.random() * Math.PI * 2,
      breath: Math.random() * Math.PI * 2,
      speed: 0.14 + Math.random() * 0.1,
      screamUntil: 0,
      wetUntil: extra?.washed ? 1e12 : 0,
      talk: extra?.say || "",
      talkUntil: 0,
      retarget: 0,
      mate: extra?.mate || 0.08,
      age: extra?.age || 0,
      dying: 0,
      miss: 0,
      evo: Number(extra?.evo) || 0,
      pop: extra?.pop || 0,
    };
  }

  function evolveLocal(t) {
    if (!t || (t.evo || 0) >= EVO_MAX) return false;
    t.evo = (t.evo || 0) + 1;
    t.pop = 1;
    t.talk = EVO_NAMES[t.evo] || "evo";
    t.talkUntil = nowMs + 1400;
    spray("birth", t, 14);
    sfx("evo");
    whisper.textContent = t.talk;
    return true;
  }

  function aim(t, u, v) {
    t.tu = Math.min(0.98, Math.max(0.02, u));
    t.tv = Math.min(0.98, Math.max(0.02, v));
    t.retarget = 0.7 + Math.random() * 1.6;
  }

  function openEdges(col, row) {
    return ["e", "w", "n", "s"].filter((edge) => seamOpen(col, row, edge));
  }

  function onStage(t) {
    if (t.col === focus.col && t.row === focus.row) return true;
    const dc = t.col - focus.col;
    const dr = t.row - focus.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return false;
    if (dc === 1) return seamOpen(focus.col, focus.row, "e");
    if (dc === -1) return seamOpen(focus.col, focus.row, "w");
    if (dr === 1) return seamOpen(focus.col, focus.row, "s");
    return seamOpen(focus.col, focus.row, "n");
  }

  function livingMine() {
    const mineKeys = new Set(
      worldLots.filter((lot) => me && String(lot.agent).toLowerCase() === me).map((lot) => `${lot.col},${lot.row}`),
    );
    if (!mineKeys.size) {
      return herd.filter((t) => t.dying <= 0 && t.col === focus.col && t.row === focus.row).length;
    }
    return herd.filter((t) => t.dying <= 0 && mineKeys.has(`${t.col},${t.row}`)).length;
  }

  function applyPaid(kind, body, at) {
    if (kind === "feed") doFeed(at);
    if (kind === "hey") doHey(at);
    if (kind === "wash") doWash(selected || herd.find((row) => row.id === body?.thronglet?.id));
    if (kind === "unlock") doUnlock(body?.action?.edge, body?.action);
    if (kind === "fire") doFire(at);
    if (kind === "stone") doStone(at);
  }

  async function postAction(kind, txHash) {
    let last = {};
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`/x402/thronglets-${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-PAYMENT": txHash },
        body: JSON.stringify({
          id: selected?.id || "",
          edge: placeAt?.edge || "",
          txHash,
          x: placeAt?.u,
          y: placeAt?.v,
          col: placeAt?.col,
          row: placeAt?.row,
        }),
      });
      last = await res.json().catch(() => ({}));
      if (res.ok) return last;
      const err = last.error || "";
      if (err === "Payment Required" || err === "payment_not_found") {
        setStatus("waiting on chain");
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      throw new Error(err === "need_lot" ? "buy a lot first" : err === "need_body" ? "click a body first" : err === "need_100" ? `${livingMine()} / ${UNLOCK_AT}` : (err || "pay first"));
    }
    throw new Error(last.error && last.error !== "Payment Required" ? last.error : "tx not seen yet");
  }

  function setTool(kind) {
    bootAudio();
    tool = tool === kind ? "" : kind;
    tank.classList.toggle("holding", Boolean(tool));
    for (const [name, btn] of Object.entries(toolBtns)) {
      btn?.classList.toggle("on", tool === name);
    }
    recount();
  }

  async function playPaid(kind, at) {
    bootAudio();
    if (paying) return;
    if (!serverLots) { setStatus("buy a lot first"); return; }
    if (kind === "wash") {
      const who = at ? hit(at.mx, at.my) : selected;
      if (who) selected = who;
      if (!selected) { setStatus("drop it on a body"); return; }
    }
    if (kind === "unlock" && livingMine() < UNLOCK_AT) {
      setStatus(`${livingMine()} / ${UNLOCK_AT}`);
      return;
    }
    if (!window.azzleWalletMeta?.address) {
      document.querySelector(".rd-wallet-btn:not(:disabled)")?.click();
      setStatus("sign in");
      return;
    }
    paying = true;
    const aim = kind === "unlock" ? unlockAim() : null;
    placeAt = at || (aim ? { col: aim.col, row: aim.row, u: 0.5, v: 0.5, edge: aim.edge } : null);
    setStatus(kind);
    try {
      const hash = await payAzl(kind === "unlock" ? unlockWei : actionWei);
      const body = await postAction(kind, hash);
      applyPaid(kind, body, at);
      await pullWorld();
      if (kind === "unlock") {
        const c = Number(body?.action?.col);
        const r = Number(body?.action?.row);
        if (Number.isInteger(c) && Number.isInteger(r)) lookAt(c, r);
        else if (placeAt && Number.isInteger(placeAt.col)) lookAt(placeAt.col, placeAt.row);
      }
    } catch (err) {
      setStatus(walletText(err));
    } finally {
      paying = false;
    }
  }

  function recount() {
    const n = herd.filter((t) => t.dying <= 0 && t.col === focus.col && t.row === focus.row).length;
    howmany.textContent = String(n);
    const mineKeys = new Set(
      worldLots.filter((lot) => me && String(lot.agent).toLowerCase() === me).map((lot) => `${lot.col},${lot.row}`),
    );
    const owned = mineKeys.size
      ? herd.filter((t) => t.dying <= 0 && mineKeys.has(`${t.col},${t.row}`)).length
      : n;
    gate.style.setProperty("--n", `${Math.min(100, (owned / UNLOCK_AT) * 100)}%`);
    unlockBtn.classList.toggle("ready", owned >= UNLOCK_AT);
    unlockBtn.textContent = "";
    unlockBtn.innerHTML = '<span class="full">Build Bridge · 25000 AZL</span><span class="short">Bridge</span>';
    if (seamHint) {
      const world = worldStats?.living;
      const gateText = n >= TILE_CAP
        ? "140 cap. washed pairs evolve"
        : owned >= UNLOCK_AT ? "ready" : "100 living opens the next lot";
      seamHint.textContent = Number.isFinite(world) ? `${gateText} · world ${world}` : gateText;
    }
    const coarse = window.matchMedia("(pointer:coarse)").matches || window.innerWidth <= 720;
    if (tool) {
      pick.textContent = tool === "wash"
        ? (coarse ? "Tap a body with the sponge. Pays 1 AZL." : "Drop the sponge on a body. Pays 1 AZL.")
        : (coarse ? "Tap the field to drop it. Pays 1 AZL." : "Drop it on the field. Pays 1 AZL.");
    } else if (selected && selected.washed) {
      pick.textContent = `${selected.name} is wet. Two wet ones close will mate.`;
    } else if (selected) {
      pick.textContent = coarse
        ? "Poke is free. Pick sponge, then tap a body."
        : "Poke is free. Pick a sponge and drop it on them to wash.";
    } else {
      pick.textContent = serverLots
        ? (coarse ? "Pad switches lots. Pick a tool, then tap the field." : "Arrows switch lots. Drop food, a bubble, a sponge, fire, or a stone to pay.")
        : (coarse ? "Pad switches lots. Buy from the sign. 400000 AZL." : "Arrows switch lots. Buy from the sign. 400000 AZL.");
    }
    paintBoard();
  }

  function paintBoard() {
    if (!statsEl || !ranksEl) return;
    const s = worldStats || {};
    const evo = s.evo || {};
    const sale = adSale || deriveAdSale();
    const rows = [
      ["living", s.living ?? 0],
      ["players", s.players ?? 0],
      ["sold lots", s.sold ?? 0],
      ["taken lots", s.taken ?? 0],
      ["noggles", s.noggles ?? 0],
      ["washed", s.washed ?? 0],
      ["food out", s.food ?? 0],
      ["pip", evo.pip ?? 0],
      ["throng", evo.throng ?? 0],
      ["elder", evo.elder ?? 0],
      ["lord", evo.lord ?? 0],
      ["ad raised", fmtUsd(sale.raisedUsdc) + " / " + fmtUsd(sale.targetUsdc || AD_TARGET)],
      ["ads sold", sale.sold ?? worldAds.size],
    ];
    statsEl.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = String(v);
      return [dt, dd];
    }));
    ranksEl.replaceChildren();
    if (!worldBoard.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No herds yet. Buy a lot.";
      ranksEl.appendChild(empty);
      return;
    }
    for (const row of worldBoard) {
      const key = String(row.agent || "").toLowerCase();
      resolveLabel(row.agent);
      const label = row.name || names.get(key) || shortAddr(row.agent) || "herd";
      const li = document.createElement("li");
      if (me && key === me) li.classList.add("me");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(row.rank).padStart(2, "0");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = label;
      const sub = document.createElement("small");
      sub.textContent = [
        row.noggles ? "noggles" : "",
        row.evoName || "",
        `${row.lots || 0} lots`,
      ].filter(Boolean).join(" · ");
      who.appendChild(sub);
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = String(row.living ?? 0);
      const tip = document.createElement("em");
      tip.textContent = "living";
      score.appendChild(tip);
      li.append(rank, who, score);
      ranksEl.appendChild(li);
    }
  }

  function openBoard(on) {
    if (!boardEl) return;
    boardEl.hidden = !on;
    if (on) {
      if (drawer) drawer.hidden = true;
      paintBoard();
    }
  }

  function openDrawer(on) {
    drawer.hidden = !on;
    if (on) openBoard(false);
  }

  function seedLocal() {
    herd.length = 0;
    crumbs.length = 0;
    fires.length = 0;
    rocks.length = 0;
    bubbles.length = 0;
    tileIndex.clear();
    lotIndex.clear();
    worldLots = [];
    yours = null;
    lookAt(32, 32);
    nextLocal = 1;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = tank.clientWidth;
    h = tank.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function hit(mx, my) {
    const coarse = window.matchMedia("(pointer:coarse)").matches || window.innerWidth <= 720;
    let best = null, bestD = coarse ? 56 : 36;
    for (const t of herd) {
      if (t.dying > 0 || t.col !== focus.col || t.row !== focus.row) continue;
      const p = project(t);
      const d = Math.hypot(p.x - mx, p.y - my - 18);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  function scare(t) {
    t.screamUntil = nowMs + 700;
    t.talk = "AA";
    t.talkUntil = nowMs + 900;
    whisper.textContent = t.talk;
    aim(t, t.u + (Math.random() - 0.5) * 0.34, t.v + (Math.random() - 0.5) * 0.22);
    spray("dust", t, 10);
    sfx("scream");
  }

  function maybeBirth() {
    if (herd.length >= TILE_CAP) return;
    for (let i = 0; i < herd.length; i++) {
      const a = herd[i];
      if (!a.washed || a.dying) continue;
      const onTile = herd.filter((o) => o.col === a.col && o.row === a.row && !o.dying);
      if (onTile.length >= TILE_CAP) {
        for (let j = i + 1; j < herd.length; j++) {
          const b = herd[j];
          if (!b.washed || b.dying || a.col !== b.col || a.row !== b.row) continue;
          if (Math.hypot(a.u - b.u, a.v - b.v) > 0.11) continue;
          if (Math.random() > 0.12) continue;
          const who = (a.evo || 0) <= (b.evo || 0) ? a : b;
          if (evolveLocal((who.evo || 0) < EVO_MAX ? who : onTile.find((t) => (t.evo || 0) < EVO_MAX))) return;
        }
        continue;
      }
      for (let j = i + 1; j < herd.length; j++) {
        const b = herd[j];
        if (!b.washed || b.dying || a.col !== b.col || a.row !== b.row) continue;
        if (Math.hypot(a.u - b.u, a.v - b.v) > 0.11) continue;
        if (Math.random() > 0.08) continue;
        const baby = spawn(herd.length, {
          id: `h-${nextLocal++}`,
          name: say(),
          col: a.col,
          row: a.row,
          x: (a.u + b.u) / 2,
          y: (a.v + b.v) / 2,
          noggles: a.noggles || b.noggles,
          pop: 1,
        });
        aim(baby, baby.u, baby.v);
        herd.push(baby);
        spray("birth", baby, 12);
        sfx("birth");
        whisper.textContent = "pip";
        recount();
        return;
      }
    }
  }

  function doFeed(at) {
    const col = at?.col ?? selected?.col ?? yours?.col ?? focus.col;
    const row = at?.row ?? selected?.row ?? yours?.row ?? focus.row;
    crumbs.push({
      col, row,
      u: at?.u ?? (0.42 + Math.random() * 0.16),
      v: at?.v ?? (0.46 + Math.random() * 0.12),
      life: 4.2,
    });
    for (const t of herd) {
      if (t.dying || t.col !== col || t.row !== row) continue;
      aim(t, crumbs[crumbs.length - 1].u + (Math.random() - 0.5) * 0.08, crumbs[crumbs.length - 1].v + (Math.random() - 0.5) * 0.08);
    }
    whisper.textContent = "food";
    sfx("feed");
  }

  function doHey(at) {
    const col = at?.col ?? selected?.col ?? yours?.col ?? focus.col;
    const row = at?.row ?? selected?.row ?? yours?.row ?? focus.row;
    const u = at?.u ?? 0.5;
    const v = at?.v ?? 0.84;
    bubbles.push({ col, row, u, v, life: 6 });
    for (const t of herd) {
      if (t.dying || t.col !== col || t.row !== row) continue;
      aim(t, u + (Math.random() - 0.5) * 0.06, v + (Math.random() - 0.5) * 0.06);
      t.face = t.u < u ? 1 : -1;
    }
    whisper.textContent = "hey";
    sfx("hey");
  }

  function doPoke() {
    const t = selected || herd.find((row) => !row.dying);
    if (!t) return;
    scare(t);
    for (const o of herd) {
      if (o === t || o.dying || o.col !== t.col || o.row !== t.row) continue;
      if (Math.hypot(o.u - t.u, o.v - t.v) < 0.2) scare(o);
    }
  }

  function doWash(who) {
    const t = who || selected || herd.find((row) => !row.dying);
    if (!t) return;
    t.washed = true;
    t.wetUntil = nowMs + 8000;
    t.mate = Math.min(1, (t.mate || 0.08) + 0.4);
    t.talk = "wash";
    t.talkUntil = nowMs + 1100;
    t.age = Math.max(0, t.age - 20);
    selected = t;
    const idField = document.getElementById("tg-action-id");
    if (idField) idField.value = t.id;
    document.getElementById("tg-action-kind").value = "wash";
    spray("wash", t, 16);
    whisper.textContent = "wash";
    sfx("wash");
    recount();
  }

  function claimNeighbor(home, edge) {
    const step = DIRS[edge];
    if (!home || !step) return null;
    const col = home.col + step[0];
    const row = home.row + step[1];
    if (col < 0 || row < 0 || col >= GRID || row >= GRID) return null;
    const opp = { n: "s", s: "n", e: "w", w: "e" }[edge];
    if (!Array.isArray(home.edges)) home.edges = [];
    if (!home.edges.includes(edge)) home.edges.push(edge);
    const homeTile = ensureTile(home.col, home.row);
    if (!homeTile.edges.includes(edge)) homeTile.edges.push(edge);
    const tile = ensureTile(col, row);
    tile.sold = true;
    tile.taken = true;
    tile.mine = Boolean(me);
    if (!tile.edges.includes(opp)) tile.edges.push(opp);
    let lot = lotOnTile(col, row);
    if (!lot) {
      lot = { col, row, agent: me || home.agent, taken: true, edges: [opp] };
      worldLots.push(lot);
      lotIndex.set(tileKey(col, row), lot);
    } else {
      lot.taken = true;
      if (!Array.isArray(lot.edges)) lot.edges = [];
      if (!lot.edges.includes(opp)) lot.edges.push(opp);
    }
    return { col, row };
  }

  function resolveUnlockHome(aim) {
    if (!aim) return yours;
    const here = lotOnTile(aim.col, aim.row);
    if (mineLot(here)) return here;
    return ownedTouching(aim.col, aim.row) || yours || tileOf(aim.col, aim.row);
  }

  function healTakenFromEdges() {
    for (const lot of [...worldLots]) {
      for (const edge of lot.edges || []) {
        const step = DIRS[edge];
        if (!step) continue;
        const col = lot.col + step[0];
        const row = lot.row + step[1];
        if (col < 0 || row < 0 || col >= GRID || row >= GRID) continue;
        const opp = { n: "s", s: "n", e: "w", w: "e" }[edge];
        const there = lotOnTile(col, row);
        if (there) {
          if (!Array.isArray(there.edges)) there.edges = [];
          if (!there.edges.includes(opp)) there.edges.push(opp);
          const tile = ensureTile(col, row);
          tile.sold = true;
          if (there.taken) tile.taken = true;
          if (!tile.edges.includes(opp)) tile.edges.push(opp);
          continue;
        }
        claimNeighbor(lot, edge);
      }
    }
  }

  function doUnlock(edge, at) {
    const aim = at && Number.isInteger(Number(at.col))
      ? { col: Number(at.col), row: Number(at.row), edge: edge || at.edge || "" }
      : unlockAim();
    const here = Number.isInteger(aim.col) ? lotOnTile(aim.col, aim.row) : null;
    if (here?.taken) {
      lookAt(here.col, here.row);
      return;
    }
    const n = livingMine();
    if (n < UNLOCK_AT) {
      whisper.textContent = `${n} / ${UNLOCK_AT}`;
      return;
    }
    const home = resolveUnlockHome(aim);
    if (!home) return;
    const unused = ["e", "w", "n", "s"].find((dir) => !(home.edges || []).includes(dir));
    const picked = edge || aim.edge || unused || "e";
    const dest = claimNeighbor(home, picked);
    paintMap();
    paintSign();
    paintPad();
    if (dest) lookAt(dest.col, dest.row);
    whisper.textContent = "taken";
    sfx("unlock");
  }

  function smashAt(col, row, u, v, reach) {
    for (const t of herd) {
      if (t.dying || t.col !== col || t.row !== row) continue;
      if (Math.hypot(t.u - u, t.v - v) > reach) continue;
      t.dying = 0.7;
      spray("die", t, 10);
    }
  }

  function doFire(at) {
    const col = at?.col ?? selected?.col ?? yours?.col ?? focus.col;
    const row = at?.row ?? selected?.row ?? yours?.row ?? focus.row;
    const u = at?.u ?? (0.4 + Math.random() * 0.2);
    const v = at?.v ?? (0.42 + Math.random() * 0.16);
    fires.push({ col, row, u, v, life: 8 });
    smashAt(col, row, u, v, 0.12);
    for (const t of herd) {
      if (t.dying || t.col !== col || t.row !== row) continue;
      aim(t, t.u + (t.u - u) * 0.4, t.v + (t.v - v) * 0.4);
    }
    whisper.textContent = "fire";
    sfx("fire");
    recount();
  }

  function doStone(at) {
    const col = at?.col ?? selected?.col ?? yours?.col ?? focus.col;
    const row = at?.row ?? selected?.row ?? yours?.row ?? focus.row;
    const u = at?.u ?? (0.38 + Math.random() * 0.24);
    const v = at?.v ?? (0.4 + Math.random() * 0.2);
    rocks.push({ col, row, u, v, life: 7, fall: 1 });
    smashAt(col, row, u, v, 0.14);
    whisper.textContent = "stone";
    sfx("stone");
    recount();
  }

  function step(dt) {
    for (const t of herd) {
      if (t.dying > 0) {
        t.dying -= dt;
        if (t.dying <= 0) t.dead = true;
        continue;
      }
      if (!onStage(t)) continue;
      t.age += dt;
      t.breath += dt * 3.2;
      t.pop = Math.max(0, t.pop - dt * 3);
      t.retarget -= dt;
      if (t.washed && nowMs > t.wetUntil && serverLots) t.wetUntil = nowMs + 4000;

      const crumb = crumbs.find((c) => c.col === t.col && c.row === t.row && c.life > 0);
      if (crumb) {
        t.tu = crumb.u + (Math.random() - 0.5) * 0.04;
        t.tv = crumb.v + (Math.random() - 0.5) * 0.04;
        if (Math.hypot(t.u - crumb.u, t.v - crumb.v) < 0.06) crumb.life -= dt * 0.9;
      } else if (t.retarget <= 0) {
        const opens = openEdges(t.col, t.row);
        if (opens.length && Math.random() < 0.72) {
          const dest = { e: [0.98, 0.5], w: [0.02, 0.5], n: [0.5, 0.02], s: [0.5, 0.98] }[opens[(Math.random() * opens.length) | 0]];
          aim(t, dest[0] + (Math.random() - 0.5) * 0.06, dest[1] + (Math.random() - 0.5) * 0.16);
        } else {
          let nu = 0.08 + Math.random() * 0.84;
          let nv = 0.08 + Math.random() * 0.84;
          const buddy = herd.find((o) => o !== t && !o.dying && o.col === t.col && o.row === t.row && Math.hypot(o.u - t.u, o.v - t.v) < 0.22);
          if (buddy && Math.random() < 0.45) {
            nu = (t.u + buddy.u) / 2 + (Math.random() - 0.5) * 0.1;
            nv = (t.v + buddy.v) / 2 + (Math.random() - 0.5) * 0.1;
          }
          aim(t, nu, nv);
        }
        if (Math.random() < 0.2) t.face *= -1;
      }

      const dx = t.tu - t.u;
      const dy = t.tv - t.v;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.012) {
        const stepN = t.speed * dt * (t.washed ? 1.08 : 1);
        t.u += (dx / dist) * Math.min(stepN, dist);
        t.v += (dy / dist) * Math.min(stepN, dist);
        t.face = dx >= 0 ? 1 : -1;
        t.phase += dt * 13;
        if (Math.random() < dt * 0.35) sfx("hop");
      } else {
        t.phase += dt * 3.4;
      }

      if (t.u < 0.06 && seamOpen(t.col, t.row, "w")) { t.col -= 1; t.u = 0.92; aim(t, 0.28, t.v); }
      else if (t.u > 0.94 && seamOpen(t.col, t.row, "e")) { t.col += 1; t.u = 0.08; aim(t, 0.72, t.v); }
      else if (t.v < 0.06 && seamOpen(t.col, t.row, "n")) { t.row -= 1; t.v = 0.92; aim(t, t.u, 0.28); }
      else if (t.v > 0.94 && seamOpen(t.col, t.row, "s")) { t.row += 1; t.v = 0.08; aim(t, t.u, 0.72); }
      else {
        t.u = Math.min(0.96, Math.max(0.04, t.u));
        t.v = Math.min(0.96, Math.max(0.04, t.v));
      }
      if (nowMs > t.talkUntil) t.talk = "";

      const blaze = fires.find((c) => c.col === t.col && c.row === t.row && c.life > 0);
      if (blaze && Math.hypot(t.u - blaze.u, t.v - blaze.v) < 0.1) {
        t.dying = 0.7;
        spray("die", t, 8);
        sfx("die");
      } else if (blaze) {
        aim(t, t.u + (t.u - blaze.u) * 0.2, t.v + (t.v - blaze.v) * 0.2);
      }
    }

    for (let i = herd.length - 1; i >= 0; i--) {
      if (herd[i].dead) {
        if (selected === herd[i]) selected = null;
        herd.splice(i, 1);
      }
    }
    for (let i = crumbs.length - 1; i >= 0; i--) {
      crumbs[i].life -= dt;
      if (crumbs[i].life <= 0) crumbs.splice(i, 1);
    }
    for (let i = fires.length - 1; i >= 0; i--) {
      fires[i].life -= dt;
      if (fires[i].life <= 0) fires.splice(i, 1);
    }
    for (let i = rocks.length - 1; i >= 0; i--) {
      rocks[i].life -= dt;
      rocks[i].fall = Math.max(0, (rocks[i].fall || 0) - dt * 1.8);
      if (rocks[i].life <= 0) rocks.splice(i, 1);
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      bubbles[i].life -= dt;
      if (bubbles[i].life <= 0) bubbles.splice(i, 1);
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 70 * dt;
      if (b.life <= 0) bits.splice(i, 1);
    }
    if (Math.random() < dt * 0.22) {
      const live = herd.filter((row) => !row.dying && !row.dead && row.col === focus.col && row.row === focus.row);
      const t = live[(Math.random() * live.length) | 0];
      if (t) {
        t.talk = t.washed ? "wash" : say();
        t.talkUntil = nowMs + 1300;
        whisper.textContent = t.talk;
      }
    }
    if (!serverLots && Math.random() < dt * 0.7) maybeBirth();
  }

  function hash(col, row, i) {
    return ((col * 73 + row * 149 + i * 37) % 1000) / 1000;
  }

  function lotTint(col, row) {
    const lot = lotOnTile(col, row);
    if (!lot) return { hill: "#0c1014", grass: "#1a2216", tip: "rgba(90,120,70,.35)" };
    if (lot.taken) return { hill: "#14243a", grass: "#1c3358", tip: "rgba(90,150,255,.4)" };
    if (me && String(lot.agent).toLowerCase() === me) return { hill: "#1a2a14", grass: "#2a4a22", tip: "rgba(200,241,105,.45)" };
    return { hill: "#141c12", grass: "#22301a", tip: "rgba(140,170,90,.28)" };
  }

  function drawTree(x, y, s, sway) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.fillStyle = "#1a1008";
    ctx.fillRect(-s * 0.06, -s * 0.12, s * 0.12, s * 0.22);
    ctx.fillStyle = "#0c140c";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.38, s * 0.28, s * 0.34, 0, 0, Math.PI * 2);
    ctx.ellipse(-s * 0.16, -s * 0.22, s * 0.18, s * 0.2, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.16, -s * 0.2, s * 0.16, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBridge(edge) {
    const back = floorY().back;
    const front = floorY().front;
    const midY = back + (front - back) * 0.52;
    ctx.save();
    ctx.fillStyle = "#5a3a18";
    ctx.strokeStyle = "#2a180c";
    ctx.lineWidth = 2;
    if (edge === "e") {
      ctx.beginPath();
      ctx.moveTo(w * 0.9, midY - 10);
      ctx.lineTo(w * 0.99, midY - 4);
      ctx.lineTo(w * 0.99, midY + 16);
      ctx.lineTo(w * 0.9, midY + 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (edge === "w") {
      ctx.beginPath();
      ctx.moveTo(w * 0.1, midY - 10);
      ctx.lineTo(w * 0.01, midY - 4);
      ctx.lineTo(w * 0.01, midY + 16);
      ctx.lineTo(w * 0.1, midY + 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (edge === "n") {
      ctx.fillRect(w * 0.44, back - 8, w * 0.12, 18);
    } else if (edge === "s") {
      ctx.fillRect(w * 0.42, front - 8, w * 0.16, 16);
    }
    ctx.restore();
  }

  function drawLand(t) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#070910");
    sky.addColorStop(0.28, "#10161c");
    sky.addColorStop(0.48, "#1a2418");
    sky.addColorStop(1, "#0c100c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const mx = w * 0.78;
    const my = h * 0.14;
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, w * 0.42);
    halo.addColorStop(0, "rgba(232,244,180,.22)");
    halo.addColorStop(0.18, "rgba(200,241,105,.08)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#f4f1c8";
    ctx.beginPath();
    ctx.arc(mx, my, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200,241,105,.18)";
    ctx.beginPath();
    ctx.arc(mx - 5, my - 3, 5, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 48; i++) {
      const sx = hash(9, i, focus.col) * w;
      const sy = hash(8, i, focus.row) * h * 0.42;
      const tw = 0.35 + (Math.sin(t / 400 + i) + 1) * 0.32;
      ctx.globalAlpha = tw;
      ctx.fillStyle = i % 7 === 0 ? "#c8f169" : "#f4f1ea";
      ctx.fillRect(sx, sy, i % 11 === 0 ? 2.2 : 1.2, i % 11 === 0 ? 2.2 : 1.2);
    }
    ctx.globalAlpha = 1;

    const markTop = h * 0.05;
    const markW = Math.min(w * 0.28, 280);
    const markH = mark.complete && mark.naturalWidth
      ? markW * (mark.naturalHeight / mark.naturalWidth)
      : markW * 0.32;
    if (mark.complete && mark.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.2 + Math.sin(t / 2600) * 0.04;
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(mark, w * 0.5 - markW / 2, markTop + Math.sin(t / 2400) * 4, markW, markH);
      ctx.restore();
    }

    const ridge = h * 0.4;
    drawAdSkyboard(markTop + markH + 14, ridge - 28);
    for (let i = 0; i < 7; i++) {
      const hx = (i / 6) * w;
      const hh = 28 + hash(focus.col, i, 4) * 54;
      ctx.beginPath();
      ctx.moveTo(hx - 90, ridge + 20);
      ctx.quadraticCurveTo(hx, ridge - hh, hx + 90, ridge + 20);
      ctx.fillStyle = i % 2 ? "#0e1410" : "#12180f";
      ctx.fill();
    }

    for (let i = 0; i < 11; i++) {
      const tx = (i / 10) * w + hash(focus.row, i, 2) * 30 - 15;
      drawTree(tx, ridge + 8, 70 + hash(3, i, 5) * 50, Math.sin(t / 1800 + i) * 0.03);
    }

    const fog = ctx.createLinearGradient(0, ridge - 10, 0, ridge + 50);
    fog.addColorStop(0, "rgba(180,210,160,0)");
    fog.addColorStop(0.5, "rgba(180,210,160,.08)");
    fog.addColorStop(1, "rgba(10,16,10,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, ridge - 20, w, 80);

    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (!dc && !dr) continue;
        const col = focus.col + dc;
        const row = focus.row + dr;
        if (col < 0 || row < 0 || col >= GRID || row >= GRID) continue;
        const x = w * 0.5 + dc * w * 0.3;
        const y = h * 0.32 + dr * h * 0.075;
        const tint = lotTint(col, row);
        ctx.beginPath();
        ctx.moveTo(x - 86, y + 22);
        ctx.quadraticCurveTo(x, y - 26, x + 86, y + 22);
        ctx.fillStyle = tint.hill;
        ctx.fill();
      }
    }

    const back = floorY().back;
    const front = floorY().front;
    const far = floorX(0);
    const near = floorX(1);
    const here = lotTint(focus.col, focus.row);
    const bank = ctx.createLinearGradient(0, back, 0, h);
    bank.addColorStop(0, "#12180e");
    bank.addColorStop(1, "#0a0c08");
    ctx.beginPath();
    ctx.moveTo(0, back + 16);
    ctx.lineTo(w, back + 16);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = bank;
    ctx.fill();

    const land = ctx.createLinearGradient(0, back, 0, front);
    land.addColorStop(0, "#1c2e18");
    land.addColorStop(0.4, here.grass);
    land.addColorStop(1, "#14180e");
    ctx.beginPath();
    ctx.moveTo(far.left, back);
    ctx.quadraticCurveTo(w * 0.5, back - 36, far.right, back);
    ctx.lineTo(near.right, front);
    ctx.quadraticCurveTo(w * 0.5, front + 18, near.left, front);
    ctx.closePath();
    ctx.fillStyle = land;
    ctx.fill();

    const pool = ctx.createRadialGradient(w * 0.62, (back + front) * 0.48, 20, w * 0.55, (back + front) * 0.55, w * 0.55);
    pool.addColorStop(0, "rgba(200,241,105,.1)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(far.left, back);
    ctx.quadraticCurveTo(w * 0.5, back - 36, far.right, back);
    ctx.lineTo(near.right, front);
    ctx.quadraticCurveTo(w * 0.5, front + 18, near.left, front);
    ctx.clip();
    for (let i = 0; i < 140; i++) {
      const u = hash(focus.col, focus.row, i);
      const v = hash(focus.col, focus.row, i + 140);
      const p = project({ col: focus.col, row: focus.row, u, v });
      const tall = 5 + v * 10;
      ctx.strokeStyle = i % 5 === 0 ? here.tip : "rgba(28,48,22,.85)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + Math.sin(t / 700 + i) * 2, p.y - tall * 0.5, p.x + (u - 0.5) * 5, p.y - tall);
      ctx.stroke();
      if (i % 11 === 0) {
        ctx.fillStyle = i % 22 === 0 ? "#c8f169" : "#e3b23a";
        ctx.beginPath();
        ctx.arc(p.x + 1, p.y - tall - 1, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 16; i++) {
      const u = hash(4, focus.col, i);
      const v = hash(5, focus.row, i + 3);
      const p = project({ col: focus.col, row: focus.row, u, v });
      ctx.fillStyle = "#3a3428";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 5 + u * 4, 2.2, u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const edge of openEdges(focus.col, focus.row)) drawBridge(edge);
    drawAdBoard();

    ctx.fillStyle = "#f4f1ea";
    for (let i = 0; i < 18; i++) {
      const fx = (hash(2, i, 3) * w + t * (0.012 + i * 0.0018)) % w;
      const fy = h * 0.22 + hash(3, i, 4) * h * 0.5 + Math.sin(t / 480 + i) * 10;
      ctx.globalAlpha = 0.12 + (Math.sin(t / 280 + i) + 1) * 0.18;
      ctx.beginPath();
      ctx.arc(fx, fy, 1.1 + (i % 4) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.55, w * 0.2, w * 0.5, h * 0.5, w * 0.78);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.38)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  function drawAdSkyboard(topY, bottomY) {
    const ad = adOnTile(focus.col, focus.row);
    const bw = Math.min(w * 0.58, 480);
    const room = Math.max(48, (bottomY || h * 0.36) - (topY || h * 0.2));
    const bh = Math.min(h * 0.1, 78, room);
    const x = w * 0.5 - bw / 2;
    const y = Math.max(topY || h * 0.2, (bottomY || h * 0.36) - bh - 8);
    ctx.save();
    ctx.fillStyle = "#1a1008";
    ctx.fillRect(x - 6, y - 6, bw + 12, bh + 12);
    ctx.fillStyle = "#5a3a18";
    ctx.fillRect(x - 3, y - 3, bw + 6, bh + 6);
    if (ad) {
      const art = adImage(ad.skyImage);
      if (art) {
        ctx.drawImage(art, x, y, bw, bh);
      } else {
        ctx.fillStyle = "#2a2214";
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = "#c8f169";
        ctx.font = "600 16px Clash Display, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(ad.project || "AD").slice(0, 28), w * 0.5, y + bh * 0.45);
        ctx.fillStyle = "#f4f1ea";
        ctx.font = "500 10px IBM Plex Mono, ui-monospace, monospace";
        ctx.fillText(String(ad.tagline || "").slice(0, 40), w * 0.5, y + bh * 0.72);
        ctx.textAlign = "left";
      }
    } else {
      ctx.fillStyle = "#e8e0d0";
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = "rgba(90,58,24,.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x + 10, y + 10, bw - 20, bh - 20);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(90,58,24,.55)";
      ctx.font = "600 14px Clash Display, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("YOUR AD HERE", w * 0.5, y + bh * 0.48);
      ctx.font = "500 9px IBM Plex Mono, ui-monospace, monospace";
      ctx.fillStyle = "rgba(90,58,24,.4)";
      ctx.fillText("WIDE · " + fmtUsd(adPriceLocal(focus.col, focus.row)) + " USDC", w * 0.5, y + bh * 0.72);
      ctx.textAlign = "left";
    }
    ctx.restore();
  }

  const adImgCache = new Map();

  function adImage(src) {
    let key = String(src || "");
    if (!key) return null;
    if (key.startsWith("ipfs://")) {
      key = "https://gateway.pinata.cloud/ipfs/" + key.slice(7).split("/")[0];
    }
    let img = adImgCache.get(key);
    if (img) return img.complete && img.naturalWidth ? img : null;
    img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.crossOrigin = "anonymous";
    img.src = key;
    adImgCache.set(key, img);
    return null;
  }

  function drawAdBoard() {
    const ad = adOnTile(focus.col, focus.row);
    const side = Math.min(128, w * 0.22);
    const x = w * 0.74;
    const y = floorY().back + 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.03);
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(side * 0.18, side + 2, 7, 26);
    ctx.fillRect(side * 0.72, side + 2, 7, 26);
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(side * 0.18 + 1, side + 2, 5, 24);
    ctx.fillRect(side * 0.72 + 1, side + 2, 5, 24);
    ctx.fillStyle = '#2a160a';
    ctx.fillRect(-5, -5, side + 10, side + 10);
    ctx.fillStyle = '#7a4a1c';
    ctx.fillRect(-2, -2, side + 4, side + 4);
    if (ad) {
      const art = adImage(ad.fieldImage);
      if (art) {
        ctx.drawImage(art, 0, 0, side, side);
      } else {
        ctx.fillStyle = '#f3e0b8';
        ctx.fillRect(0, 0, side, side);
        ctx.fillStyle = '#5a3a18';
        ctx.fillRect(6, 6, side - 12, side - 12);
        ctx.fillStyle = '#c8f169';
        ctx.font = '600 12px Clash Display, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(ad.project || 'AD').slice(0, 12), side / 2, side * 0.45);
        ctx.fillStyle = '#f4f1ea';
        ctx.font = '500 9px IBM Plex Mono, ui-monospace, monospace';
        ctx.fillText(String(ad.tagline || '').slice(0, 16), side / 2, side * 0.62);
        ctx.textAlign = 'left';
      }
    } else {
      ctx.fillStyle = '#e8e0d0';
      ctx.fillRect(0, 0, side, side);
      ctx.strokeStyle = 'rgba(90,58,24,.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(8, 8, side - 16, side - 16);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(90,58,24,.55)';
      ctx.font = '600 11px Clash Display, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOUR AD HERE', side / 2, side * 0.42);
      ctx.font = '500 8px IBM Plex Mono, ui-monospace, monospace';
      ctx.fillStyle = 'rgba(90,58,24,.4)';
      ctx.fillText('SQUARE', side / 2, side * 0.58);
      ctx.fillText(fmtUsd(adPriceLocal(focus.col, focus.row)), side / 2, side * 0.72);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  function drawFood(p) {
    const s = 11 * p.s;
    ctx.fillStyle = "#5a3a18";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 3, s * 1.3, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a5a22";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s * 1.15, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e3b23a";
    ctx.beginPath();
    ctx.arc(p.x - 4, p.y - 2, 3.2 * p.s, 0, Math.PI * 2);
    ctx.arc(p.x + 3, p.y - 1, 2.6 * p.s, 0, Math.PI * 2);
    ctx.arc(p.x, p.y + 1, 2.2 * p.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c8f169";
    ctx.beginPath();
    ctx.arc(p.x + 5, p.y - 3, 1.8 * p.s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFire(p, life) {
    const s = (10 + Math.sin(nowMs / 60) * 2) * p.s;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + life * 0.08);
    ctx.fillStyle = "#5a1808";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, s * 1.4, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff6a1a";
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y + 2);
    ctx.quadraticCurveTo(p.x - s * 0.4, p.y - s * 1.6, p.x, p.y - s * 2.2);
    ctx.quadraticCurveTo(p.x + s * 0.4, p.y - s * 1.4, p.x + s, p.y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd36a";
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.4, p.y + 1);
    ctx.quadraticCurveTo(p.x, p.y - s * 1.1, p.x + s * 0.35, p.y + 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStone(p, fall) {
    const lift = (fall || 0) * 110 * p.s;
    const s = 13 * p.s;
    ctx.save();
    ctx.translate(p.x, p.y - lift);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.ellipse(0, lift + 4, s * 1.1, s * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6b6a66";
    ctx.beginPath();
    ctx.moveTo(-s, 2);
    ctx.lineTo(-s * 0.5, -s * 0.9);
    ctx.lineTo(s * 0.2, -s);
    ctx.lineTo(s, -s * 0.2);
    ctx.lineTo(s * 0.6, s * 0.5);
    ctx.lineTo(-s * 0.4, s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8d8b86";
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.7);
    ctx.lineTo(s * 0.15, -s * 0.75);
    ctx.lineTo(s * 0.35, -s * 0.2);
    ctx.lineTo(-s * 0.05, -s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBubble(p) {
    const s = 16 * (p.s || 1);
    ctx.save();
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath();
    ctx.roundRect(p.x - s, p.y - s * 1.2, s * 2, s * 1.3, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y + 4);
    ctx.lineTo(p.x - 10, p.y + 14);
    ctx.lineTo(p.x + 4, p.y + 4);
    ctx.fill();
    ctx.fillStyle = "#050506";
    ctx.font = `600 ${Math.round(11 * (p.s || 1))}px Clash Display, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("hey", p.x, p.y - 2);
    ctx.restore();
  }

  function drawSponge(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#e2b14a";
    ctx.beginPath();
    ctx.roundRect(-16, -12, 34, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#c48a28";
    ctx.beginPath();
    ctx.ellipse(-6, -2, 3, 2.2, 0, 0, Math.PI * 2);
    ctx.ellipse(4, 3, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(8, -5, 2.2, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.stroke();
    ctx.restore();
  }

  function draw(now) {
    drawLand(now);
    for (const c of crumbs) {
      if (c.col !== focus.col || c.row !== focus.row) continue;
      drawFood(project({ col: c.col, row: c.row, u: c.u, v: c.v }));
    }
    for (const c of fires) {
      if (c.col !== focus.col || c.row !== focus.row) continue;
      drawFire(project({ col: c.col, row: c.row, u: c.u, v: c.v }), c.life);
    }
    for (const c of rocks) {
      if (c.col !== focus.col || c.row !== focus.row) continue;
      drawStone(project({ col: c.col, row: c.row, u: c.u, v: c.v }), c.fall);
    }
    for (const c of bubbles) {
      if (c.col !== focus.col || c.row !== focus.row) continue;
      drawBubble(project({ col: c.col, row: c.row, u: c.u, v: c.v }));
    }
    const list = herd.filter((t) => t.col === focus.col && t.row === focus.row).sort((a, b) => a.v - b.v);
    for (const t of list) {
      const p = project(t);
      const walking = Math.hypot(t.tu - t.u, t.tv - t.v) > 0.02;
      const bob = walking ? Math.abs(Math.sin(t.phase)) * 4 * p.s : Math.sin(t.breath) * 1.6 * p.s;
      const squash = walking ? 1 + Math.sin(t.phase) * 0.03 : 1 + Math.sin(t.breath) * 0.015;
      const evo = Math.min(EVO_MAX, t.evo || 0);
      const size = ((p.here ? 72 : 24) + (t.pop ? 8 : 0)) * p.s * (1 + evo * 0.2) * (t.dying ? Math.max(0.15, t.dying) : 1);
      const scared = now < t.screamUntil;
      const img = scared && scream.complete ? scream : calm;
      ctx.save();
      ctx.globalAlpha = t.dying ? Math.max(0, t.dying) : 1;
      ctx.translate(p.x, p.y - bob);
      ctx.fillStyle = "rgba(0,0,0,.32)";
      ctx.beginPath();
      ctx.ellipse(0, 10, size * 0.24, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.scale(t.face * squash, 1 / squash);
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, -size / 2, -size + 12, size, size);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = (t.dying ? Math.max(0, t.dying) : 1) * 0.16;
        ctx.fillStyle = "#c8f169";
        ctx.beginPath();
        ctx.ellipse(-size * 0.08, -size * 0.42, size * 0.16, size * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = t.dying ? Math.max(0, t.dying) : 1;
      }
      if (t.washed || now < t.wetUntil) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#b7e7ff";
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.38, size * 0.2, size * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = t.dying ? Math.max(0, t.dying) : 1;
      }
      if (evo >= 2) {
        ctx.strokeStyle = evo >= 3 ? "#e3b23a" : "rgba(200,241,105,.7)";
        ctx.lineWidth = evo >= 3 ? 2 : 1;
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.58, size * 0.18, size * 0.06, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (t.noggles && glasses.complete) {
        const gw = size * 0.7;
        const gh = gw * (glasses.naturalHeight / Math.max(1, glasses.naturalWidth));
        ctx.drawImage(glasses, -gw / 2, -size * 0.62, gw, gh);
      }
      ctx.restore();
      if (t === selected) {
        ctx.strokeStyle = "#c8f169";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 8, size * 0.28, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (t.talk) {
        ctx.fillStyle = "#c8f169";
        ctx.font = `500 ${Math.round(13 * p.s)}px Clash Display, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(t.talk, p.x, p.y - size + 2 - bob);
      }
    }
    for (const b of bits) {
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.fillStyle = b.kind === "wash" ? "#9ad7ff" : b.kind === "birth" ? "#c8f169" : "#c4a06a";
      ctx.fillRect(b.x, b.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    if (hand.on && tool === "wash") drawSponge(hand.x, hand.y);
    if (hand.on && tool === "feed") drawFood({ x: hand.x, y: hand.y, s: 1.1 });
    if (hand.on && tool === "hey") drawBubble({ x: hand.x, y: hand.y, s: 1.1 });
    if (hand.on && tool === "fire") drawFire({ x: hand.x, y: hand.y, s: 1.2 }, 8);
    if (hand.on && tool === "stone") drawStone({ x: hand.x, y: hand.y, s: 1.2 }, 0);
  }

  let last = performance.now();
  function loop(stamp) {
    nowMs = stamp;
    step(Math.min(0.033, (stamp - last) / 1000));
    last = stamp;
    draw(stamp);
    requestAnimationFrame(loop);
  }

  function uvFromEvent(e) {
    const box = canvas.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    const y0 = floorY().back;
    const y1 = floorY().front;
    const v = Math.min(1, Math.max(0, (my - y0) / (y1 - y0)));
    const span = floorX(v);
    const u = Math.min(1, Math.max(0, (mx - span.left) / (span.right - span.left)));
    return { mx, my, col: focus.col, row: focus.row, u, v };
  }

  function syncFromWorld(world) {
    if (!world || !Array.isArray(world.throng)) return;
    worldStats = world.stats || null;
    worldBoard = Array.isArray(world.leaderboard) ? world.leaderboard : [];
    tileIndex.clear();
    if (world.tiles) {
      for (const tile of world.tiles) {
        const hitTile = ensureTile(tile.col, tile.row);
        hitTile.sold = Boolean(tile.sold);
        hitTile.taken = Boolean(tile.taken);
        hitTile.edges = Array.isArray(tile.edges) ? tile.edges : [];
        hitTile.mine = Boolean(yours && yours.col === tile.col && yours.row === tile.row);
      }
    }
    crumbs.length = 0;
    for (const crumb of world.food || []) {
      crumbs.push({ col: crumb.col, row: crumb.row, u: crumb.x, v: crumb.y, life: crumb.life || 3 });
    }
    fires.length = 0;
    for (const blaze of world.fire || []) {
      fires.push({ col: blaze.col, row: blaze.row, u: blaze.x, v: blaze.y, life: blaze.life || 6 });
    }
    rocks.length = 0;
    for (const rock of world.stones || []) {
      rocks.push({ col: rock.col, row: rock.row, u: rock.x, v: rock.y, life: rock.life || 6, fall: rock.fall ?? 1 });
    }
    bubbles.length = 0;
    for (const bubble of world.bubbles || []) {
      bubbles.push({ col: bubble.col, row: bubble.row, u: bubble.x, v: bubble.y, life: bubble.life || 5 });
    }
    takePay(world.x402?.join, "join");
    takePay(world.x402?.noggles, "noggles");
    takePay(world.x402?.unlock, "unlock");
    worldAds = new Map();
    for (const ad of world.ads || []) {
      if (!Number.isInteger(ad.col) || !Number.isInteger(ad.row)) continue;
      worldAds.set(tileKey(ad.col, ad.row), ad);
    }
    adSale = deriveAdSale(world.adSale || null);
    paintBoard();
    syncAdModalFields();
    if (world.x402?.ad?.payTo) payToAddr = String(world.x402.ad.payTo).toLowerCase();
    if (world.x402?.ad?.asset) usdcAddr = String(world.x402.ad.asset).toLowerCase();
    const prevLots = new Map(worldLots.map((lot) => [tileKey(lot.col, lot.row), lot]));
    worldLots = Array.isArray(world.lots) ? world.lots.map((lot) => {
      const old = prevLots.get(tileKey(lot.col, lot.row));
      if (!old) return lot;
      return {
        ...lot,
        taken: Boolean(lot.taken || old.taken),
        edges: Array.from(new Set([...(lot.edges || []), ...(old.edges || [])])),
      };
    }) : [];
    for (const [key, old] of prevLots) {
      if (old.taken && !worldLots.some((lot) => tileKey(lot.col, lot.row) === key)) {
        worldLots.push(old);
      }
    }
    lotIndex.clear();
    for (const lot of worldLots) {
      lotIndex.set(tileKey(lot.col, lot.row), lot);
      const tile = ensureTile(lot.col, lot.row);
      tile.sold = true;
      tile.taken = Boolean(lot.taken);
      tile.mine = mineLot(lot);
      tile.edges = Array.from(new Set([...(tile.edges || []), ...(lot.edges || [])]));
      resolveLabel(lot.agent);
    }
    healTakenFromEdges();
    paintSign();
    paintMap();
    paintPad();
    if (!worldLots.length) return;
    const firstLot = !serverLots;
    serverLots = worldLots.length;
    const mine = lotFor(me) || worldLots[0];
    yours = mine ? ensureTile(mine.col, mine.row) : null;
    if (yours) yours.mine = Boolean(me && String(mine.agent).toLowerCase() === me);
    if (firstLot && yours) lookAt(yours.col, yours.row);
    else paintSign();
    const seen = new Set();
    const byId = new Map(herd.map((row) => [row.id, row]));
    for (const body of world.throng) {
      seen.add(body.id);
      let t = byId.get(body.id);
      if (!t) {
        t = spawn(herd.length, { ...body, pop: 1 });
        herd.push(t);
        spray("birth", t, 8);
      }
      const same = t.col === body.col && t.row === body.row;
      const localLot = lotOnTile(t.col, t.row);
      const kept = !same && localLot && (localLot.taken || mineLot(localLot))
        && Math.abs(t.col - body.col) + Math.abs(t.row - body.row) === 1
        && seamOpen(body.col, body.row, edgeToward({ col: body.col, row: body.row }, t));
      if (!kept) {
        t.col = body.col;
        t.row = body.row;
      }
      t.tu = body.x;
      t.tv = body.y;
      t.noggles = Boolean(body.noggles);
      t.washed = Boolean(body.washed);
      t.evo = Number(body.evo) || 0;
      t.name = body.name || t.name;
      t.miss = 0;
      if (body.say) {
        t.talk = body.say;
        t.talkUntil = nowMs + 1200;
      }
    }
    for (let i = herd.length - 1; i >= 0; i--) {
      if (seen.has(herd[i].id) || herd[i].dying > 0) continue;
      herd[i].miss = (herd[i].miss || 0) + 1;
      if (herd[i].miss < 3) continue;
      herd[i].dying = 0.55;
      spray("die", herd[i], 8);
    }
    for (const pulse of world.pulses || []) {
      if ((pulse.at || 0) <= seenPulse) continue;
      seenPulse = pulse.at;
      if (pulse.kind === "feed") {
        sfx("feed");
        for (const t of herd) {
          if (t.dying || t.col !== pulse.col || t.row !== pulse.row) continue;
          aim(t, (pulse.x ?? 0.5) + (Math.random() - 0.5) * 0.08, (pulse.y ?? 0.52) + (Math.random() - 0.5) * 0.08);
        }
      }
      if (pulse.kind === "hey") {
        sfx("hey");
        for (const t of herd) {
          if (t.dying || t.col !== pulse.col || t.row !== pulse.row) continue;
          aim(t, (pulse.x ?? 0.5) + (Math.random() - 0.5) * 0.06, (pulse.y ?? 0.84) + (Math.random() - 0.5) * 0.06);
        }
      }
      if (pulse.kind === "poke") {
        selected = herd.find((t) => t.id === pulse.id) || selected;
        doPoke();
      }
      if (pulse.kind === "wash") {
        const t = herd.find((row) => row.id === pulse.id);
        if (t) { selected = t; doWash(); }
      }
      if (pulse.kind === "unlock") doUnlock(pulse.edge, pulse);
      if (pulse.kind === "take") doUnlock(pulse.edge, pulse);
      if (pulse.kind === "noggles") {
        for (const t of herd) t.noggles = true;
      }
      if (pulse.kind === "birth") sfx("birth");
      if (pulse.kind === "evo") {
        const t = herd.find((row) => row.id === pulse.id);
        if (t) evolveLocal(t);
      }
      if (pulse.kind === "fire") sfx("fire");
      if (pulse.kind === "stone") sfx("stone");
    }
    recount();
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const at = uvFromEvent(e);
    hand.x = at.mx;
    hand.y = at.my;
    hand.on = true;
  });
  canvas.addEventListener("pointerleave", () => { hand.on = false; });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    bootAudio();
    const at = uvFromEvent(e);
    if (e.pointerType === "touch") {
      hand.x = at.mx;
      hand.y = at.my;
      hand.on = Boolean(tool);
    }
    const t = hit(at.mx, at.my);
    if (tool && tool !== "unlock") {
      if (t) {
        selected = t;
        const idField = document.getElementById("tg-action-id");
        if (idField) idField.value = t.id;
      }
      playPaid(tool, at);
      return;
    }
    if (t) {
      selected = t;
      const idField = document.getElementById("tg-action-id");
      if (idField) idField.value = t.id;
      scare(t);
      recount();
    }
  });

  feedBtn.addEventListener("click", () => { setTool("feed"); });
  heyBtn.addEventListener("click", () => { setTool("hey"); });
  washBtn.addEventListener("click", () => { setTool("wash"); });
  fireBtn.addEventListener("click", () => { setTool("fire"); });
  stoneBtn.addEventListener("click", () => { setTool("stone"); });
  document.getElementById("tg-unlock").addEventListener("click", () => { playPaid("unlock"); });
  function agentPlaybook() {
    const h = origin;
    return [
      "# Herd. Read this if you are an agent.",
      "# Page: /herd. Humans buy from the sign. You pay x402.",
      "",
      "# Clock. Free. This ticks the world.",
      `curl -s ${h}/x402/thronglets`,
      "",
      "# Buy a lot. 400000 AZL.",
      "# GET this path. 402. Read accepts[0].",
      "# network eip155:8453. asset is AZL. amount is wei.",
      "# Transfer that exact amount on Base to payTo.",
      "# Do not hardcode payTo. Take it from the 402.",
      "# Then POST the same path with the tx hash.",
      `curl -s ${h}/x402/thronglets-join`,
      `curl -s -X POST ${h}/x402/thronglets-join \\`,
      `  -H "content-type: application/json" \\`,
      `  -H "X-PAYMENT: $TX" \\`,
      "# Map is 64 by 64. 4096 lots. POST col and row of an empty tile.",
      `  -d '{"name":"lot","col":32,"row":32}'`,
      "",
      "# Noggles. 1000000 AZL. Same 402 then POST.",
      `curl -s ${h}/x402/thronglets-noggles`,
      `curl -s -X POST ${h}/x402/thronglets-noggles \\`,
      `  -H "X-PAYMENT: $TX"`,
      "",
      "# Verbs. 1 AZL each. Same 402 then POST.",
      "# unlock is 25000 AZL. 100 living. empty neighbor is taken. {\"edge\":\"e\"}",
      "# wash and poke body: {\"id\":\"t-1\"}",
      "# humans drop food, bubble, sponge, fire, stone on the field. POST x,y,col,row.",
      "# fire and stone drop on your lot and kill what they hit.",
      `curl -s ${h}/x402/thronglets-feed`,
      `curl -s ${h}/x402/thronglets-hey`,
      `curl -s ${h}/x402/thronglets-poke`,
      `curl -s ${h}/x402/thronglets-wash`,
      `curl -s ${h}/x402/thronglets-unlock`,
      `curl -s ${h}/x402/thronglets-fire`,
      `curl -s ${h}/x402/thronglets-stone`,
    ].join("\n");
  }

  function setStatus(text) {
    const status = document.getElementById("tg-status");
    if (status) status.textContent = text;
    whisper.textContent = text;
  }

  function transferData(to, wei) {
    const addr = String(to).replace(/^0x/, "").toLowerCase().padStart(64, "0");
    const amt = BigInt(wei).toString(16).padStart(64, "0");
    return `0xa9059cbb${addr}${amt}`;
  }

  function walletText(err) {
    const raw = err?.data?.message || err?.error?.message || err?.info?.error?.message || err?.message || "";
    const text = String(raw || "failed");
    if (/4001|user rejected|denied|rejected/i.test(text) || err?.code === 4001) return "rejected";
    if (/insufficient|exceeds balance|transfer amount/i.test(text)) return "need AZL";
    if (/gas|funds for gas|fee/i.test(text)) return "need ETH for gas";
    if (/unexpected error/i.test(text)) return "wallet refused. need AZL on Base, plus ETH for gas.";
    return text.replace(/^Error:\s*/i, "").slice(0, 80);
  }

  function provider() {
    const eth = window.ethereum;
    if (!eth) return null;
    if (Array.isArray(eth.providers) && eth.providers.length) {
      return eth.providers.find((row) => row.isMetaMask && !row.isBraveWallet) || eth.providers[0];
    }
    return eth;
  }

  async function ensureBase(eth) {
    const id = await eth.request({ method: "eth_chainId" });
    if (id === "0x2105") return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    } catch (err) {
      if (err?.code !== 4902) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
    }
  }

  async function connectWallet() {
    const eth = provider();
    if (!eth) throw new Error("need a wallet");
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    const from = accounts[0];
    me = String(from || "").toLowerCase();
    if (!me) throw new Error("need a wallet");
    await ensureBase(eth);
    resolveLabel(me);
    paintSign();
    return { eth, from };
  }

  async function waitMined(eth, hash) {
    for (let i = 0; i < 45; i++) {
      const rec = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (rec && rec.status === "0x1") return rec;
      if (rec && rec.status === "0x0") throw new Error("tx reverted");
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    return null;
  }

  async function azlBalance(eth, from) {
    const data = `0x70a08231${String(from).replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
    const raw = await eth.request({
      method: "eth_call",
      params: [{ to: azlAddr, data }, "latest"],
    });
    return BigInt(raw || "0x0");
  }

  function waitPoster() {
    if (window.azzlePoster) return Promise.resolve(window.azzlePoster);
    return new Promise((resolve) => {
      const done = () => resolve(window.azzlePoster || null);
      window.addEventListener("azzle-poster-ready", done, { once: true });
      setTimeout(done, 8000);
    });
  }

  async function payAzl(wei) {
    if (!payToAddr || !azlAddr) await pull402();
    if (!payToAddr || !azlAddr) throw new Error("missing payee");
    const poster = await waitPoster();
    const siteAddr = window.azzleWalletMeta?.address;
    if (poster?.sendAzl && siteAddr) {
      me = String(siteAddr).toLowerCase();
      resolveLabel(me);
      paintSign();
      const tokens = (BigInt(wei) / 10n ** 18n).toString();
      const result = await poster.sendAzl(payToAddr, tokens, (msg) => setStatus(String(msg || "wallet")));
      if (!result?.hash) throw new Error("no tx");
      return result.hash;
    }
    if (poster && !siteAddr) {
      document.querySelector(".rd-wallet-btn:not(:disabled)")?.click();
      throw new Error("sign in with the AZZLE wallet first");
    }
    const { eth, from } = await connectWallet();
    const need = BigInt(wei);
    const have = await azlBalance(eth, from);
    if (have < need) throw new Error(`need 400000 AZL. this injected wallet has ${have / 10n ** 18n}`);
    const tx = { from, to: azlAddr, data: transferData(payToAddr, wei), value: "0x0" };
    try {
      tx.gas = await eth.request({ method: "eth_estimateGas", params: [tx] });
    } catch (err) {
      throw new Error(walletText(err));
    }
    const hash = await eth.request({ method: "eth_sendTransaction", params: [tx] });
    setStatus("on chain");
    await waitMined(eth, hash);
    return hash;
  }

  async function payUsdc(amountUsdc) {
    if (!payToAddr) await pull402();
    if (!payToAddr) {
      const q = await fetch("/x402/thronglets-ad").then((r) => r.json()).catch(() => ({}));
      if (q.payTo) payToAddr = String(q.payTo).toLowerCase();
      if (q.asset) usdcAddr = String(q.asset).toLowerCase();
    }
    if (!payToAddr) throw new Error("missing payee");
    const poster = await waitPoster();
    const siteAddr = window.azzleWalletMeta?.address;
    if (poster?.sendUsdc && siteAddr) {
      me = String(siteAddr).toLowerCase();
      resolveLabel(me);
      paintSign();
      const result = await poster.sendUsdc(payToAddr, String(amountUsdc), (msg) => {
        if (adStatus) adStatus.textContent = String(msg || "wallet");
      });
      if (!result?.hash) throw new Error("no tx");
      return result.hash;
    }
    if (poster && !siteAddr) {
      document.querySelector(".rd-wallet-btn:not(:disabled)")?.click();
      throw new Error("sign in with the AZZLE wallet first");
    }
    if (!usdcAddr) usdcAddr = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const { eth, from } = await connectWallet();
    const wei = BigInt(Math.round(Number(amountUsdc) * 1e6));
    const data = transferData(payToAddr, wei);
    const tx = { from, to: usdcAddr, data, value: "0x0" };
    try {
      tx.gas = await eth.request({ method: "eth_estimateGas", params: [tx] });
    } catch (err) {
      throw new Error(walletText(err));
    }
    const hash = await eth.request({ method: "eth_sendTransaction", params: [tx] });
    if (adStatus) adStatus.textContent = "on chain";
    await waitMined(eth, hash);
    return hash;
  }

  function paintAdMap() {
    if (!adMap) return;
    const cell = 4;
    const size = GRID * cell;
    if (adMap.width !== size) {
      adMap.width = size;
      adMap.height = size;
    }
    const g = adMap.getContext("2d");
    g.fillStyle = "#16110c";
    g.fillRect(0, 0, size, size);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const price = adPriceLocal(col, row);
        const t = Math.min(1, price / 18);
        const taken = Boolean(adOnTile(col, row));
        if (taken) g.fillStyle = "#3d7cff";
        else g.fillStyle = `rgb(${Math.round(40 + t * 180)},${Math.round(30 + t * 40)},${Math.round(20 + (1 - t) * 40)})`;
        g.fillRect(col * cell, row * cell, cell - 1, cell - 1);
      }
    }
    g.fillStyle = "#c8f169";
    g.fillRect(adPick.col * cell - 1, adPick.row * cell - 1, cell + 1, cell + 1);
  }

  function syncAdModalFields() {
    const lotEl = document.getElementById("tg-ad-lot");
    const priceEl = document.getElementById("tg-ad-price");
    const raiseEl = document.getElementById("tg-ad-raise");
    const col = Number(adPick.col);
    const row = Number(adPick.row);
    const quoted = Number(adQuote?.priceUsdc);
    const local = (Number.isInteger(col) && Number.isInteger(row)) ? adPriceLocal(col, row) : 0;
    const price = Number.isFinite(quoted) && quoted > 0 ? quoted : local;
    if (lotEl) lotEl.textContent = col + ", " + row;
    if (priceEl) priceEl.textContent = fmtUsd(price) + " USDC";
    if (raiseEl) {
      const sale = adSale || deriveAdSale();
      raiseEl.textContent = fmtUsd(sale.raisedUsdc) + " / " + fmtUsd(sale.targetUsdc || AD_TARGET) + " USDC raised · " + (sale.sold || 0) + " sold";
    }
    paintAdMap();
  }

  async function refreshAdQuote() {
    try {
      const res = await fetch("/x402/thronglets-ad?col=" + adPick.col + "&row=" + adPick.row, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        adQuote = body;
        if (body.payTo) payToAddr = String(body.payTo).toLowerCase();
        if (body.asset) usdcAddr = String(body.asset).toLowerCase();
        if (body.adSale) adSale = deriveAdSale(body.adSale);
      }
    } catch { /* local price fallback */ }
    syncAdModalFields();
  }

  async function openAdModal() {
    adPick = { col: focus.col | 0, row: focus.row | 0 };
    adQuote = null;
    if (adStatus) adStatus.textContent = "";
    if (adModal?.showModal) adModal.showModal();
    else if (adModal) adModal.setAttribute("open", "");
    syncAdModalFields();
    await refreshAdQuote();
  }

  function closeAdModal() {
    if (adModal?.open) adModal.close();
    else adModal?.removeAttribute("open");
  }

  let adSkyData = "";
  let adFieldData = "";

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  async function encodeAdImage(file, mode) {
    if (!file) return "";
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error("png/jpg/webp only");
    const img = await fileToImage(file);
    const canvas = document.createElement("canvas");
    const maxW = mode === "sky" ? 1200 : 512;
    const maxH = mode === "sky" ? 280 : 512;
    let tw = img.naturalWidth;
    let th = img.naturalHeight;
    if (mode === "field") {
      const side = Math.min(tw, th);
      const sx = (tw - side) / 2;
      const sy = (th - side) / 2;
      const out = Math.min(side, maxW);
      canvas.width = out;
      canvas.height = out;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, out, out);
    } else {
      const scale = Math.min(1, maxW / tw, maxH / th);
      canvas.width = Math.max(1, Math.round(tw * scale));
      canvas.height = Math.max(1, Math.round(th * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    let quality = 0.85;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 160000 && quality > 0.45) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (data.length > 175000) throw new Error("image too large");
    return data;
  }

  function wireAdUpload(inputId, previewId, mode, setter) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        setter("");
        if (preview) preview.style.backgroundImage = "";
        return;
      }
      try {
        const data = await encodeAdImage(file, mode);
        setter(data);
        if (preview) preview.style.backgroundImage = "url(" + data + ")";
        if (adStatus) adStatus.textContent = mode === "sky" ? "skyboard ready" : "field board ready";
      } catch (err) {
        setter("");
        if (preview) preview.style.backgroundImage = "";
        if (adStatus) adStatus.textContent = err.message || "bad image";
        input.value = "";
      }
    });
  }

  wireAdUpload("tg-ad-sky", "tg-ad-sky-preview", "sky", (v) => { adSkyData = v; });
  wireAdUpload("tg-ad-field", "tg-ad-field-preview", "field", (v) => { adFieldData = v; });

  async function claimAd(txHash) {
    const project = document.getElementById("tg-ad-project")?.value.trim() || "";
    const tagline = document.getElementById("tg-ad-tagline")?.value.trim() || "";
    const url = document.getElementById("tg-ad-url")?.value.trim() || "";
    let last = {};
    for (let i = 0; i < 6; i++) {
      const res = await fetch("/x402/thronglets-ad", {
        method: "POST",
        headers: { "content-type": "application/json", "X-PAYMENT": txHash },
        body: JSON.stringify({
          txHash,
          col: adPick.col,
          row: adPick.row,
          project,
          tagline,
          url,
          skyImage: adSkyData,
          fieldImage: adFieldData,
        }),
      });
      last = await res.json().catch(() => ({}));
      if (res.ok) return last;
      if (last.error === "ad_taken") throw new Error("ad already sold");
      if (last.error === "Payment Required" || last.error === "payment_not_found") {
        if (adStatus) adStatus.textContent = "waiting on chain";
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      throw new Error(last.error || "pay first");
    }
    throw new Error(last.error && last.error !== "Payment Required" ? last.error : "tx not seen yet");
  }

  async function buyAdSpace(e) {
    e?.preventDefault?.();
    if (adBusy) return;
    const project = document.getElementById("tg-ad-project")?.value.trim() || "";
    if (!project) {
      if (adStatus) adStatus.textContent = "project name required";
      return;
    }
    if (adOnTile(adPick.col, adPick.row)) {
      if (adStatus) adStatus.textContent = "ad already sold";
      return;
    }
    adBusy = true;
    if (adStatus) adStatus.textContent = "wallet";
    try {
      await refreshAdQuote();
      if (adQuote && adQuote.available === false) throw new Error("ad already sold");
      const price = adQuote?.priceUsdc ?? adPriceLocal(adPick.col, adPick.row);
      const hash = await payUsdc(price);
      if (adStatus) adStatus.textContent = "pinning + claiming";
      await claimAd(hash);
      if (adStatus) adStatus.textContent = "board live";
      closeAdModal();
      setStatus("ad live on " + adPick.col + "," + adPick.row);
      await pullWorld();
      lookAt(adPick.col, adPick.row);
    } catch (err) {
      if (adStatus) adStatus.textContent = walletText(err);
    } finally {
      adBusy = false;
    }
  }

  function takePay(accept, kind) {
    if (!accept) return;
    if (accept.payTo) payToAddr = String(accept.payTo).toLowerCase();
    if (accept.asset) azlAddr = String(accept.asset).toLowerCase();
    const amt = accept.amount || accept.maxAmountRequired;
    if (!amt) return;
    if (kind === "noggles") nogglesWei = String(amt);
    else if (kind === "join") joinWei = String(amt);
    else if (kind === "unlock") unlockWei = String(amt);
  }

  async function claimLot(txHash) {
    const nameField = document.getElementById("tg-name");
    const typed = nameField?.value.trim();
    const name = typed || (me && names.get(me) && !String(names.get(me)).startsWith("0x") ? names.get(me) : "") || "";
    let last = {};
    for (let i = 0; i < 6; i++) {
      const res = await fetch("/x402/thronglets-join", {
        method: "POST",
        headers: { "content-type": "application/json", "X-PAYMENT": txHash },
        body: JSON.stringify({
          name,
          txHash,
          col: focus.col,
          row: focus.row,
        }),
      });
      last = await res.json().catch(() => ({}));
      if (res.ok) return last;
      const err = last.error || "";
      if (err === "Payment Required" || err === "payment_not_found") {
        setStatus("waiting on chain");
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      throw new Error(err || "pay first");
    }
    throw new Error(last.error && last.error !== "Payment Required" ? last.error : "tx not seen yet");
  }

  async function buyThisLot() {
    bootAudio();
    setStatus("wallet");
    try {
      const hash = await payAzl(joinWei || `${"400000"}${"0".repeat(18)}`);
      const txField = document.getElementById("tg-tx");
      if (txField) txField.value = hash;
      setStatus("claiming");
      await claimLot(hash);
      setStatus("lot in");
      await pullWorld();
    } catch (err) {
      setStatus(walletText(err));
    }
  }

  async function claimNoggles(txHash) {
    let last = {};
    for (let i = 0; i < 6; i++) {
      const res = await fetch("/x402/thronglets-noggles", {
        method: "POST",
        headers: { "content-type": "application/json", "X-PAYMENT": txHash },
        body: JSON.stringify({ txHash }),
      });
      last = await res.json().catch(() => ({}));
      if (res.ok) {
        for (const t of herd) t.noggles = true;
        for (const lot of worldLots) {
          if (mineLot(lot)) lot.noggles = true;
        }
        return last;
      }
      if (last.error === "need_lot") throw new Error("buy a lot first");
      if (last.error === "Payment Required" || last.error === "payment_not_found") {
        setStatus("waiting on chain");
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      throw new Error(last.error || "pay first");
    }
    throw new Error(last.error && last.error !== "Payment Required" ? last.error : "tx not seen yet");
  }

  async function buyNoggles() {
    bootAudio();
    if (!lotFor(me)) { setStatus("buy a lot first"); return; }
    if (!window.azzleWalletMeta?.address) {
      document.querySelector(".rd-wallet-btn:not(:disabled)")?.click();
      setStatus("sign in");
      return;
    }
    setStatus("noggles");
    try {
      const hash = await payAzl(nogglesWei);
      const field = document.getElementById("tg-noggles-tx");
      if (field) field.value = hash;
      await claimNoggles(hash);
      setStatus("noggles on");
      paintSign();
      await pullWorld();
    } catch (err) {
      setStatus(walletText(err));
    }
  }

  document.getElementById("tg-lot").addEventListener("click", () => { openDrawer(drawer.hidden); });
  document.getElementById("tg-board-btn")?.addEventListener("click", () => { openBoard(boardEl.hidden); });
  buyBtn?.addEventListener("click", buyThisLot);
  buyLotBtn?.addEventListener("click", buyThisLot);
  nogglesBtn?.addEventListener("click", buyNoggles);
  bridgeBtn?.addEventListener("click", () => { playPaid("unlock"); });
  adBuyBtn?.addEventListener("click", () => { openAdModal(); });
  document.getElementById("tg-ad-cancel")?.addEventListener("click", () => { closeAdModal(); });
  adForm?.addEventListener("submit", buyAdSpace);
  adMap?.addEventListener("pointerdown", (e) => {
    const rect = adMap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * GRID;
    const y = ((e.clientY - rect.top) / rect.height) * GRID;
    const col = Math.max(0, Math.min(GRID - 1, Math.floor(x)));
    const row = Math.max(0, Math.min(GRID - 1, Math.floor(y)));
    adPick = { col, row };
    adQuote = null;
    syncAdModalFields();
    refreshAdQuote();
  });
  document.getElementById("tg-noggles-wallet")?.addEventListener("click", buyNoggles);
  document.getElementById("tg-close").addEventListener("click", () => { openDrawer(false); });
  document.getElementById("tg-board-close")?.addEventListener("click", () => { openBoard(false); });

  async function pull402() {
    try {
      const res = await fetch("/x402");
      if (!res.ok) return;
      const body = await res.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      const join = items.find((row) => String(row.resource || "").includes("/thronglets-join"));
      const noggles = items.find((row) => String(row.resource || "").includes("/thronglets-noggles"));
      const feed = items.find((row) => String(row.resource || "").includes("/thronglets-feed"));
      const unlock = items.find((row) => String(row.resource || "").includes("/thronglets-unlock"));
      takePay(join?.accepts?.[0], "join");
      takePay(noggles?.accepts?.[0], "noggles");
      takePay(unlock?.accepts?.[0], "unlock");
      const actionAmt = feed?.accepts?.[0]?.amount || feed?.accepts?.[0]?.maxAmountRequired;
      if (actionAmt) actionWei = String(actionAmt);
      if (join?.resource) origin = new URL(join.resource).origin;
      const agent = document.getElementById("tg-agent");
      if (agent) agent.textContent = agentPlaybook();
    } catch { /* ok */ }
  }

  async function pullWorld() {
    try {
      const res = await fetch("/x402/thronglets");
      const body = await res.json().catch(() => ({}));
      syncFromWorld(body);
    } catch { /* ok */ }
  }

  document.getElementById("tg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = document.getElementById("tg-tx").value.trim();
    if (!hash) { setStatus("need a tx"); return; }
    setStatus("checking");
    try {
      await claimLot(hash);
      setStatus("lot in");
      await pullWorld();
    } catch (err) { setStatus(err?.message || "failed"); }
  });

  document.getElementById("tg-noggles-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("tg-noggles-status");
    const hash = document.getElementById("tg-noggles-tx").value.trim();
    if (!hash) { status.textContent = "need a tx"; return; }
    status.textContent = "checking";
    try {
      await claimNoggles(hash);
      status.textContent = "noggles on";
    } catch (err) { status.textContent = err?.message || "failed"; }
  });

  document.getElementById("tg-action-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("tg-action-status");
    const kind = document.getElementById("tg-action-kind").value;
    status.textContent = "checking";
    try {
      const res = await fetch(`/x402/thronglets-${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-PAYMENT": document.getElementById("tg-action-tx").value.trim() },
        body: JSON.stringify({
          id: document.getElementById("tg-action-id").value.trim(),
          edge: document.getElementById("tg-action-edge").value.trim(),
          txHash: document.getElementById("tg-action-tx").value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = body.error || "pay first"; return; }
      status.textContent = "paid";
      if (kind === "feed") doFeed();
      if (kind === "hey") doHey();
      if (kind === "wash") doWash(selected || herd.find((row) => row.id === body.thronglet?.id));
      if (kind === "unlock") doUnlock(body?.action?.edge, body?.action);
      if (kind === "fire") doFire();
      if (kind === "stone") doStone();
      await pullWorld();
    } catch { status.textContent = "failed"; }
  });

  window.addEventListener("resize", resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
    window.visualViewport.addEventListener("scroll", resize);
  }
  window.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "arrowup") { e.preventDefault(); stepFocus("n"); return; }
    if (k === "arrowdown") { e.preventDefault(); stepFocus("s"); return; }
    if (k === "arrowleft") { e.preventDefault(); stepFocus("w"); return; }
    if (k === "arrowright") { e.preventDefault(); stepFocus("e"); return; }
    if (k === "f") setTool("feed");
    if (k === "h" || k === "a") setTool("hey");
    if (k === "w") setTool("wash");
    if (k === "u") document.getElementById("tg-unlock").click();
    if (k === "r") setTool("fire");
    if (k === "o") setTool("stone");
    if (k === "p" || k === "l") document.getElementById("tg-lot").click();
    if (k === "b") document.getElementById("tg-board-btn")?.click();
    if (k === "escape") { if (tool) setTool(tool); openDrawer(false); openBoard(false); }
  });

  document.getElementById("tg-pad")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dir]");
    if (!btn || btn.disabled) return;
    stepFocus(btn.dataset.dir);
  });

  const mapCanvas = document.getElementById("tg-map-canvas");
  if (mapCanvas) {
    mapCanvas.addEventListener("click", (e) => {
      const box = mapCanvas.getBoundingClientRect();
      const col = Math.min(GRID - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * GRID)));
      const row = Math.min(GRID - 1, Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * GRID)));
      bootAudio();
      lookAt(col, row);
    });
  }

  seedLocal();
  resize();
  const agent = document.getElementById("tg-agent");
  if (agent) agent.textContent = agentPlaybook();
  requestAnimationFrame(loop);
  pull402();
  pullWorld();
  setInterval(pullWorld, 1200);
  function adoptSiteWallet(detail) {
    const addr = detail?.address || window.azzleWalletMeta?.address;
    if (!addr) return;
    me = String(addr).toLowerCase();
    resolveLabel(me);
    paintSign();
  }
  window.addEventListener("azzle-wallet-change", (e) => adoptSiteWallet(e.detail));
  window.addEventListener("azzle-poster-ready", () => adoptSiteWallet());
  if (window.ethereum && !window.azzleWalletMeta?.address) {
    window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
      if (!accounts?.[0] || window.azzleWalletMeta?.address) return;
      me = String(accounts[0]).toLowerCase();
      resolveLabel(me);
      paintSign();
    }).catch(() => {});
  }
})();
