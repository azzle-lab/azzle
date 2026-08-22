(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let walletAddress = null;
  let walletClientType = null;
  let walletDelegated = false;
  let busy = false;
  let balances = null;
  let vaultMarket = "standard";
  let swapQuoteTimer = 0;
  let swapQuoteSeq = 0;
  let swapQuoteAbort = null;
  let swapBusy = false;
  let onrampBusy = false;

  function eco(market) {
    return window.AZZLE_MARKETS?.economics?.(market || vaultMarket) || (
      (market || vaultMarket) === "micro"
        ? { postingFloorUsd: 5, entryDepositUsd: 3, liveTaskReserveUsd: 1, accessFeeUsd: 0.5 }
        : { postingFloorUsd: 45, entryDepositUsd: 25, liveTaskReserveUsd: 8, accessFeeUsd: 5 }
    );
  }

  function money(n) {
    return window.AZZLE_MARKETS?.money?.(n) || ("$" + n);
  }

  function api() {
    return window.azzlePoster ?? null;
  }

  function setStatus(text, kind) {
    const el = $("rd-wallet-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function fmtUsdc(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtAzl(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B AZL";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M AZL";
    return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
  }

  function fmtEth(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v < 0.0001) return v.toExponential(2) + " ETH";
    return v.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " ETH";
  }

  function vaultOf(b, market) {
    return b?.markets?.[market] || null;
  }

  function showReceive(address) {
    const receive = $("rd-wallet-receive");
    const addrEl = $("rd-wallet-address");
    if (!receive || !addrEl || !address) return;
    receive.hidden = false;
    addrEl.textContent = address;
  }

  function applyVaultUi() {
    const e = eco(vaultMarket);
    const deposit = $("rd-usdc-deposit-amt");
    if (deposit) {
      const current = Number(deposit.value);
      if (!deposit.value || [45, 5].includes(current)) {
        deposit.value = String(e.postingFloorUsd);
      }
      deposit.min = "1";
    }
    const formLabel = $("rd-deposit-form-label");
    const currency = document.querySelector("[data-deposit-currency].is-selected")?.dataset.depositCurrency ?? "usdc";
    if (formLabel) {
      formLabel.textContent =
        currency === "eth"
          ? "Fund " + (vaultMarket === "micro" ? "Micro" : "Standard") + " collateral · ETH converts to AZL"
          : "Fund " + (vaultMarket === "micro" ? "Micro" : "Standard") + " collateral · USDC converts to AZL";
    }
    const note = $("rd-wallet-vault-note");
    if (note) {
      note.textContent =
        (vaultMarket === "micro" ? "Micro" : "Standard") +
        " vault · " +
        money(e.postingFloorUsd) +
        " floor · entry " +
        money(e.entryDepositUsd) +
        " · access " +
        money(e.accessFeeUsd) +
        ". Credits do not cross markets.";
    }
    const lane = vaultOf(balances, vaultMarket);
    const withdrawInput = $("rd-usdc-withdraw-amt");
    if (withdrawInput && lane) {
      withdrawInput.placeholder = "Max " + lane.maxVaultWithdraw + " AZL";
    }
    const allowanceHint = $("rd-usdc-allowance-hint");
    if (allowanceHint && lane) {
      allowanceHint.textContent =
        "USDC gateway allowance: $" + lane.usdcVaultAllowance + " — approval is batched with deposit when needed";
    }
  }

  function renderVaultLane(market, lane) {
    const azlEl = $("rd-bal-vault-" + market);
    const usdEl = $("rd-bal-vault-" + market + "-usd");
    const e = eco(market);
    if (azlEl) azlEl.textContent = lane?.configured ? fmtAzl(lane.usdcVault) : "—";
    if (!usdEl) return;
    if (!lane?.configured) {
      usdEl.textContent = money(e.postingFloorUsd) + " floor · vault unavailable";
      usdEl.classList.remove("rd-wallet-balance-ready", "rd-wallet-balance-caution", "rd-wallet-balance-warning");
      if (azlEl) azlEl.classList.remove("rd-wallet-balance-ready", "rd-wallet-balance-caution", "rd-wallet-balance-warning");
      return;
    }
    const vaultUsd = Number(lane.usdcVaultUsd);
    const marketUsd = Number(lane.usdcVaultMarketUsd);
    const floor = Number(e.postingFloorUsd);
    const live = Number(e.liveTaskReserveUsd);
    const ready = Boolean(lane.usdcVaultMeetsMinimum) || (Number.isFinite(vaultUsd) && vaultUsd >= floor);
    const critical = Number.isFinite(vaultUsd) && vaultUsd <= live;
    const caution = !ready && !critical;
    let status = " ✓";
    if (critical) status = " · below " + money(live) + " live";
    else if (caution) status = " · below " + money(floor) + " floor";
    let text =
      "Collateral value $" +
      (Number.isFinite(vaultUsd) ? vaultUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—") +
      " (20% haircut)" +
      status;
    if (Number.isFinite(marketUsd) && marketUsd > 0) {
      text += " · market $" + marketUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    usdEl.textContent = text;
    [usdEl, azlEl].forEach((el) => {
      if (!el) return;
      el.classList.toggle("rd-wallet-balance-ready", ready);
      el.classList.toggle("rd-wallet-balance-caution", caution);
      el.classList.toggle("rd-wallet-balance-warning", critical);
    });
  }

  function renderBalances(b) {
    balances = b;
    const usdcEl = $("rd-bal-usdc-wallet");
    if (usdcEl) usdcEl.textContent = fmtUsdc(b.usdcWallet);
    const azlEl = $("rd-bal-azl");
    if (azlEl) azlEl.textContent = fmtAzl(b.azlWallet);
    const ethEl = $("rd-bal-eth");
    if (ethEl) ethEl.textContent = fmtEth(b.eth);
    renderVaultLane("standard", vaultOf(b, "standard"));
    renderVaultLane("micro", vaultOf(b, "micro"));
    applyVaultUi();

    const status = $("rd-wallet-status");
    if (status && b.partial) {
      status.textContent = "Some Base token reads are delayed — retrying automatically.";
      status.classList.remove("ok");
      status.classList.add("busy");
    }
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
    return el;
  }

  function netPoint(el, page) {
    const a = el.getBoundingClientRect();
    const b = page.getBoundingClientRect();
    return {
      x: a.left - b.left + a.width / 2,
      y: a.top - b.top + Math.min(18, a.height / 2),
    };
  }

  function curve(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lift = Math.max(18, Math.min(56, Math.abs(dx) * 0.18));
    return (
      "M" +
      a.x.toFixed(1) +
      " " +
      a.y.toFixed(1) +
      " C" +
      (a.x + dx * 0.28).toFixed(1) +
      " " +
      (a.y + dy * 0.12 - lift).toFixed(1) +
      " " +
      (a.x + dx * 0.72).toFixed(1) +
      " " +
      (b.y - dy * 0.12 + lift * 0.35).toFixed(1) +
      " " +
      b.x.toFixed(1) +
      " " +
      b.y.toFixed(1)
    );
  }

  function seedMesh(g, w, h) {
    g.replaceChildren();
    const count = 18;
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const t = (i * 0.6180339887) % 1;
      nodes.push({
        x: 18 + ((t * 97.3) % 1) * (w - 36),
        y: 16 + ((t * 53.1 + i * 0.13) % 1) * (h - 32),
      });
    }
    nodes.forEach((node, i) => {
      const next = nodes[(i + 3) % nodes.length];
      const line = svgEl("path", {
        class: "rd-wallet-net-mesh-line",
        d: "M" + node.x.toFixed(1) + " " + node.y.toFixed(1) + " L" + next.x.toFixed(1) + " " + next.y.toFixed(1),
      });
      g.appendChild(line);
      g.appendChild(svgEl("circle", { class: "rd-wallet-net-mesh-node", cx: node.x, cy: node.y, r: i % 4 === 0 ? 2.2 : 1.15 }));
    });
  }

  function drawWalletNet() {
    const page = $("rd-wallet-page");
    const svg = $("rd-wallet-net");
    if (!page || !svg) return;
    const w = page.offsetWidth;
    const h = page.offsetHeight;
    if (w < 8 || h < 8) return;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    const mesh = svg.querySelector(".rd-wallet-net-mesh");
    const links = svg.querySelector(".rd-wallet-net-links");
    const nodes = svg.querySelector(".rd-wallet-net-nodes");
    if (!mesh || !links || !nodes) return;
    seedMesh(mesh, w, h);
    links.replaceChildren();
    nodes.replaceChildren();
    const pts = {};
    page.querySelectorAll("[data-net-node]").forEach((el) => {
      if (el.hidden || el.closest("[hidden]")) return;
      pts[el.getAttribute("data-net-node")] = netPoint(el, page);
    });
    const edges = [
      ["receive", "swap"],
      ["swap", "usdc"],
      ["swap", "azl"],
      ["swap", "eth"],
      ["onramp", "usdc"],
      ["usdc", "vault-standard"],
      ["usdc", "vault-micro"],
      ["azl", "eth"],
    ];
    edges.forEach(([from, to]) => {
      if (!pts[from] || !pts[to]) return;
      links.appendChild(
        svgEl("path", {
          class: "rd-wallet-net-link",
          d: curve(pts[from], pts[to]),
          stroke: "url(#rd-wallet-net-stroke)",
          fill: "none",
        })
      );
    });
    if (pts["vault-standard"] && pts["vault-micro"]) {
      links.appendChild(
        svgEl("path", {
          class: "rd-wallet-net-link is-gap",
          d: curve(pts["vault-standard"], pts["vault-micro"]),
          stroke: "url(#rd-wallet-net-stroke)",
          fill: "none",
        })
      );
    }
    Object.values(pts).forEach((pt) => {
      nodes.appendChild(svgEl("circle", { class: "rd-wallet-net-ring", cx: pt.x, cy: pt.y, r: 7 }));
      nodes.appendChild(svgEl("circle", { class: "rd-wallet-net-node", cx: pt.x, cy: pt.y, r: 2.4 }));
    });
  }

  function swapPair() {
    return {
      from: $("rd-swap-from")?.value || "usdc",
      to: $("rd-swap-to")?.value || "azl",
      amount: $("rd-swap-amount")?.value || "",
    };
  }

  function setSwapQuote(text, kind) {
    const el = $("rd-swap-quote");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-ok", kind === "ok");
    el.classList.toggle("is-err", kind === "err");
  }

  function showSwap(on) {
    const panel = $("rd-wallet-swap");
    if (panel) panel.hidden = !on;
    requestAnimationFrame(drawWalletNet);
  }

  function syncSwapButton() {
    const btn = $("rd-swap-btn");
    if (!btn) return;
    btn.textContent = swapBusy ? "Swapping…" : "Swap";
    btn.disabled = Boolean(swapBusy);
  }

  function withTimeout(promise, ms, message) {
    let timer = 0;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  async function callSwap(payload, externalSignal) {
    const meta = window.azzleWalletMeta || {};
    const accessToken =
      typeof window.azzleGetAccessToken === "function"
        ? await window.azzleGetAccessToken()
        : null;
    if (!accessToken) throw new Error("Sign in again before using swaps.");
    if (externalSignal?.aborted) {
      throw Object.assign(new Error("Swap request cancelled."), { name: "AbortError" });
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 25000);
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    let res;
    try {
      res = await fetch("/api/wallet-swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({
          address: walletAddress || meta.address,
          ...payload,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        if (externalSignal?.aborted) throw e;
        throw new Error("Swap request timed out. Try again.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || "Swap request failed.";
      throw new Error(data.detail && data.detail !== msg ? msg + " — " + data.detail : msg);
    }
    return data;
  }

  async function refreshSwapQuote() {
    const { from, to, amount } = swapPair();
    const out = $("rd-swap-out");
    const seq = ++swapQuoteSeq;
    if (swapQuoteAbort) swapQuoteAbort.abort();
    const abort = new AbortController();
    swapQuoteAbort = abort;
    syncSwapButton();
    if (from === to) {
      if (out) out.textContent = "—";
      setSwapQuote("Pick two different tokens.", "err");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      if (out) out.textContent = "—";
      setSwapQuote("Enter an amount for a live quote.");
      return;
    }
    if (walletClientType && walletClientType !== "privy") {
      setSwapQuote("Swap runs on the Azzle embedded wallet. Sign in with email to swap on Base.");
      return;
    }
    setSwapQuote("Fetching quote…");
    try {
      const data = await callSwap({ action: "quote", from, to, amount }, abort.signal);
      if (seq !== swapQuoteSeq) return;
      const quote = data.quote || {};
      if (out) out.textContent = (quote.estOutputDisplay || "—") + " " + to.toUpperCase();
      setSwapQuote(
        "≈ " +
          quote.estOutputDisplay +
          " " +
          to.toUpperCase() +
          " after fees · min " +
          quote.minOutputDisplay +
          " " +
          to.toUpperCase(),
        "ok"
      );
    } catch (e) {
      if (seq !== swapQuoteSeq || abort.signal.aborted) return;
      if (out) out.textContent = "—";
      setSwapQuote((e && e.message) || "Could not quote this pair.", "err");
    }
  }

  function scheduleSwapQuote() {
    clearTimeout(swapQuoteTimer);
    swapQuoteTimer = setTimeout(refreshSwapQuote, 550);
  }

  async function pollSwap(actionId, from, to) {
    const started = Date.now();
    while (Date.now() - started < 45000) {
      const data = await callSwap({ action: "status", actionId, from, to });
      if (data.succeeded) return data;
      if (data.failed) throw new Error(data.failure || "Swap " + (data.status || "failed") + ".");
      setSwapQuote("Swap " + (data.status || "pending") + "…");
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
    throw new Error("Swap is still pending — check the wallet again in a moment.");
  }

  async function enableSwaps() {
    if (typeof window.azzleEnableSwaps !== "function") {
      throw new Error("Sign in with the Azzle embedded wallet to enable swaps.");
    }
    setSwapQuote("Finish the Privy prompt to enable swaps…");
    await withTimeout(
      window.azzleEnableSwaps(),
      90000,
      "Privy prompt timed out. Close it if it is still open, then click Enable swaps again."
    );
    walletDelegated = true;
    syncSwapButton();
    setSwapQuote("Swaps enabled. Click Swap to submit the quote.", "ok");
    scheduleSwapQuote();
  }

  async function submitSwap() {
    const { from, to, amount } = swapPair();
    setSwapQuote("Getting a fresh quote…");
    const quoted = await callSwap({ action: "quote", from, to, amount });
    if (!quoted?.signRequest) throw new Error("Swap did not return a Privy authorization payload.");
    if (typeof window.azzleSignWalletApi !== "function") {
      throw new Error("Sign in with the Azzle embedded wallet to authorize the swap.");
    }
    setSwapQuote("Authorize the swap in Privy…");
    const signed = await withTimeout(
      window.azzleSignWalletApi(quoted.signRequest),
      90000,
      "Privy authorization timed out. Close the prompt if it is still open, then try Swap again."
    );
    const signature = signed?.signature || signed;
    if (!signature) throw new Error("Privy did not return a swap signature.");
    setSwapQuote("Submitting swap…");
    const started = await callSwap({
      action: "execute",
      from,
      to,
      amount,
      authorizationSignature: signature,
      swapPayload: quoted.signRequest.body,
    });
    if (!started?.actionId) throw new Error("Swap did not start. Try again.");
    setSwapQuote("Swap submitted — waiting for confirmation…");
    const done = await pollSwap(started.actionId, from, to);
    setSwapQuote(
      "Swapped to " + (done.outputDisplay ? done.outputDisplay + " " : "") + to.toUpperCase() + ".",
      "ok"
    );
    await refresh();
  }

  async function runSwap() {
    if (swapBusy) return;
    const { from, to, amount } = swapPair();
    if (walletClientType && walletClientType !== "privy") {
      setSwapQuote("Swap runs on the Azzle embedded wallet. Sign in with email to swap on Base.", "err");
      return;
    }
    if (from === to) {
      setSwapQuote("Pick two different tokens.", "err");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setSwapQuote("Enter an amount to swap.", "err");
      return;
    }
    swapBusy = true;
    syncSwapButton();
    try {
      await submitSwap();
    } catch (e) {
      setSwapQuote((e && e.message) || "Swap failed.", "err");
    } finally {
      swapBusy = false;
      syncSwapButton();
    }
  }

  function initSwap() {
    syncSwapButton();
    ["rd-swap-from", "rd-swap-to", "rd-swap-amount"].forEach((id) => {
      $(id)?.addEventListener("input", scheduleSwapQuote);
      $(id)?.addEventListener("change", scheduleSwapQuote);
    });
    $("rd-swap-flip")?.addEventListener("click", () => {
      const from = $("rd-swap-from");
      const to = $("rd-swap-to");
      if (!from || !to) return;
      const nextFrom = to.value;
      to.value = from.value;
      from.value = nextFrom;
      scheduleSwapQuote();
    });
    $("rd-swap-btn")?.addEventListener("click", () => {
      runSwap();
    });
  }

  function setOnrampHint(text, kind) {
    const el = $("rd-onramp-hint");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-ok", kind === "ok");
    el.classList.toggle("is-err", kind === "err");
  }

  function syncOnrampButton() {
    const btn = $("rd-onramp-btn");
    if (!btn) return;
    btn.textContent = onrampBusy ? "Opening…" : "Buy USDC";
    btn.disabled = Boolean(onrampBusy);
  }

  function onrampWasClosed(err) {
    const msg = String((err && err.message) || err || "").toLowerCase();
    return /closed|cancel|exit|dismiss|user exited/.test(msg);
  }

  async function buyUsdc() {
    if (onrampBusy) return;
    if (!walletAddress) {
      setStatus("Sign in first.", "err");
      return;
    }
    if (typeof window.azzleFundUsdc !== "function") {
      setOnrampHint("Sign in with Privy to buy USDC.", "err");
      return;
    }
    const amount = String($("rd-onramp-amt")?.value || "50").trim();
    if (!amount || Number(amount) <= 0) {
      setOnrampHint("Enter an amount.", "err");
      return;
    }
    onrampBusy = true;
    syncOnrampButton();
    setOnrampHint("Starting card onramp…");
    setStatus("Opening card onramp…", "busy");
    try {
      const result = await window.azzleFundUsdc({ amount });
      if (result?.status === "confirmed") {
        setOnrampHint("Purchase confirmed. Refreshing balances…", "ok");
        setStatus("USDC purchase confirmed.", "ok");
        await refresh();
      } else if (result?.status === "submitted") {
        setOnrampHint("Submitted. USDC can take a minute to arrive.", "ok");
        setStatus("Onramp submitted — waiting for USDC.", "ok");
        await refresh();
      }
    } catch (e) {
      if (onrampWasClosed(e)) {
        setOnrampHint("Onramp closed. You can try again.");
        setStatus("Onramp closed.");
      } else {
        setOnrampHint((e && e.message) || "Could not start onramp.", "err");
        setStatus((e && e.message) || "Onramp failed", "err");
      }
    } finally {
      onrampBusy = false;
      syncOnrampButton();
    }
  }

  function initOnramp() {
    syncOnrampButton();
    $("rd-onramp-btn")?.addEventListener("click", () => {
      buyUsdc();
    });
  }

  async function copyAddress() {
    const addr = walletAddress || $("rd-wallet-address")?.textContent?.trim();
    if (!addr) {
      setStatus("Sign in first.", "err");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        throw new Error("clipboard unavailable");
      }
      setStatus("Address copied.", "ok");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = addr;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      setStatus(ok ? "Address copied." : "Could not copy address", ok ? "ok" : "err");
    }
  }

  async function refresh() {
    const grid = $("rd-wallet-grid");
    const poster = api();

    if (walletAddress) showReceive(walletAddress);

    if (!poster?.ready) {
      setStatus("Loading wallet…");
      if (grid) grid.hidden = true;
      showSwap(false);
      return;
    }

    if (!walletAddress) {
      setStatus("Sign in (top right) to view balances.");
      if (grid) grid.hidden = true;
      showSwap(false);
      const receive = $("rd-wallet-receive");
      if (receive) receive.hidden = true;
      return;
    }

    try {
      const b = await poster.getWalletBalances();
      if (!b.configured) {
        setStatus("Server missing contract config.", "err");
        return;
      }
      renderBalances(b);
      showReceive(b.address || walletAddress);
      if (grid) grid.hidden = false;
      showSwap(true);
      setStatus("Balances on Base · updated just now", "ok");
      requestAnimationFrame(drawWalletNet);
    } catch (e) {
      setStatus((e && e.message) || "Could not load balances", "err");
    }
  }

  async function runAction(fn) {
    if (busy) return;
    const poster = api();
    if (!walletAddress || !poster) {
      setStatus("Sign in first.", "err");
      return;
    }
    busy = true;
    setStatus("Confirm in your wallet…", "busy");
    try {
      await fn(poster, (msg) => setStatus(msg, "busy"));
      setStatus("Done — refreshing balances…", "ok");
      await refresh();
    } catch (e) {
      setStatus((e && e.message) || "Transaction failed", "err");
    } finally {
      busy = false;
    }
  }

  function init() {
    initSwap();
    initOnramp();
    const page = $("rd-wallet-page");
    if (page && typeof ResizeObserver === "function") {
      new ResizeObserver(() => drawWalletNet()).observe(page);
    }
    window.addEventListener("resize", () => drawWalletNet());
    requestAnimationFrame(drawWalletNet);

    $("rd-wallet-copy")?.addEventListener("click", () => {
      copyAddress();
    });
    $("rd-wallet-address")?.addEventListener("click", () => {
      copyAddress();
    });

    function closeQrModal() {
      const modal = $("rd-wallet-qr-modal");
      if (modal) modal.hidden = true;
    }

    async function openQrModal() {
      const addr = walletAddress || $("rd-wallet-address")?.textContent?.trim();
      if (!addr) {
        setStatus("Sign in first.", "err");
        return;
      }
      const modal = $("rd-wallet-qr-modal");
      const mount = $("rd-wallet-qr-canvas");
      const addrEl = $("rd-wallet-qr-address");
      if (!modal || !mount || !addrEl) return;

      mount.innerHTML = "";
      addrEl.textContent = addr;
      modal.hidden = false;

      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Wallet address QR code");
      mount.appendChild(canvas);

      try {
        if (typeof window.azzleRenderQr !== "function") {
          throw new Error("QR helper not loaded");
        }
        await window.azzleRenderQr(canvas, addr);
      } catch (e) {
        mount.innerHTML = "";
        mount.textContent = "Could not generate QR code.";
      }
    }

    $("rd-wallet-qr-btn")?.addEventListener("click", () => {
      openQrModal();
    });
    $("rd-wallet-qr-close")?.addEventListener("click", closeQrModal);
    $("rd-wallet-qr-backdrop")?.addEventListener("click", closeQrModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("rd-wallet-qr-modal")?.hidden) closeQrModal();
    });

    const depositCurrencyNotes = {
      usdc: "USDC converts to AZL through AzlPaymentGatewayV2.",
      eth: "ETH converts to AZL through fundWithEth() on the payment gateway.",
    };
    document.querySelectorAll("[data-deposit-currency]").forEach((button) => {
      button.addEventListener("click", () => {
        const currency = button.dataset.depositCurrency || "usdc";
        document.querySelectorAll("[data-deposit-currency]").forEach((tab) => {
          const selected = tab === button;
          tab.classList.toggle("is-selected", selected);
          tab.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        const note = $("rd-wallet-currency-note");
        if (note) note.textContent = depositCurrencyNotes[currency] || depositCurrencyNotes.usdc;
        const depositButton = $("rd-usdc-deposit-btn");
        if (depositButton) {
          depositButton.textContent =
            currency === "usdc" ? "Fund collateral" : `Fund with ${currency.toUpperCase()}`;
          depositButton.disabled = false;
        }
        applyVaultUi();
      });
    });

    document.querySelectorAll("[data-vault-market]").forEach((button) => {
      button.addEventListener("click", () => {
        vaultMarket = button.dataset.vaultMarket === "micro" ? "micro" : "standard";
        document.querySelectorAll("[data-vault-market]").forEach((tab) => {
          const on = tab === button;
          tab.classList.toggle("on", on);
          tab.setAttribute("aria-pressed", on ? "true" : "false");
        });
        applyVaultUi();
      });
    });

    $("rd-usdc-deposit-btn")?.addEventListener("click", () => {
      const amt = parseFloat($("rd-usdc-deposit-amt")?.value ?? "0");
      const currency = document.querySelector("[data-deposit-currency].is-selected")?.dataset.depositCurrency ?? "usdc";
      runAction((p, onProgress) =>
        currency === "eth"
          ? p.fundWithEth(amt, onProgress, vaultMarket)
          : p.fundCollateral(amt, onProgress, vaultMarket)
      );
    });

    $("rd-usdc-withdraw-max")?.addEventListener("click", () => {
      const lane = vaultOf(balances, vaultMarket);
      if (lane?.maxVaultWithdraw) {
        $("rd-usdc-withdraw-amt").value = lane.maxVaultWithdraw;
      }
    });

    $("rd-usdc-withdraw-btn")?.addEventListener("click", () => {
      const amt = parseFloat($("rd-usdc-withdraw-amt")?.value ?? "0");
      runAction((p, onProgress) => p.withdrawCollateral(amt, onProgress, vaultMarket));
    });

    $("rd-usdc-send-btn")?.addEventListener("click", () => {
      const to = $("rd-usdc-send-to")?.value ?? "";
      const amt = parseFloat($("rd-usdc-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendUsdc(to, amt, onProgress));
    });

    $("rd-azl-send-btn")?.addEventListener("click", () => {
      const to = $("rd-azl-send-to")?.value ?? "";
      const amt = parseFloat($("rd-azl-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendAzl(to, amt, onProgress));
    });

    $("rd-eth-send-btn")?.addEventListener("click", () => {
      const to = $("rd-eth-send-to")?.value ?? "";
      const amt = parseFloat($("rd-eth-send-amt")?.value ?? "0");
      runAction((p, onProgress) => p.sendEth(to, amt, onProgress));
    });

    $("rd-wallet-signout")?.addEventListener("click", () => {
      if (typeof window.azzleLogout === "function") window.azzleLogout();
    });

    refresh();
    setInterval(() => {
      if (!busy && walletAddress) refresh();
    }, 30000);
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    walletClientType = e.detail?.walletClientType ?? window.azzleWalletMeta?.walletClientType ?? null;
    const nextDelegated = Boolean(
      e.detail?.walletDelegated ?? window.azzleWalletMeta?.walletDelegated
    );
    if (!walletAddress) walletDelegated = false;
    else if (nextDelegated) walletDelegated = true;
    syncSwapButton();
    if (walletAddress) showReceive(walletAddress);
    refresh();
  });
  window.addEventListener("azzle-poster-ready", () => refresh());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
