(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n, unit = "") => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 }) + unit;
  const fmtWei = (n, unit = "") => {
    try {
      return fmt(Number(BigInt(n ?? 0) / 10n ** 18n), unit);
    } catch {
      return "—";
    }
  };
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  let microLive = false;
  let standardLive = false;
  let microActive = false;
  let standardActive = false;

  function status(text, kind) {
    const el = $("union-status"); el.textContent = text; el.className = "rd-checkout-status" + (kind ? ` ${kind}` : "");
  }
  async function api() {
    if (!window.azzlePoster?.ready) throw new Error("Sign in with your Base wallet first.");
    return window.azzlePoster;
  }
  function splitAmounts() {
    const total = Math.max(0, num($("union-stake-amount")?.value));
    const microPct = microLive ? Math.min(100, Math.max(0, num($("union-split")?.value))) : 0;
    const micro = total * microPct / 100;
    return { total, microPct, standard: total - micro, micro };
  }
  function renderSplit() {
    const slider = $("union-split");
    if (slider) {
      if (!microActive) {
        slider.value = "0";
        slider.disabled = true;
      } else {
        slider.disabled = false;
      }
      slider.style.setProperty("--split", `${100 - num(slider.value)}%`);
    }
    const parts = splitAmounts();
    $("union-split-std-pct").textContent = `${Math.round(100 - parts.microPct)}%`;
    $("union-split-micro-pct").textContent = `${Math.round(parts.microPct)}%`;
    $("union-split-std-amt").textContent = fmt(parts.standard, " AZL");
    $("union-split-micro-amt").textContent = microActive ? fmt(parts.micro, " AZL") : "Not activated";
  }
  function setLaneEnabled(ids, enabled) {
    ids.forEach((id) => { const el = $(id); if (el) el.disabled = !enabled; });
  }
  async function refresh() {
    try {
      status("Reading Union state from Base…", "busy");
      const [overviewStandard, overviewMicro, bridge] = await Promise.all([
        fetch("/api/union/overview?market=standard", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
        fetch("/api/union/overview?market=micro", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
        api().then((wallet) => wallet.getUnionPosition ? wallet : null).catch(() => null),
      ]);
      const [positionStandard, positionMicro] = await Promise.all([
        bridge?.getUnionPosition ? bridge.getUnionPosition("standard").catch(() => null) : null,
        bridge?.getUnionPosition ? bridge.getUnionPosition("micro").catch(() => null) : null,
      ]);
      standardLive = Boolean(overviewStandard && overviewStandard.live !== false);
      microLive = Boolean(overviewMicro && overviewMicro.live !== false);
      standardActive = Boolean(standardLive && (overviewStandard?.stakingActive ?? positionStandard?.active));
      microActive = Boolean(microLive && (overviewMicro?.stakingActive ?? positionMicro?.active));
      $("union-active").textContent = standardActive && microActive
        ? "Both vaults live."
        : standardActive
        ? (microLive ? "Standard live · Micro pending." : "Standard live · Micro not deployed.")
        : "Activation pending. Staking is owner-activated.";
      $("union-lead").textContent = standardActive && microActive
        ? "Stake AZL across Standard and Micro. Credits, rewards, and rankings stay isolated per vault."
        : standardActive
        ? "Standard staking is live. Micro is deployed but not owner-activated yet — the split slider stays at Standard until then."
        : "Union is deployed on Base. Action Credit mining begins only once staking is activated.";
      $("union-panel").hidden = false;
      const signedIn = Boolean(positionStandard?.signedIn || positionMicro?.signedIn);
      $("union-stake").disabled = !(signedIn && (standardActive || microActive));
      setLaneEnabled(["union-unstake-standard", "union-claim-unstake-standard", "union-bank-standard", "union-claim-rewards-standard"], signedIn && standardActive);
      setLaneEnabled(["union-unstake-micro", "union-claim-unstake-micro", "union-bank-micro", "union-claim-rewards-micro"], signedIn && microActive);
      const wallet = positionStandard || positionMicro;
      $("union-wallet-azl").textContent = wallet ? fmt(wallet.walletAzl, " AZL") : "Sign in to view";
      const stakedStandard = positionStandard ? num(positionStandard.stakedAzl) : 0;
      const stakedMicro = positionMicro ? num(positionMicro.stakedAzl) : 0;
      $("union-staked").textContent = wallet ? fmt(stakedStandard + stakedMicro, " AZL") : "—";
      $("union-staked-standard").textContent = positionStandard ? fmt(positionStandard.stakedAzl) : "—";
      $("union-staked-micro").textContent = microLive ? (positionMicro ? fmt(positionMicro.stakedAzl) : "—") : "n/a";
      const creditsStandard = positionStandard ? num(positionStandard.credits) : 0;
      const creditsMicro = positionMicro ? num(positionMicro.credits) : 0;
      $("union-credits").textContent = wallet ? fmt(creditsStandard + creditsMicro) : "—";
      $("union-credits-standard").textContent = positionStandard ? fmt(positionStandard.credits) : "—";
      $("union-credits-micro").textContent = microLive ? (positionMicro ? fmt(positionMicro.credits) : "—") : "n/a";
      const rewardsStandard = positionStandard ? num(positionStandard.claimableAzl) : 0;
      const rewardsMicro = positionMicro ? num(positionMicro.claimableAzl) : 0;
      $("union-rewards").textContent = wallet ? fmt(rewardsStandard + rewardsMicro, " AZL") : "—";
      $("union-rewards-standard").textContent = positionStandard ? fmt(positionStandard.claimableAzl) : "—";
      $("union-rewards-micro").textContent = microLive ? (positionMicro ? fmt(positionMicro.claimableAzl) : "—") : "n/a";
      $("union-pending-standard").textContent = positionStandard ? fmt(positionStandard.pendingUnstakeAzl || positionStandard.pendingPayoutAzl, " AZL") : "—";
      $("union-pending-micro").textContent = microLive ? (positionMicro ? fmt(positionMicro.pendingUnstakeAzl || positionMicro.pendingPayoutAzl, " AZL") : "—") : "Not live";
      $("union-remaining-standard").textContent = overviewStandard ? fmtWei(overviewStandard.creditsRemaining) : "—";
      $("union-remaining-micro").textContent = microLive && overviewMicro ? fmtWei(overviewMicro.creditsRemaining) : "—";
      $("union-total-standard").textContent = overviewStandard ? fmtWei(overviewStandard.totalStakedAzl, " AZL") : "—";
      $("union-total-micro").textContent = microLive && overviewMicro ? fmtWei(overviewMicro.totalStakedAzl, " AZL") : "—";
      renderSplit();
      status(
        standardActive && microActive
          ? "Union active. Standard and Micro are read separately from Base."
          : standardActive
          ? "Standard staking is live. Micro staking is not activated yet."
          : "Pre-launch mode. No stake can accrue before activation.",
        standardActive ? "ok" : ""
      );
    } catch (error) { status(error.message || "Could not load Union state.", "err"); }
  }
  async function transact(action, value, market) {
    try {
      const bridge = await api(); status("Waiting for wallet confirmation…", "busy");
      await bridge.unionTx(action, value, (message) => status(message || "Confirming transaction…", "busy"), market);
      await refresh(); status("Transaction confirmed on Base.", "ok");
    } catch (error) { status(error.message || "Transaction failed.", "err"); }
  }
  async function stakeSplit() {
    const parts = splitAmounts();
    if (parts.total <= 0) {
      status("Enter an AZL amount to stake.", "err");
      return;
    }
    try {
      const bridge = await api();
      if (parts.standard > 0) {
        status("Staking Standard vault…", "busy");
        await bridge.unionTx("stake", String(parts.standard), (message) => status(message || "Confirming Standard stake…", "busy"), "standard");
      }
      if (parts.micro > 0) {
        if (!microActive) throw new Error("Micro Union staking is not activated yet. The vault is deployed, but stake() stays closed until the owner calls activateStaking.");
        status("Staking Micro vault…", "busy");
        await bridge.unionTx("stake", String(parts.micro), (message) => status(message || "Confirming Micro stake…", "busy"), "micro");
      }
      await refresh();
      status("Stake confirmed on Base.", "ok");
    } catch (error) { status(error.message || "Transaction failed.", "err"); }
  }
  const shorten = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  const formatAzl = (value) => {
    try {
      const wei = BigInt(value);
      const whole = Number(wei / 10n ** 18n);
      if (!Number.isFinite(whole)) return "—";
      if (whole >= 1e9) return (whole / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "B AZL";
      if (whole >= 1e6) return (whole / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M AZL";
      if (whole >= 10000) return (whole / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "k AZL";
      return whole.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " AZL";
    } catch { return "—"; }
  };
  const formatCredits = (value) => {
    try { return (Number(BigInt(value)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 }); } catch { return "—"; }
  };
  const boards = { standard: [], micro: [] };
  const boardMeta = { standard: { live: true }, micro: { live: true } };
  let leaderboardMetric = "staked";
  let rewardMetric = "claimable";
  function renderLeaderboard(market) {
    const table = $("union-leaderboard-table-" + market);
    if (!table) return;
    const rowsSource = boards[market] || [];
    const rewardKey = rewardMetric === "claimed" ? "claimedAzl" : "claimableAzl";
    const fields = {
      staked: ["Staked AZL", (row) => formatAzl(row.stakedAzl)],
      credits: ["Action Credits", (row) => formatCredits(row.credits)],
      rewards: [rewardMetric === "claimed" ? "Claimed AZL" : "Claimable AZL", (row) => formatAzl(row[rewardKey])],
    };
    const [label, value] = fields[leaderboardMetric];
    const metricKey = leaderboardMetric === "staked" ? "stakedAzl" : leaderboardMetric === "credits" ? "credits" : rewardKey;
    const rows = [...rowsSource].filter((row) => {
      try { BigInt(row[metricKey]); return true; } catch { return false; }
    }).sort((a, b) => {
      const difference = BigInt(b[metricKey]) - BigInt(a[metricKey]);
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    }).slice(0, 5);
    if (!rows.length) {
      table.innerHTML = boardMeta[market].live === false
        ? '<p class="rd-union-leaderboard-empty">Not live yet.</p>'
        : '<p class="rd-union-leaderboard-empty">No indexed stake yet.</p>';
      return;
    }
    table.innerHTML = `<div class="rd-union-leaderboard-row rd-union-leaderboard-row--head"><span>#</span><span>Staker</span><span>${label}</span></div>${rows.map((row, index) => `<div class="rd-union-leaderboard-row"><strong>${index + 1}</strong><span>${row.name ? `<b>${row.name}</b><small><code>${shorten(row.account)}</code></small>` : `<code>${shorten(row.account)}</code>`}${leaderboardMetric === "rewards" ? `<small>${rewardMetric === "claimed" ? `${formatAzl(row.claimableAzl ?? 0)} claimable` : `${formatAzl(row.claimedAzl ?? 0)} claimed`}${BigInt(row.pendingPayoutAzl ?? 0) > 0n ? ` · ${formatAzl(row.pendingPayoutAzl)} deferred` : ""}</small>` : ""}</span><strong>${value(row)}</strong></div>`).join("")}`;
  }
  async function refreshLeaderboard(market) {
    const updated = $("union-leaderboard-updated-" + market);
    const table = $("union-leaderboard-table-" + market);
    try {
      let response = await fetch("/api/union/leaderboard?market=" + encodeURIComponent(market));
      if (!response.ok) {
        response = await fetch("/api/get-union-leaderboard?market=" + encodeURIComponent(market));
      }
      if (!response.ok) throw new Error("Leaderboard unavailable");
      const data = await response.json();
      if ((data.market || "standard") !== market) {
        throw new Error("Leaderboard market mismatch");
      }
      boards[market] = data.rows ?? [];
      boardMeta[market] = { live: data.live !== false };
      if (updated) {
        updated.textContent = data.live === false
          ? "Not live"
          : `${data.participants ?? (data.rows ?? []).length} stakers`;
      }
      renderLeaderboard(market);
    } catch {
      if (updated) updated.textContent = "Pending";
      if (table) table.innerHTML = '<p class="rd-union-leaderboard-empty">Temporarily unavailable.</p>';
    }
  }
  function refreshAllLeaderboards() {
    return Promise.all(["standard", "micro"].map(refreshLeaderboard));
  }
  document.querySelectorAll("[data-union-rank]").forEach((button) => button.addEventListener("click", () => {
    leaderboardMetric = button.dataset.unionRank;
    $("union-reward-tabs").hidden = leaderboardMetric !== "rewards";
    document.querySelectorAll("[data-union-rank]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderLeaderboard("standard");
    renderLeaderboard("micro");
  }));
  document.querySelectorAll("[data-union-reward-rank]").forEach((button) => button.addEventListener("click", () => {
    rewardMetric = button.dataset.unionRewardRank;
    document.querySelectorAll("[data-union-reward-rank]").forEach((toggle) => {
      const active = toggle === button;
      toggle.classList.toggle("is-active", active);
      toggle.setAttribute("aria-pressed", String(active));
    });
    renderLeaderboard("standard");
    renderLeaderboard("micro");
  }));
  $("union-refresh").addEventListener("click", () => Promise.all([refresh(), refreshAllLeaderboards()]));
  $("union-stake").addEventListener("click", stakeSplit);
  $("union-unstake-standard").addEventListener("click", () => transact("unstake", $("union-unstake-amount").value, "standard"));
  $("union-unstake-micro").addEventListener("click", () => transact("unstake", $("union-unstake-amount").value, "micro"));
  $("union-claim-unstake-standard").addEventListener("click", () => transact("claimUnstakeTo", null, "standard"));
  $("union-claim-unstake-micro").addEventListener("click", () => transact("claimUnstakeTo", null, "micro"));
  $("union-bank-standard").addEventListener("click", () => transact("bankCredits", null, "standard"));
  $("union-bank-micro").addEventListener("click", () => transact("bankCredits", null, "micro"));
  $("union-claim-rewards-standard").addEventListener("click", () => transact("claimRewards", null, "standard"));
  $("union-claim-rewards-micro").addEventListener("click", () => transact("claimRewards", null, "micro"));
  $("union-split")?.addEventListener("input", renderSplit);
  $("union-stake-amount")?.addEventListener("input", renderSplit);
  window.addEventListener("azzle-wallet-change", refresh);
  window.addEventListener("azzle-poster-ready", refresh);
  window.addEventListener("azzle-bridge-ready", refresh);
  renderSplit();
  refresh();
  refreshAllLeaderboards();
  window.setInterval(refreshAllLeaderboards, 60_000);
})();
