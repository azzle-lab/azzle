(function () {
  "use strict";

  const DRAFT_KEY = "azzle-task-draft";
  const TASK_ID_KEY = "azzle-last-task-id";
  const TIER_RANK = { free: 0, basic: 1, premium: 2, enterprise: 3 };

  let checkoutBusy = false;
  let walletAddress = null;
  let postingPlans = [];
  let currentQuota = null;
  let azlPreviews = {};
  let livePostReceipt = null;

  const $ = (id) => document.getElementById(id);

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 120) || "HTTP " + res.status);
    }
  }

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function selectedMarket() {
    return window.AZZLE_MARKETS?.getSelectedMarket?.() || "standard";
  }

  function withMarket(url) {
    return (window.AZZLE_MARKETS?.withMarket || String)(url);
  }

  function eco() {
    return window.AZZLE_MARKETS?.economics?.() || window.AZZLE_MARKETS?.ECONOMICS?.standard || {
      postingFloorUsd: 45, accessFeeUsd: 5, minTaskUsd: 6, maxTaskUsd: 10000, entryDepositUsd: 25, liveTaskReserveUsd: 8,
    };
  }

  function money(n) {
    return window.AZZLE_MARKETS?.money?.(n) || ("$" + n);
  }

  function budgetBounds(market) {
    const id = market || selectedMarket();
    const e = window.AZZLE_MARKETS?.economics?.(id) || eco();
    return {
      min: Number(e.minTaskUsd) || (id === "micro" ? 0.6 : 6),
      max: Number(e.maxTaskUsd) || (id === "micro" ? 50 : 10000),
    };
  }

  function formatBudget(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : String(v);
  }

  function applyMarketUi() {
    const budget = $("rd-task-budget");
    const bounds = budgetBounds();
    if (budget) {
      budget.min = String(bounds.min);
      budget.step = "0.01";
      // Keep the protocol cap so a Micro field can accept $50.01+ and autoswitch.
      budget.max = "10000";
      const value = Number(budget.value);
      if (Number.isFinite(value) && selectedMarket() === "micro" && value > 50) {
        budget.value = formatBudget(50);
      } else if (Number.isFinite(value) && value > bounds.max) {
        budget.value = formatBudget(bounds.max);
      } else if (
        Number.isFinite(value) &&
        value > 0 &&
        value < bounds.min &&
        selectedMarket() === "micro"
      ) {
        budget.value = formatBudget(bounds.min);
      }
    }
    window.AZZLE_MARKETS?.bindEconomics?.(document);
  }

  function switchToStandardForBudget(value) {
    const standardMax = budgetBounds("standard").max;
    const budget = $("rd-task-budget");
    if (budget && value > standardMax) budget.value = formatBudget(standardMax);
    window.AZZLE_MARKETS?.setSelectedMarket?.("standard");
    setCheckoutStatus("Budget over $50 — switched to Standard.", "ok");
    saveDraft(readDraftFromForm());
  }

  function switchToMicroForBudget(value) {
    const microMin = budgetBounds("micro").min;
    const budget = $("rd-task-budget");
    if (budget && value < microMin) budget.value = formatBudget(microMin);
    window.AZZLE_MARKETS?.setSelectedMarket?.("micro");
    setCheckoutStatus("Budget under $6 — switched to Micro.", "ok");
    saveDraft(readDraftFromForm());
  }

  function onBudgetTyped() {
    const budget = $("rd-task-budget");
    if (!budget) return;
    const raw = String(budget.value || "").trim();
    if (raw === "" || raw === "." || raw === "-") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    if (selectedMarket() === "micro" && value > 50) {
      switchToStandardForBudget(value);
      return;
    }

    // Decimal amounts under $6 are finished (5.5 cannot become 50). Whole numbers
    // like 5 wait for blur so 10 / 50 can still be typed on Standard.
    if (selectedMarket() === "standard" && value > 0 && value < 6 && raw.includes(".")) {
      switchToMicroForBudget(value);
      return;
    }

    const bounds = budgetBounds();
    if (value > bounds.max) budget.value = formatBudget(bounds.max);
  }

  function onBudgetCommit() {
    const budget = $("rd-task-budget");
    if (!budget) return;
    const raw = String(budget.value || "").trim();
    const value = Number(raw);

    if (selectedMarket() === "standard" && Number.isFinite(value) && value > 0 && value < 6) {
      switchToMicroForBudget(value);
      return;
    }

    const bounds = budgetBounds();
    if (!raw || !Number.isFinite(value) || value < bounds.min) {
      budget.value = formatBudget(bounds.min);
    } else if (value > bounds.max) {
      budget.value = formatBudget(bounds.max);
    }
    saveDraft(readDraftFromForm());
  }

  function saveDraft(draft) {
    const next = { ...draft };
    if (!next.market) next.market = selectedMarket();
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  }

  function loadDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {
      return null;
    }
  }

  const DISC_DETAIL = {
    open: "Scope is published onchain with the post so the market, agents, and MCP can read it.",
    private: "No onchain scope. Share the brief over XMTP with agents you choose.",
  };

  function syncScopeField() {
    const input = $("rd-task-scope");
    if (!input) return;
    const open = readDiscoveryOpen();
    input.disabled = !open;
    input.readOnly = !open;
    input.setAttribute("aria-disabled", open ? "false" : "true");
    input.placeholder = open
      ? "Describe the outcome…"
      : "Private listing — share the brief over XMTP. Onchain scope stays empty.";
    input.closest(".rd-field")?.classList.toggle("rd-field--off", !open);
  }

  function updateDiscGlider(seg) {
    const glider = seg.querySelector(".rd-disc-glider");
    const active = seg.querySelector(".rd-disc-tab.on");
    if (!glider || !active) return;
    glider.style.left = active.offsetLeft + "px";
    glider.style.top = active.offsetTop + "px";
    glider.style.width = active.offsetWidth + "px";
    glider.style.height = active.offsetHeight + "px";
    glider.style.opacity = "1";
  }

  function syncDiscSeg(seg) {
    seg.querySelectorAll(".rd-disc-tab").forEach((tab) => {
      const input = tab.querySelector('input[name="rd-discovery"]');
      tab.classList.toggle("on", Boolean(input?.checked));
    });
    const checked = seg.querySelector('input[name="rd-discovery"]:checked');
    const detail = document.querySelector("[data-disc-detail]");
    if (detail && checked) {
      detail.textContent = DISC_DETAIL[checked.value] || "";
    }
    syncScopeField();
    requestAnimationFrame(() => updateDiscGlider(seg));
  }

  function syncAllDiscoverySegs() {
    document.querySelectorAll("[data-disc-seg]").forEach(syncDiscSeg);
  }

  let discGliderResizeTimer = 0;
  function scheduleDiscGlider() {
    clearTimeout(discGliderResizeTimer);
    discGliderResizeTimer = setTimeout(syncAllDiscoverySegs, 80);
  }

  function initDiscoverySeg() {
    document.querySelectorAll("[data-disc-seg]").forEach((seg) => {
      seg.querySelectorAll('input[name="rd-discovery"]').forEach((el) => {
        el.addEventListener("change", () => syncDiscSeg(seg));
      });
      syncDiscSeg(seg);
    });
    window.addEventListener("resize", scheduleDiscGlider, { passive: true });
  }

  function readDiscoveryOpen() {
    const open = document.querySelector('input[name="rd-discovery"]:checked');
    return open ? open.value === "open" : true;
  }

  function selectedTemplate() {
    return ($("rd-task-template")?.value || "generic").trim();
  }

  function buildPostedScope(text) {
    const trimmed = String(text || "").trim();
    if (selectedTemplate() !== "solidity-audit") return trimmed;
    const body = { taskType: "solidity-audit", title: "Smart contract security audit" };
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) body.address = trimmed;
    else if (/github\.com/i.test(trimmed)) body.githubUrl = trimmed;
    else if (/^https?:\/\//i.test(trimmed)) body.sourceUrl = trimmed;
    else body.source = trimmed;
    return JSON.stringify(body);
  }

  function readDraftFromForm() {
    const text = ($("rd-task-scope")?.value ?? "").trim();
    return {
      scope: text,
      taskPrompt: text,
      template: selectedTemplate(),
      budget: ($("rd-task-budget")?.value ?? "").trim(),
      days: parseInt($("rd-task-days")?.value ?? "7", 10),
      discoveryOpen: readDiscoveryOpen(),
    };
  }

  function syncFormFromDraft(draft) {
    if (!draft || !$("rd-checkout")) return;
    const text = (draft.taskPrompt || draft.scope || "").trim();
    if (text) $("rd-task-scope").value = text;
    if (draft.budget) $("rd-task-budget").value = draft.budget;
    if (draft.days) $("rd-task-days").value = draft.days;
    const mode = draft.discoveryOpen === false ? "private" : "open";
    const radio = document.querySelector('input[name="rd-discovery"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncAllDiscoverySegs();
  }

  function postedTaskLabel(taskId) {
    const value = String(taskId ?? "").trim();
    const namespaced = value.match(/^v2:(standard|micro):([1-9]\d*)$/i);
    if (namespaced) {
      return (namespaced[1].toLowerCase() === "micro" ? "Micro" : "Standard") + " · Task #" + namespaced[2];
    }
    return "Task " + value;
  }

  function showPostReceipt(taskId, extra) {
    livePostReceipt = { taskId, extra: extra || "" };
    const card = $("rd-post-receipt");
    const title = $("rd-post-receipt-title");
    const body = $("rd-post-receipt-body");
    const link = $("rd-post-receipt-link");
    if (title) title.textContent = postedTaskLabel(taskId) + " is live";
    if (body) {
      body.textContent =
        (extra ? extra + " " : "") +
        "It's on the open market. Track funding and delivery on My tasks.";
    }
    if (link) {
      link.href = "/my-tasks";
      link.hidden = false;
    }
    if (card) card.hidden = false;
    setCheckoutStatus(
      postedTaskLabel(taskId) + " posted on Base.",
      "ok",
      { href: "/my-tasks", linkLabel: "Open My tasks" }
    );
    if ($("rd-checkout")) setStepState("post", "done");
  }

  function setCheckoutStatus(text, kind, extra) {
    const el = $("rd-checkout-status");
    if (!el) return;
    el.replaceChildren();
    el.append(String(text ?? ""));
    if (extra?.href) {
      el.append(" ");
      const a = document.createElement("a");
      a.href = extra.href;
      a.textContent = extra.linkLabel || "Open My tasks";
      el.append(a);
    }
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setCheckoutStatusWithPricingLink(text, kind) {
    const el = $("rd-checkout-status");
    if (!el) return;
    el.innerHTML = text + ' <a href="/pricing">Post more than 3 Tasks per Day.</a>';
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setPricingStatus(text, kind) {
    setPanelStatus("rd-pricing-status", text, kind);
  }

  function setPanelStatus(id, text, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setStepState(step, state) {
    const el = document.querySelector('.rd-step[data-step="' + step + '"]');
    if (!el) return;
    el.classList.remove("done", "on");
    if (state) el.classList.add(state);
  }

  function formatQuotaLine(quota) {
    if (!quota) return "";
    if (quota.limit == null) return quota.plan + " · unlimited posts today";
    return quota.plan + " · " + quota.used + " / " + quota.limit + " posts today";
  }

  const DEFAULT_PLANS = [
    { id: "free", label: "Free", dailyLimit: 3, priceUsdc: 0, billing: "none", description: "3 tasks per day" },
    { id: "basic", label: "Basic", dailyLimit: 50, priceUsdc: 20, billing: "monthly", description: "50 tasks per day · $20 USDC/month" },
    { id: "premium", label: "Premium", dailyLimit: 300, priceUsdc: 60, billing: "monthly", description: "300 tasks per day · $60 USDC/month" },
    { id: "enterprise", label: "Enterprise", dailyLimit: null, priceUsdc: 5000, billing: "lifetime", description: "Unlimited · one-time $5,000 USDC" },
  ];

  async function loadSitePlans() {
    if (postingPlans.length) return postingPlans;
    try {
      const res = await fetch(withMarket("/api/site-config"), { cache: "no-store" });
      if (res.ok) {
        const cfg = await parseJsonResponse(res);
        postingPlans = cfg.postingPlans?.length ? cfg.postingPlans : DEFAULT_PLANS;
      } else {
        postingPlans = DEFAULT_PLANS;
      }
    } catch {
      postingPlans = DEFAULT_PLANS;
    }
    return postingPlans;
  }

  async function fetchQuota(address) {
    if (!address) return null;
    const res = await fetch(withMarket("/api/posting/quota?address=" + encodeURIComponent(address)), {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseJsonResponse(res);
  }

  async function checkCanPost(address) {
    const res = await fetch("/api/posting/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, market: selectedMarket() }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      const err = new Error(
        data.error === "not_found"
          ? "Posting quota service is unavailable — refresh the site and try again."
          : data.error || "Daily posting limit reached"
      );
      err.quota = data.quota ?? null;
      throw err;
    }
    return data;
  }

  async function recordPostSuccess(address, taskId, txHash, task) {
    const res = await fetch("/api/posting-record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        taskId,
        txHash,
        description: task?.description,
        taskAmountAzl: task?.taskAmountAzl ?? task?.budgetAzl ?? task?.budget,
        deadlineDays: task?.deadlineDays,
        discoveryOpen: task?.discoveryOpen !== false,
        market: selectedMarket(),
      }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not record post");
    return data;
  }

  function renderPlanBar(quota) {
    const bar = $("rd-plan-bar");
    if (!bar) return;
    if (!quota || !walletAddress) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const nameEl = $("rd-plan-name");
    const usageEl = $("rd-plan-usage");
    const expiresEl = $("rd-plan-expires");
    if (nameEl) {
      nameEl.textContent =
        quota.limit == null ? "Unlimited Tasks" : "Post " + quota.limit + " Tasks per Day";
    }
    if (usageEl) {
      usageEl.textContent =
        quota.limit == null ? "Unlimited today" : quota.remaining + " of " + quota.limit + " left today";
    }
    if (expiresEl) {
      if (quota.tierExpiresAt) {
        expiresEl.hidden = false;
        expiresEl.textContent = "Renews " + new Date(quota.tierExpiresAt).toLocaleDateString();
      } else if (quota.tier === "enterprise") {
        expiresEl.hidden = false;
        expiresEl.textContent = "Lifetime unlimited posting";
      } else {
        expiresEl.hidden = true;
      }
    }
  }

  function priceLabel(plan) {
    if (!plan.priceUsdc) return "Free";
    if (plan.billing === "lifetime") return "$" + plan.priceUsdc.toLocaleString() + " once";
    return "$" + plan.priceUsdc + "/mo";
  }

  function limitLabel(plan) {
    if (plan.dailyLimit == null) return "Unlimited / day";
    return plan.dailyLimit + " Tasks per Day";
  }

  function fmtAzlAmount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B AZL";
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M AZL";
    return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
  }

  function updatePostButton(accessFeeAzl) {
    const button = $("rd-btn-post");
    if (!button) return;
    const note = button.querySelector(".rd-post-action-note");
    if (note) {
      note.textContent =
        (accessFeeAzl ? fmtAzlAmount(accessFeeAzl) : "Oracle-priced AZL access fee") +
        " · " +
        money(eco().accessFeeUsd) +
        " per task";
    }
  }

  async function loadAzlPreviews(plans) {
    const paid = (plans ?? []).filter((p) => p.priceUsdc > 0);
    const entries = await Promise.all(
      paid.map(async (p) => {
        try {
          const res = await fetch("/api/get-azl-preview?tier=" + encodeURIComponent(p.id), {
            cache: "no-store",
          });
          if (!res.ok) return [p.id, null];
          return [p.id, await parseJsonResponse(res)];
        } catch {
          return [p.id, null];
        }
      })
    );
    azlPreviews = Object.fromEntries(entries);
  }

  function upgradeButtonsHtml(tierId, plan) {
    const preview = azlPreviews[tierId];
    const azlHint = preview
      ? '<span class="rd-pricing-azl">' +
        fmtAzlAmount(preview.azlAmountFormatted ?? preview.azlAmount) +
        " (~$" +
        preview.discountedUsd +
        " · 10% off)</span>"
      : "";
    return (
      '<div class="rd-pricing-pay-row">' +
      '<button type="button" class="rd-action rd-action--primary rd-pricing-btn" data-tier="' +
      tierId +
      '" data-pay="usdc">' +
      (plan.billing === "lifetime"
        ? "Pay $5,000 USDC"
        : "Pay $" + plan.priceUsdc + " USDC") +
      "</button>" +
      '<button type="button" class="rd-action rd-pricing-btn rd-pricing-btn--azl" data-tier="' +
      tierId +
      '" data-pay="azl">Pay in AZL · 10% off</button>' +
      azlHint +
      "</div>"
    );
  }

  function renderPricingGrid(quota, plans) {
    const grid = $("rd-pricing-grid");
    if (!grid) return;

    const tier = quota?.tier ?? "free";
    const sorted = [...(plans ?? [])].sort(
      (a, b) => (TIER_RANK[a.id] ?? 0) - (TIER_RANK[b.id] ?? 0)
    );

    grid.innerHTML = sorted
      .map((p) => {
        const isCurrent = walletAddress && p.id === tier;
        const rank = TIER_RANK[p.id] ?? 0;
        const currentRank = TIER_RANK[tier] ?? 0;
        const canUpgrade = walletAddress && p.priceUsdc > 0 && rank > currentRank;
        let cta = "";
        if (isCurrent) {
          cta = '<span class="rd-pricing-badge">Current plan</span>';
        } else if (canUpgrade) {
          cta = upgradeButtonsHtml(p.id, p);
        } else if (!walletAddress && p.priceUsdc > 0) {
          cta = upgradeButtonsHtml(p.id, p);
        } else if (p.id === "free" && !walletAddress) {
          cta = '<span class="rd-pricing-hint">Default when signed in</span>';
        } else if (p.priceUsdc > 0 && rank <= currentRank) {
          cta = '<span class="rd-pricing-hint">Included in your plan</span>';
        }

        return (
          '<article class="rd-pricing-card' +
          (isCurrent ? " rd-pricing-card--current" : "") +
          '" data-tier="' +
          p.id +
          '">' +
          '<div class="rd-pricing-card-head">' +
          "<h6>" +
          p.label +
          "</h6>" +
          '<span class="rd-pricing-price">' +
          priceLabel(p) +
          "</span>" +
          "</div>" +
          '<p class="rd-pricing-limit">' +
          limitLabel(p) +
          "</p>" +
          "<p>" +
          p.description +
          "</p>" +
          cta +
          "</article>"
        );
      })
      .join("");

    grid.querySelectorAll(".rd-pricing-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        runUpgrade(btn.dataset.tier, setPricingStatus, btn.dataset.pay || "usdc").catch(() => {});
      });
    });
  }

  function renderUpgradeCards(quota, plans) {
    const section = $("rd-upgrade");
    const grid = $("rd-upgrade-grid");
    if (!section || !grid) return;

    const tier = quota?.tier ?? "free";
    const upgrades = (plans ?? []).filter(
      (p) => p.priceUsdc > 0 && (TIER_RANK[p.id] ?? 0) > (TIER_RANK[tier] ?? 0)
    );

    if (!walletAddress || !upgrades.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    grid.innerHTML = upgrades
      .map((p) => {
        const preview = azlPreviews[p.id];
        return (
          '<article class="rd-upgrade-card" data-tier="' +
          p.id +
          '">' +
          "<h6>" +
          p.label +
          "</h6>" +
          "<p>" +
          p.description +
          "</p>" +
          (preview
            ? '<p class="rd-pricing-azl">' +
              fmtAzlAmount(preview.azlAmountFormatted ?? preview.azlAmount) +
              " with AZL (10% off · ~$" +
              preview.discountedUsd +
              ")</p>"
            : "") +
          '<div class="rd-pricing-pay-row">' +
          '<button type="button" class="rd-action rd-upgrade-btn" data-tier="' +
          p.id +
          '" data-pay="usdc">Pay $' +
          p.priceUsdc +
          " USDC</button>" +
          '<button type="button" class="rd-action rd-action--primary rd-upgrade-btn rd-pricing-btn--azl" data-tier="' +
          p.id +
          '" data-pay="azl">Pay in AZL · 10% off</button>' +
          "</div></article>"
        );
      })
      .join("");

    grid.querySelectorAll(".rd-upgrade-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        runUpgrade(btn.dataset.tier, setCheckoutStatus, btn.dataset.pay || "usdc").catch(() => {});
      });
    });
  }

  async function refreshCheckout() {
    const panel = $("rd-checkout");
    if (!panel) return;
    applyMarketUi();

    const depositBtn = $("rd-btn-deposit");
    const postBtn = $("rd-btn-post");
    const api = posterApi();

    if (!api?.ready) {
      setStepState("signin", "on");
      setCheckoutStatus("Loading wallet…");
      if (depositBtn) depositBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
      renderPlanBar(null);
      renderUpgradeCards(null, postingPlans);
      return;
    }

    if (!walletAddress) {
      setStepState("signin", "on");
      setStepState("deposit", null);
      setStepState("post", null);
      setCheckoutStatus("Sign in (top right) to deposit and post.");
      if (depositBtn) depositBtn.disabled = true;
      if (postBtn) postBtn.disabled = true;
      renderPlanBar(null);
      renderUpgradeCards(null, postingPlans);
      return;
    }

    setStepState("signin", "done");
    await loadSitePlans();
    await loadAzlPreviews(postingPlans);

    try {
      currentQuota = await fetchQuota(walletAddress);
      renderPlanBar(currentQuota);
      renderUpgradeCards(currentQuota, postingPlans);

      const status = await api.getStatus();
      updatePostButton(status.accessFeeAzl);
      if (!status.configured) {
        setCheckoutStatus("Server missing contract config.", "err");
        if (depositBtn) depositBtn.disabled = true;
        if (postBtn) postBtn.disabled = true;
        return;
      }

      const quotaLine = currentQuota ? formatQuotaLine(currentQuota) : "";
      const quotaBlocked = currentQuota && !currentQuota.canPost;

      if (status.depositReady) {
        setStepState("deposit", "done");
        setStepState("post", quotaBlocked ? null : "on");
        if (quotaBlocked) {
          setCheckoutStatus(
            "Daily limit reached (" + quotaLine + "). Upgrade at /pricing.",
            "err"
          );
        } else if (status.needsPostTopUp) {
          setCheckoutStatus(
            "Add " +
              (status.postCollateralShortfallAzl || status.listingFeeUsdc) +
              " AZL collateral to cover the live-task reserve and access fee before posting.",
            "err"
          );
        } else if (status.canPost) {
          setCheckoutStatus(
            "Minimum collateral is on file. " +
              quotaLine +
            " · posting uses the oracle-priced AZL access amount.",
            "ok"
          );
        } else {
          setCheckoutStatus("You need sufficient AZL collateral for the oracle-priced access fee.", "err");
        }
        if (depositBtn) {
          depositBtn.setAttribute("aria-disabled", checkoutBusy ? "true" : "false");
          depositBtn.textContent = "Add collateral";
        }
        if (postBtn) {
          postBtn.disabled = checkoutBusy || quotaBlocked || !status.canPost;
        }
      } else {
        setStepState("deposit", "on");
        setStepState("post", null);
        const depositLabel = $("rd-btn-deposit-label");
        const depositNote = $("rd-btn-deposit-note");
        if (depositLabel && status.collateralShortfallUsd && status.collateralShortfallAzl) {
          depositLabel.textContent =
            "Complete your " + money(eco().postingFloorUsd) + " Solvency Deposit";
          depositNote.textContent =
            status.collateralShortfallAzl + " AZL still needed · Open wallet →";
        } else if (depositLabel && status.collateralShortfallUsd === "0.00") {
          depositLabel.textContent = "Add task reserve and access fee";
          depositNote.textContent = "Open wallet to reach the " + money(eco().postingFloorUsd) + " recommended posting balance →";
        }
        if (!status.canDeposit) {
          setCheckoutStatus(
            "Add $" +
              status.collateralShortfallUsd +
              " (" +
              status.collateralShortfallAzl +
              " AZL) toward the " + money(eco().postingFloorUsd) + " recommended posting balance.",
            "err"
          );
        } else {
          setCheckoutStatusWithPricingLink(
            " " +
              "Posting a task costs " + money(eco().accessFeeUsd) + ". Workers also pay " + money(eco().accessFeeUsd) + " to claim it, so adjust your budget accordingly. " +
              "Below " + money(eco().accessFeeUsd) + " task value is unprofitable; do not expect workers to pick it up.",
            undefined
          );
        }
        if (depositBtn) {
          depositBtn.setAttribute("aria-disabled", checkoutBusy ? "true" : "false");
        }
        if (postBtn) postBtn.disabled = true;
      }

      if (livePostReceipt) {
        showPostReceipt(livePostReceipt.taskId, livePostReceipt.extra);
        if (postBtn) postBtn.disabled = checkoutBusy || quotaBlocked || !status.canPost;
      }
    } catch (e) {
      setCheckoutStatus((e && e.message) || "Could not read wallet status", "err");
    }
  }

  function resolveDraft(override) {
    const fromForm = $("rd-checkout") ? readDraftFromForm() : null;
    const draft = override ?? (fromForm?.scope ? fromForm : null) ?? loadDraft();
    if (!draft?.scope && !draft?.taskPrompt) throw new Error("No task scope — start from the chat first.");
    let budgetUsd = parseFloat(draft.budget);
    const deadlineDays = parseInt(draft.days, 10);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("Invalid task budget in USD.");
    if (selectedMarket() === "micro" && budgetUsd > 50) {
      window.AZZLE_MARKETS?.setSelectedMarket?.("standard");
    } else if (selectedMarket() === "standard" && budgetUsd < 6) {
      window.AZZLE_MARKETS?.setSelectedMarket?.("micro");
    }
    const bounds = budgetBounds();
    if (budgetUsd < bounds.min || budgetUsd > bounds.max) {
      throw new Error(
        "Task budget must be " +
          money(bounds.min) +
          "–" +
          money(bounds.max) +
          " on " +
          (selectedMarket() === "micro" ? "Micro" : "Standard") +
          "."
      );
    }
    if (!Number.isFinite(deadlineDays) || deadlineDays <= 0) throw new Error("Invalid deadline.");
    const description = buildPostedScope((draft.taskPrompt || draft.scope || "").trim());
    const discoveryOpen = draft.discoveryOpen !== false;
    if (discoveryOpen && !description) throw new Error("Write a public scope before posting.");
    return { description, taskAmountUsd: budgetUsd, deadlineDays, discoveryOpen };
  }

  async function runDeposit(onProgress) {
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    const market = selectedMarket();
    const floor = eco().postingFloorUsd;
    checkoutBusy = true;
    if ($("rd-btn-deposit")) $("rd-btn-deposit").disabled = true;
    onProgress?.("Checking " + (market === "micro" ? "Micro" : "Standard") + " balance…", "busy");
    try {
      const fund = typeof api.fundCollateral === "function"
        ? api.fundCollateral(floor, (msg) => onProgress?.(msg, "busy"), market)
        : api.deposit((msg) => onProgress?.(msg, "busy"));
      const result = await fund;
      if (result?.alreadyDeposited) {
        onProgress?.("Deposit already on file — you're ready to post.", "ok");
      } else {
        onProgress?.((market === "micro" ? "Micro" : "Standard") + " collateral funded.", "ok");
      }
      await refreshCheckout();
      return { ok: true };
    } catch (e) {
      onProgress?.((e && e.message) || "Deposit failed", "err");
      await refreshCheckout();
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function runPost(draftOverride, onProgress) {
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }

    let task;
    try {
      task = resolveDraft(draftOverride);
    } catch (e) {
      onProgress?.((e && e.message) || "Invalid task details", "err");
      return { ok: false };
    }

    try {
      await checkCanPost(walletAddress);
    } catch (e) {
      const q = e.quota;
      const hint = q
        ? " (" + q.used + "/" + q.limit + " today on " + q.plan + ")"
        : "";
      onProgress?.(
        (e.message || "Daily limit reached") + hint + " — upgrade at /pricing.",
        "err"
      );
      return { ok: false };
    }

    saveDraft({
      scope: task.description,
      taskPrompt: task.description,
      budget: String(task.taskAmountUsd),
      days: task.deadlineDays,
      discoveryOpen: task.discoveryOpen,
    });

    checkoutBusy = true;
    if ($("rd-btn-post")) $("rd-btn-post").disabled = true;
    onProgress?.("Confirm in your wallet…", "busy");
    try {
      if (typeof api.postV2 !== "function") {
        throw new Error("The connected wallet bridge does not expose the v2 TaskRegistry post flow yet.");
      }
      const result = await api.postV2(task, (msg) => onProgress?.(msg, "busy"));
      const taskId = window.AZZLE_MARKETS.namespacedTaskId(selectedMarket(), result.taskId);
      try {
        await recordPostSuccess(walletAddress, taskId, result.hash, task);
      } catch {
        /* Onchain post already succeeded; quota recording is best-effort. */
      }
      localStorage.setItem(TASK_ID_KEY, taskId);
      const scopeNote =
        task.discoveryOpen !== false && result.scopePublished
          ? "Scope published onchain."
          : task.discoveryOpen === false
            ? "Private listing — share scope via XMTP."
            : "";
      showPostReceipt(taskId, scopeNote);
      onProgress?.(
        postedTaskLabel(taskId) + " posted on Base. Track it on My tasks.",
        "ok"
      );
      try {
        await refreshCheckout();
      } catch {
        showPostReceipt(taskId, scopeNote);
      }
      return { ...result, taskId, ok: true };
    } catch (e) {
      onProgress?.((e && e.message) || "Post failed", "err");
      await refreshCheckout();
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function runUpgrade(tierId, onProgress, payWith) {
    const currency = payWith || "usdc";
    const api = posterApi();
    if (!api || checkoutBusy) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }
    if (!walletAddress) {
      onProgress?.("Sign in first (top right).", "err");
      return { ok: false };
    }

    checkoutBusy = true;
    onProgress?.("Confirm payment in your wallet…", "busy");
    try {
      let quote = null;
      if (currency === "azl") {
        onProgress?.("Fetching live AZL price…", "busy");
        const qRes = await fetch(
          "/api/posting-quote?tier=" +
            encodeURIComponent(tierId) +
            "&address=" +
            encodeURIComponent(walletAddress) +
            "&payWith=azl&market=" +
            encodeURIComponent(selectedMarket()),
          { cache: "no-store" }
        );
        quote = await parseJsonResponse(qRes);
        if (!qRes.ok) throw new Error(quote.error || "Could not quote AZL price");
        onProgress?.(
          "Pay " + fmtAzlAmount(quote.azlAmountFormatted ?? quote.azlAmount) + " (~$" + quote.discountedUsd + ")…",
          "busy"
        );
      }

      const payment = await api.payUpgrade(
        tierId,
        { payWith: currency, quote },
        (msg) => onProgress?.(msg, "busy")
      );

      const res = await fetch("/api/posting-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: walletAddress,
          tier: tierId,
          txHash: payment.hash,
          payWith: currency,
          quoteId: quote?.quoteId,
          market: selectedMarket(),
        }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || "Upgrade failed");
      currentQuota = data;
      onProgress?.("Upgraded to " + data.plan + ". " + formatQuotaLine(data), "ok");
      await refreshAll();
      return { ok: true, quota: data };
    } catch (e) {
      onProgress?.((e && e.message) || "Upgrade failed", "err");
      return { ok: false };
    } finally {
      checkoutBusy = false;
    }
  }

  async function refreshPricing() {
    const panel = $("rd-pricing");
    if (!panel) return;

    await loadSitePlans();
    await loadAzlPreviews(postingPlans);
    const api = posterApi();

    if (!api?.ready) {
      setPricingStatus("Loading wallet…");
      renderPlanBar(null);
      renderPricingGrid(null, postingPlans);
      return;
    }

    if (!walletAddress) {
      setPricingStatus("Sign in (top right) to see your plan and upgrade.");
      renderPlanBar(null);
      renderPricingGrid(null, postingPlans);
      return;
    }

    try {
      currentQuota = await fetchQuota(walletAddress);
      renderPlanBar(currentQuota);
      renderPricingGrid(currentQuota, postingPlans);
      if (currentQuota.tier === "enterprise") {
        setPricingStatus("You're on Enterprise — unlimited posting.", "ok");
      } else if (currentQuota.canPost) {
        setPricingStatus(formatQuotaLine(currentQuota) + " · pick a plan below to upgrade.", "ok");
      } else {
        setPricingStatus(
          "Daily limit reached (" + formatQuotaLine(currentQuota) + "). Upgrade below.",
          "err"
        );
      }
    } catch (e) {
      setPricingStatus((e && e.message) || "Could not load plan", "err");
    }
  }

  async function refreshAll() {
    await refreshCheckout();
    await refreshPricing();
  }

  function initPanel() {
    const draft = loadDraft();
    syncFormFromDraft(draft);
    loadSitePlans().then(() => refreshCheckout());

    $("rd-btn-deposit")?.addEventListener("click", () => {
      runDeposit(setCheckoutStatus).catch(() => {});
    });
    $("rd-btn-post")?.addEventListener("click", () => {
      runPost(null, setCheckoutStatus).catch(() => {});
    });

    $("rd-task-budget")?.addEventListener("input", onBudgetTyped);
    $("rd-task-budget")?.addEventListener("blur", onBudgetCommit);
    $("rd-task-template")?.addEventListener("change", () => {
      const audit = selectedTemplate() === "solidity-audit";
      const scope = $("rd-task-scope");
      if (scope) {
        scope.placeholder = audit
          ? "0x address, GitHub URL, BaseScan/Sourcify link, or Solidity source"
          : "Describe the outcome…";
      }
      const budget = $("rd-task-budget");
      if (audit && budget && (!budget.value || Number(budget.value) === 100)) {
        window.AZZLE_MARKETS?.setSelectedMarket?.("micro");
        budget.value = "30";
      }
      saveDraft(readDraftFromForm());
    });
    ["rd-task-scope", "rd-task-budget", "rd-task-days"].forEach((id) => {
      $(id)?.addEventListener("change", () => {
        if (id === "rd-task-budget") onBudgetCommit();
        else saveDraft(readDraftFromForm());
      });
    });
    document.querySelectorAll('input[name="rd-discovery"]').forEach((el) => {
      el.addEventListener("change", () => {
        saveDraft(readDraftFromForm());
        syncAllDiscoverySegs();
      });
    });

    const params = new URLSearchParams(location.search);
    const action = params.get("action");
    refreshCheckout().then(() => {
      if (action === "deposit") runDeposit(setCheckoutStatus).catch(() => {});
      if (action === "post") runPost(null, setCheckoutStatus).catch(() => {});
    });
  }

  function initPricingPanel() {
    loadSitePlans().then(() => refreshPricing());
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    refreshAll();
  });
  window.addEventListener("azzle-poster-ready", () => refreshAll());
  window.addEventListener("azzle-market-change", () => refreshAll());

  window.AzzlePostCheckout = {
    saveDraft,
    loadDraft,
    runDeposit,
    runPost,
    runUpgrade,
    fetchQuota,
    formatQuotaLine,
    refreshCheckout,
    initPanel,
    syncDiscoverySeg: syncAllDiscoverySegs,
  };

  document.addEventListener("DOMContentLoaded", initDiscoverySeg);

  if ($("rd-checkout")) {
    document.addEventListener("DOMContentLoaded", initPanel);
  }
  if ($("rd-pricing")) {
    document.addEventListener("DOMContentLoaded", initPricingPanel);
  }
})();
