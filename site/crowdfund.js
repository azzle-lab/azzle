(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const onCrowdPage = () => document.body?.dataset.page === "crowdfund";

  function inviteUrl(id) {
    const url = new URL("/crowdfund", window.location.origin);
    if (id) url.searchParams.set("crowd", id);
    return url;
  }

  (function sendOldInviteToCrowdfund() {
    const params = new URLSearchParams(window.location.search);
    const crowd = params.get("crowd");
    if (!crowd || params.get("view") !== "collaborative") return;
    if (!/\/market\/?$/.test(window.location.pathname)) return;
    const next = inviteUrl(crowd);
    window.location.replace(next.pathname + next.search);
  })();
  let campaigns = [];
  let openId = null;
  let wallet = "";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function setStatus(text, kind) {
    const el = $("rd-crowd-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("ok", "err");
    if (kind) el.classList.add(kind);
  }

  function shortWallet(addr) {
    if (!addr || addr.length < 10) return "Wallet not set";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The bounty board did not respond.");
    return data;
  }

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function requirePoster() {
    const api = posterApi();
    if (!api?.ready || !api.address || typeof api.createCrowdfund !== "function") {
      throw new Error("Connect your wallet.");
    }
    return api;
  }

  async function recordBoard(body) {
    let last;
    for (let i = 0; i < 3; i += 1) {
      try {
        return await api("/api/market/crowdfund", { method: "POST", body: JSON.stringify(body) });
      } catch (err) {
        last = err;
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
      }
    }
    throw last;
  }

  function setBusy(form, busy) {
    form?.querySelectorAll("button[type='submit']").forEach((button) => {
      button.disabled = Boolean(busy);
    });
  }

  async function load() {
    const data = await api("/api/market/crowdfund");
    campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  }

  function sessionWallet() {
    const address = window.azzleWalletMeta?.address;
    return address ? String(address).toLowerCase() : "";
  }

  function fillWallet(input) {
    if (!input || !wallet) return;
    if (!input.value || input.readOnly) input.value = wallet;
    input.readOnly = true;
  }

  function adoptWallet(address) {
    wallet = address ? String(address).toLowerCase() : sessionWallet();
    document.querySelectorAll("#rd-crowd-create input[name='openerWallet'], #rd-crowd-join input[name='wallet']").forEach((input) => {
      if (wallet) {
        fillWallet(input);
        return;
      }
      if (input.readOnly) {
        input.readOnly = false;
        input.value = "";
      }
    });
    paintWalletPrompt();
  }

  function paintWalletPrompt() {
    const connected = Boolean(wallet);
    document.querySelectorAll("[data-crowd-connect]").forEach((button) => {
      button.hidden = connected;
    });
    document.querySelectorAll("[data-crowd-wallet-known]").forEach((node) => {
      node.hidden = !connected;
      node.textContent = connected ? shortWallet(wallet) : "";
    });
  }

  function connectWallet() {
    document.querySelector(".rd-wallet-btn")?.click();
  }

  function openCampaign(id) {
    const campaign = campaigns.find((item) => item.id === id);
    if (!campaign) return;
    openId = id;
    if (onCrowdPage()) {
      const url = inviteUrl(id);
      history.replaceState(null, "", url.pathname + url.search);
    }
    renderDetail(campaign);
  }

  function renderList() {
    const list = $("rd-crowd-list");
    const detail = $("rd-crowd-detail");
    if (!list || !detail) return;
    detail.hidden = true;
    list.hidden = false;
    if (!campaigns.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = campaigns.map((campaign) => `
      <button type="button" class="rd-crowd-row" data-crowd-open="${esc(campaign.id)}">
        <span class="rd-crowd-row-title">${esc(campaign.title)}</span>
        <span class="rd-crowd-row-meta">${esc(campaign.pledgedAzl)} / ${esc(campaign.totalAzl)} AZL · ${esc(campaign.signaturesLabel)}</span>
      </button>
    `).join("");
  }

  function renderDetail(campaign) {
    const list = $("rd-crowd-list");
    const detail = $("rd-crowd-detail");
    if (!list || !detail) return;
    list.hidden = true;
    detail.hidden = false;
    closeCreate();
    const yours = wallet && campaign.members.some((member) => member.wallet === wallet.toLowerCase());
    const isOpener = wallet && campaign.opener.wallet === wallet.toLowerCase();
    const members = [
      `<li><span>${esc(campaign.opener.name)}</span><small>${esc(shortWallet(campaign.opener.wallet))} · ${esc(campaign.opener.amountAzl)} AZL</small></li>`,
      ...campaign.members.map((member) => `
        <li><span>${esc(member.name)}</span><small>${esc(shortWallet(member.wallet))} · ${esc(member.amountAzl)} AZL</small></li>
      `),
    ].join("");
    let action = "";
    if (yours) {
      action = `
        <form id="rd-crowd-contribute" class="rd-crowd-form">
          <label class="rd-field"><span>Add AZL</span><input name="amountAzl" required inputmode="decimal"/></label>
          <button type="submit" class="rd-action">Add AZL</button>
          <p class="rd-crowd-form-error" id="rd-crowd-contribute-error"></p>
        </form>
        <form id="rd-crowd-leave" class="rd-crowd-form">
          <input type="hidden" name="wallet" value="${esc(wallet)}"/>
          <p class="rd-crowd-leave-note">Removes you from this bounty. The Safe sends your AZL back.</p>
          <button type="submit" class="rd-action">Leave</button>
          <p class="rd-crowd-form-error" id="rd-crowd-leave-error"></p>
        </form>`;
    } else if (isOpener) {
      action = `
        <form id="rd-crowd-contribute" class="rd-crowd-form">
          <label class="rd-field"><span>Add AZL</span><input name="amountAzl" required inputmode="decimal"/></label>
          <button type="submit" class="rd-action">Add AZL</button>
          <p class="rd-crowd-form-error" id="rd-crowd-contribute-error"></p>
        </form>`;
    } else {
      action = `
        <form id="rd-crowd-join" class="rd-crowd-form">
          <label class="rd-field"><span>Name</span><input name="name" required maxlength="40"/></label>
          <button type="button" class="rd-crowd-connect" data-crowd-connect>Connect your wallet</button>
          <p class="rd-crowd-wallet-known" data-crowd-wallet-known hidden></p>
          <input type="hidden" name="wallet" value=""/>
          <label class="rd-field"><span>Pledge AZL</span><input name="amountAzl" required inputmode="decimal"/></label>
          <button type="submit" class="rd-action rd-action--primary">Join</button>
          <p class="rd-crowd-form-error" id="rd-crowd-join-error"></p>
        </form>`;
    }
    detail.innerHTML = `
      <button type="button" class="rd-crowd-back" id="rd-crowd-back">Back</button>
      <h2>${esc(campaign.title)}</h2>
      <p class="rd-crowd-brief">${esc(campaign.brief)}</p>
      <p class="rd-crowd-figures"><strong>${esc(campaign.pledgedAzl)}</strong> / ${esc(campaign.totalAzl)} AZL<span>${esc(campaign.signaturesLabel)}</span></p>
      ${campaign.safe ? `<p class="rd-crowd-safe"><a href="https://basescan.org/address/${esc(campaign.safe)}" target="_blank" rel="noopener noreferrer">Poster Safe</a></p>` : ""}
      <ol class="rd-crowd-members">${members}</ol>
      <div class="rd-crowd-actions">
        <button type="button" class="rd-action" id="rd-crowd-invite">Copy link</button>
        <p id="rd-crowd-invite-note"></p>
      </div>
      ${action}
    `;
    const walletInput = detail.querySelector('input[name="wallet"]');
    adoptWallet();
    $("rd-crowd-back")?.addEventListener("click", () => {
      openId = null;
      const url = new URL(window.location.href);
      url.searchParams.delete("crowd");
      history.replaceState(null, "", url.pathname + url.search);
      renderList();
    });
    $("rd-crowd-invite")?.addEventListener("click", async () => {
      const url = inviteUrl(campaign.id);
      try {
        await navigator.clipboard.writeText(url.toString());
        $("rd-crowd-invite-note").textContent = "Invite link copied.";
      } catch {
        $("rd-crowd-invite-note").textContent = url.toString();
      }
    });
    $("rd-crowd-join")?.addEventListener("submit", (event) => submitJoin(event, campaign));
    $("rd-crowd-leave")?.addEventListener("submit", (event) => submitLeave(event, campaign));
    $("rd-crowd-contribute")?.addEventListener("submit", (event) => submitContribute(event, campaign));
  }

  async function show(id) {
    const panel = $("rd-market-panel-collaborative");
    if (!panel || (panel.hidden && !onCrowdPage())) return;
    setStatus("");
    try {
      await load();
      const wanted = id || openId || new URLSearchParams(window.location.search).get("crowd");
      openId = wanted && campaigns.some((campaign) => campaign.id === wanted) ? wanted : null;
      if (openId) renderDetail(campaigns.find((campaign) => campaign.id === openId));
      else renderList();
      setStatus(campaigns.length ? `${campaigns.length}` : "", campaigns.length ? "ok" : undefined);
    } catch (error) {
      setStatus(error.message, "err");
    }
  }

  const BUDGET_MIN = 0.6;
  const BUDGET_MAX = 10000;
  const BUDGET_STEPS = 1000;
  let azlPriceUsd = null;

  function marketForUsd(usd) {
    if (window.AZZLE_MARKETS?.marketForBudget) return window.AZZLE_MARKETS.marketForBudget(usd);
    return Number(usd) > 50 ? "standard" : "micro";
  }

  function moneyUsd(n) {
    if (window.AZZLE_MARKETS?.money) return window.AZZLE_MARKETS.money(n);
    const value = Number(n);
    if (value >= 1000) return "$" + value.toLocaleString("en-US");
    if (Number.isInteger(value)) return "$" + value;
    return "$" + value.toFixed(2);
  }

  function usdFromSlider(step) {
    const x = Number(step) / BUDGET_STEPS;
    const usd = BUDGET_MIN * Math.pow(BUDGET_MAX / BUDGET_MIN, x);
    if (usd >= 50) return Math.round(usd);
    if (usd >= 10) return Math.round(usd * 10) / 10;
    return Math.round(usd * 100) / 100;
  }

  function azlFromUsd(usd) {
    if (!azlPriceUsd || azlPriceUsd <= 0) return "";
    return (usd / azlPriceUsd).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function paintBudget(form) {
    if (!form) return;
    const range = form.querySelector(".rd-crowd-budget-range");
    if (!range || !form.elements.market || !form.elements.totalAzl) return;
    const usd = usdFromSlider(range.value);
    const market = marketForUsd(usd);
    const azl = azlFromUsd(usd);
    form.elements.market.value = market;
    form.elements.totalAzl.value = azl;
    const usdNode = form.querySelector("[data-crowd-usd]");
    if (usdNode) usdNode.textContent = moneyUsd(usd);
    const marketNode = form.querySelector("[data-crowd-market-label]");
    if (marketNode) marketNode.textContent = market === "micro" ? "Micro" : "Standard";
    const azlNode = form.querySelector("[data-crowd-azl]");
    if (!azlNode) return;
    if (!azl) {
      azlNode.textContent = azlPriceUsd ? "" : "AZL quote loading";
      return;
    }
    azlNode.textContent = Number(azl).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " AZL";
  }

  function closeCreate() {
    const modal = $("rd-crowd-modal");
    if (modal) {
      if (modal.open) modal.close();
      $("rd-crowd-new")?.setAttribute("aria-expanded", "false");
      return;
    }
    const form = $("rd-crowd-create");
    if (form) form.hidden = true;
  }

  function openCreate() {
    const modal = $("rd-crowd-modal");
    const form = $("rd-crowd-create");
    if (!modal || !form) return;
    if (!modal.open) modal.showModal();
    $("rd-crowd-new")?.setAttribute("aria-expanded", "true");
    paintBudget(form);
    adoptWallet();
    form.querySelector("input[name='title']")?.focus();
  }

  function bindBudget(form) {
    const range = form?.querySelector(".rd-crowd-budget-range");
    if (!range) return;
    range.addEventListener("input", () => paintBudget(form));
    paintBudget(form);
  }

  async function submitCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $("rd-crowd-create-error");
    error.textContent = "";
    paintBudget(form);
    if (!form.elements.totalAzl?.value) {
      error.textContent = "AZL quote is not ready.";
      return;
    }
    let poster;
    try {
      poster = requirePoster();
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    const body = Object.fromEntries(new FormData(form).entries());
    body.openerWallet = poster.address;
    setBusy(form, true);
    error.textContent = "Confirm in wallet.";
    try {
      const live = await poster.createCrowdfund({
        market: body.market,
        totalAzl: body.totalAzl,
        minJoinAzl: body.minJoinAzl,
        openerAmountAzl: body.openerAmountAzl,
        onProgress: (text) => {
          error.textContent = text;
        },
      });
      body.action = "create";
      body.safe = live.safe;
      body.module = live.module;
      body.guard = live.guard;
      body.createTx = live.createTx;
      body.openerAmountAzl = live.openerAmountAzl;
      let data;
      try {
        data = await recordBoard(body);
      } catch (err) {
        error.textContent = "Safe is live. Recording the bounty failed. " + err.message;
        return;
      }
      form.reset();
      paintBudget(form);
      fillWallet(form.elements.openerWallet);
      openId = data.campaign.id;
      if (onCrowdPage()) {
        const url = inviteUrl(openId);
        history.replaceState(null, "", url.pathname + url.search);
        closeCreate();
        await show(openId);
        if (live.pledgeError) setStatus(live.pledgeError, "err");
      } else {
        window.location.assign(inviteUrl(openId).toString());
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(form, false);
    }
  }

  async function submitJoin(event, campaign) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    const error = $("rd-crowd-join-error");
    error.textContent = "";
    let poster;
    try {
      poster = requirePoster();
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    if (!campaign.module) {
      error.textContent = "This bounty is not on-chain.";
      return;
    }
    setBusy(form, true);
    error.textContent = "Confirm in wallet.";
    try {
      await poster.joinCrowdfund({
        module: campaign.module,
        amountAzl: body.amountAzl,
        onProgress: (text) => {
          error.textContent = text;
        },
      });
      let data;
      try {
        data = await recordBoard({
          action: "join",
          id: campaign.id,
          name: body.name,
          wallet: poster.address,
          amountAzl: body.amountAzl,
        });
      } catch (err) {
        if (!/already on this bounty/.test(err.message)) throw err;
        data = { campaign };
      }
      wallet = String(poster.address).toLowerCase();
      openId = data.campaign.id;
      await show(openId);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(form, false);
    }
  }

  async function submitLeave(event, campaign) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $("rd-crowd-leave-error");
    error.textContent = "";
    let poster;
    try {
      poster = requirePoster();
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    setBusy(form, true);
    error.textContent = "Confirm in wallet.";
    try {
      await poster.leaveCrowdfund({
        module: campaign.module,
        onProgress: (text) => {
          error.textContent = text;
        },
      });
      let data;
      try {
        data = await recordBoard({
          action: "leave",
          id: campaign.id,
          wallet: poster.address,
        });
      } catch (err) {
        if (!/not a contributor/.test(err.message)) throw err;
        data = { campaign };
      }
      openId = data.campaign.id;
      await show(openId);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(form, false);
    }
  }

  async function submitContribute(event, campaign) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    const error = $("rd-crowd-contribute-error");
    error.textContent = "";
    let poster;
    try {
      poster = requirePoster();
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    setBusy(form, true);
    error.textContent = "Confirm in wallet.";
    try {
      await poster.contributeCrowdfund({
        module: campaign.module,
        amountAzl: body.amountAzl,
        onProgress: (text) => {
          error.textContent = text;
        },
      });
      const data = await recordBoard({
        action: "contribute",
        id: campaign.id,
        wallet: poster.address,
        amountAzl: body.amountAzl,
      });
      openId = data.campaign.id;
      await show(openId);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setBusy(form, false);
    }
  }

  window.azzleCrowdfund = {
    show,
    onView(view) {
      if (view === "collaborative") show();
    },
  };

  function passCount(n) {
    return Math.floor((3 * n + 4) / 5);
  }

  function paintJoinSlider(n) {
    const count = Math.max(1, Math.min(200, Number(n) || 1));
    const need = passCount(count);
    const swarm = $("rd-crowd-swarm");
    if (swarm) {
      swarm.replaceChildren(...Array.from({ length: count }, (_, index) => {
        const dot = document.createElement("i");
        if (index < need) dot.className = "on";
        return dot;
      }));
    }
    document.querySelectorAll("[data-pass]").forEach((node) => {
      node.textContent = `${need} of ${count}`;
    });
    const shown = $("rd-crowd-slide-n");
    if (shown) shown.textContent = String(count);
    const word = $("rd-crowd-slide-word");
    if (word) word.textContent = count === 1 ? "person contributing" : "people contributing";
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindBudget($("rd-crowd-create"));
    fetch("/api/azl/market", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("quote"))))
      .then((data) => {
        const price = Number(data?.oracle?.impliedPriceUsd || data?.market?.priceUsd);
        if (!Number.isFinite(price) || price <= 0) throw new Error("quote");
        azlPriceUsd = price;
        paintBudget($("rd-crowd-create"));
      })
      .catch(() => {
        const node = document.querySelector("[data-crowd-azl]");
        if (node && !azlPriceUsd) node.textContent = "AZL quote unavailable";
      });
    const slide = $("rd-crowd-slide");
    if (slide) {
      const draw = () => paintJoinSlider(slide.value);
      slide.addEventListener("input", draw);
      draw();
    }
    $("rd-crowd-create")?.addEventListener("submit", submitCreate);
    $("rd-crowd-new")?.addEventListener("click", openCreate);
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-crowd-connect]")) return;
      event.preventDefault();
      connectWallet();
    });
    $("rd-crowd-modal-close")?.addEventListener("click", closeCreate);
    $("rd-crowd-modal")?.addEventListener("click", (event) => {
      if (event.target === $("rd-crowd-modal")) closeCreate();
    });
    $("rd-crowd-modal")?.addEventListener("close", () => {
      $("rd-crowd-new")?.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", (event) => {
      const card = event.target.closest("[data-crowd-open]");
      if (!card) return;
      openCampaign(card.getAttribute("data-crowd-open"));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-crowd-open]");
      if (!card) return;
      event.preventDefault();
      openCampaign(card.getAttribute("data-crowd-open"));
    });
    adoptWallet();
    window.addEventListener("azzle-wallet-change", (event) => {
      adoptWallet(event.detail?.address || "");
    });
    window.addEventListener("azzle-poster-ready", () => adoptWallet());
    const params = new URLSearchParams(window.location.search);
    if (onCrowdPage()) {
      openId = params.get("crowd");
      show(openId);
    } else if (params.get("view") === "collaborative") {
      openId = params.get("crowd");
    }
  });
})();
