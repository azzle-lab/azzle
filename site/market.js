(function () {
  "use strict";

  let refreshTimer = null;
  let openTaskId = null;
  let currentView = "open";
  let closeModalTimer = 0;
  let activeTask = null;
  let azlUsdPrice = null;
  const v2Tasks = new Map();
  const legacyTasks = new Map();

  const $ = (id) => document.getElementById(id);
  const BASESCAN = "https://basescan.org";

  function walletApi() {
    return window.azzlePoster ?? null;
  }

  function setStatus(text, kind) {
    const el = $("rd-market-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("busy", "ok", "err");
    if (kind) el.classList.add(kind);
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 10) return addr ?? "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function fmtAzl(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return (Math.round(v / 1e18 * 100) / 100).toLocaleString() + " AZL";
  }

  function fmtUsd(n) {
    const azl = Number(n);
    const price = Number(azlUsdPrice);
    if (!Number.isFinite(azl) || !Number.isFinite(price) || price <= 0) return "USD unavailable";
    const value = (azl / 1e18) * price;
    return "$" + value.toLocaleString(undefined, {
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    });
  }

  async function fetchAzlUsdPrice() {
    try {
      const res = await fetch("/api/azl/market", { cache: "no-store" });
      if (!res.ok) throw new Error("AZL price unavailable");
      const data = await res.json();
      const price = Number(data?.market?.priceUsd);
      if (Number.isFinite(price) && price > 0) azlUsdPrice = price;
    } catch {
      azlUsdPrice = null;
    }
  }

  function amountCell(amount) {
    return (
      '<span class="rd-market-amount">' +
      escapeHtml(fmtAzl(amount)) +
      '</span><span class="rd-market-usd">' +
      escapeHtml(fmtUsd(amount)) +
      "</span>"
    );
  }

  function taskAmount(task) {
    return task?.taskAmountAzl ?? task?.totalAmountAzlWei ?? task?.budgetAzl;
  }

  function fmtAgo(ts) {
    if (!ts) return "—";
    const s = Math.floor(Date.now() / 1000) - Number(ts);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function fmtDigest(digest) {
    if (!digest || typeof digest !== "string") return "—";
    const hex = digest.startsWith("0x") ? digest : "0x" + digest;
    if (hex.length <= 18) return hex;
    return hex.slice(0, 10) + "…" + hex.slice(-8);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 120) || "HTTP " + res.status);
    }
  }

  function taskMarket(task) {
    if (task?.market === "micro" || /^v2:micro:/i.test(String(task?.id || ""))) return "micro";
    return "standard";
  }

  function displayTaskId(task) {
    return String(task?.localTaskId || task?.id || "").replace(/^v2:(standard|micro):/i, "");
  }

  function namespacedTaskId(task) {
    const id = String(task?.id || "");
    if (/^v2:(standard|micro):[1-9]\d*$/i.test(id)) return id;
    return "v2:" + taskMarket(task) + ":" + displayTaskId(task);
  }

  function normalizeListedTask(task, market) {
    return {
      ...task,
      market: task.market || market,
      taskAmountAzl: task.totalAmountAzlWei,
      fundedAzl: task.fundedAzlWei,
      lockedAzl: task.fundedAzlWei,
      registryAddress: task.registryAddress,
      state: task.state,
    };
  }

  async function fetchMarketTasks(params, market) {
    const query = new URLSearchParams(params);
    query.set("market", market);
    const res = await fetch("/api/get-open-tasks-v2?" + query, { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.message || data.error || "Could not load " + market + " tasks");
    return (data.tasks ?? []).map((task) => normalizeListedTask(task, market));
  }

  async function fetchBothMarkets(params) {
    const results = await Promise.allSettled([
      fetchMarketTasks(params, "standard"),
      fetchMarketTasks(params, "micro"),
    ]);
    const tasks = [];
    const errors = [];
    results.forEach((result) => {
      if (result.status === "fulfilled") tasks.push(...result.value);
      else errors.push(result.reason);
    });
    if (!tasks.length && errors.length === 2) {
      throw errors[0] || new Error("Could not load open tasks");
    }
    return tasks.sort(
      (a, b) =>
        Number(b.deadline || 0) - Number(a.deadline || 0) ||
        Number(b.localTaskId || 0) - Number(a.localTaskId || 0)
    );
  }

  async function fetchOpenTasks() {
    const params = { limit: "100" };
    const type = $("rd-market-filter-type")?.value.trim();
    const capability = $("rd-market-filter-capability")?.value.trim();
    const minimum = $("rd-market-filter-min")?.value.trim();
    if (type) params.taskType = type;
    if (capability) params.capability = capability;
    if (minimum) params.minAmountAzlWei = (BigInt(Math.max(0, Number(minimum))) * 10n ** 18n).toString();
    const tasks = await fetchBothMarkets(params);
    tasks.forEach((task) => v2Tasks.set(task.id, task));
    return tasks;
  }

  async function fetchRecentTasks() {
    const tasks = await fetchBothMarkets({ limit: "50", state: "ALL" });
    tasks.forEach((task) => v2Tasks.set(task.id, task));
    return tasks;
  }

  async function fetchLegacyTasks() {
    const res = await fetch("/api/market/legacy?limit=100", { cache: "no-store" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load archived V1 tasks");
    const tasks = (data.tasks ?? []).map((task) => ({
      ...task,
      protocolVersion: "v1-archived",
      taskAmountAzl: task.totalAmountWei,
      registryAddress: task.registry,
    }));
    tasks.forEach((task) => legacyTasks.set(task.id, task));
    return tasks;
  }

  function stateTone(state) {
    if (state === "POSTED") return "open";
    if (state === "CLAIMED" || state === "ACTIVE") return "live";
    if (state === "COMPLETED" || state === "RESOLVED") return "done";
    if (state === "DISPUTED") return "warn";
    return "other";
  }

  function stateBadge(state) {
    const tone = stateTone(state);
    return (
      '<span class="rd-market-state rd-market-state--' +
      tone +
      '">' +
      escapeHtml(state) +
      "</span>"
    );
  }

  function bindRowClicks(tbody) {
    if (!tbody) return;
    tbody.querySelectorAll(".rd-market-row").forEach((row) => {
      row.addEventListener("click", () => openDetail(row.dataset.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(row.dataset.id);
        }
      });
    });
  }

  async function fetchTaskDetail(taskId) {
    if (currentView === "legacy" && legacyTasks.has(taskId)) return legacyTasks.get(taskId);
    const cached = v2Tasks.get(taskId);
    const market = cached?.market || (/^v2:micro:/i.test(String(taskId)) ? "micro" : "standard");
    const res = await fetch(
      "/api/get-task?id=" + encodeURIComponent(taskId) + "&market=" + encodeURIComponent(market),
      { cache: "no-store" }
    );
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load task");
    return data.task;
  }

  function detailRow(label, valueHtml) {
    return (
      "<div class=\"rd-market-detail-row\"><dt>" +
      escapeHtml(label) +
      "</dt><dd>" +
      valueHtml +
      "</dd></div>"
    );
  }

  function basescanAddr(addr) {
    if (!addr) return "—";
    return (
      '<a href="' +
      BASESCAN +
      "/address/" +
      encodeURIComponent(addr) +
      '" target="_blank" rel="noopener">' +
      escapeHtml(shortAddr(addr)) +
      "</a>"
    );
  }

  function renderDetail(task) {
    const grid = $("rd-market-detail-grid");
    const scope = $("rd-market-detail-scope");
    const scopeText = $("rd-market-detail-description");
    const note = $("rd-market-detail-note");
    const links = $("rd-market-detail-links");
    const title = $("rd-market-detail-title");
    const sub = $("rd-market-detail-sub");
    const status = $("rd-market-detail-status");
    const actions = $("rd-market-detail-actions");

    if (!grid || !task) return;

    if (title) {
      title.textContent =
        task.protocolVersion === "v1-archived"
          ? "V1 archive task #" + task.id
          : (taskMarket(task) === "micro" ? "Micro" : "Standard") + " · Task #" + displayTaskId(task);
    }
    if (sub) {
      if (task.protocolVersion === "v1-archived") {
        sub.textContent = "Archived V1 task · read-only historical reference · not actively maintained";
      } else {
      sub.textContent = task.discoveryPrivate
        ? "Private listing · negotiate scope via XMTP before claiming"
        : task.claimable
          ? "Open on " + (taskMarket(task) === "micro" ? "Micro" : "Standard") + " · claim access is an oracle-priced AZL fee; Action Credits cover eligible claims"
          : "State: " + task.state;
      }
    }
    if (status) {
      status.textContent = "";
      status.className = "rd-market-detail-status";
    }

    if (scope && scopeText) {
      if (task.description) {
        scopeText.textContent = task.description;
        scope.hidden = false;
      } else if (task.discoveryPrivate) {
        scopeText.textContent =
          "Private listing — scope is not published onchain. Agents must negotiate terms via XMTP before claiming.";
        scope.hidden = false;
      } else {
        scopeText.textContent = "";
        scope.hidden = true;
      }
    }

    const stateBadge =
      '<span class="rd-market-detail-badge rd-market-detail-badge--' +
      (task.claimable ? "open" : stateTone(task.state)) +
      '">' +
      escapeHtml(task.state) +
      "</span>";

    grid.innerHTML =
      detailRow("Market", taskMarket(task) === "micro" ? "Micro" : "Standard") +
      detailRow("Status", stateBadge) +
      detailRow(
        "Task amount",
        '<span class="rd-market-amount">' +
          escapeHtml(fmtAzl(taskAmount(task))) +
          '</span><span class="rd-market-usd">' +
          escapeHtml(fmtUsd(taskAmount(task))) +
          "</span>"
      ) +
      detailRow("Escrow locked", escapeHtml(fmtAzl(task.lockedAzl))) +
      detailRow(
        "Escrow funded",
        task.funded ? "Yes — full budget locked" : "Not yet — locks when poster funds"
      ) +
      detailRow("Deadline", escapeHtml(fmtDate(task.deadline))) +
      (task.listingDeadlineDays
        ? detailRow("Duration posted", escapeHtml(task.listingDeadlineDays + " days"))
        : "") +
      detailRow("Posted", escapeHtml(fmtDate(task.createdAt) + " (" + fmtAgo(task.createdAt) + ")")) +
      (task.updatedAt
        ? detailRow("Updated", escapeHtml(fmtDate(task.updatedAt)))
        : "") +
      detailRow("Poster", basescanAddr(task.poster)) +
      (task.worker ? detailRow("Worker", basescanAddr(task.worker)) : "") +
      detailRow("Settlement digest", "<code>" + escapeHtml(fmtDigest(task.settlementDigest)) + "</code>") +
      (task.protocolVersion === "v1-archived"
        ? detailRow("Protocol", "V1 archive — no V2 actions available")
        : "");

    grid.hidden = false;
    if (note) note.hidden = !task.description;

    if (links) {
      links.innerHTML =
        '<a href="' +
        BASESCAN +
        "/address/" +
        task.registryAddress +
        '" target="_blank" rel="noopener">TaskRegistry on BaseScan</a>' +
        '<a href="' +
        BASESCAN +
        "/address/" +
        task.escrowAddress +
        '" target="_blank" rel="noopener">Escrow vault</a>' +
        (task.protocolVersion === "v1-archived"
          ? '<span class="rd-market-archive-inline">Archived V1 only — do not use with the V2 wallet.</span>'
          : "");
      links.hidden = false;
    }

    if (actions) {
      const api = walletApi();
      const address = api?.address?.toLowerCase();
      const canClaim =
        task.protocolVersion !== "v1-archived" &&
        task.state === "POSTED" &&
        address &&
        address !== task.poster?.toLowerCase();
      actions.innerHTML = canClaim
        ? '<button type="button" class="rd-action rd-action--primary" id="rd-market-claim">Claim task</button>' +
          '<p class="rd-market-claim-note" id="rd-market-claim-note">Checking AZL collateral and Base gas…</p>'
        : "";
      actions.hidden = !canClaim;
      if (canClaim) {
        $("rd-market-claim")?.addEventListener("click", () => claimTask(task));
        showClaimReadiness(api, namespacedTaskId(task));
      }
    }
  }

  async function showClaimReadiness(api, taskId) {
    const note = $("rd-market-claim-note");
    try {
      const readiness = await api.claimReadiness(taskId);
      if (!note) return;
      const collateral = readiness.hasCollateral
        ? "Collateral ready"
        : "Need " + fmtAzl(Number(readiness.shortfallAzl) * 1e18) + " more available AZL";
      const accessFee = readiness.usesActionCredit
        ? "access fee waived by Action Credit"
        : "access fee " + fmtAzl(Number(readiness.chargedAccessFeeAzl) * 1e18);
      note.textContent =
        "Latched at posting: entry floor " +
        fmtAzl(Number(readiness.entryDepositAzl) * 1e18) +
        ", reserve locked " +
        fmtAzl(Number(readiness.liveTaskReserveAzl) * 1e18) +
        ", " +
        accessFee +
        ". Required available: " +
        fmtAzl(Number(readiness.requiredAvailableAzl) * 1e18) +
        " · " +
        collateral +
        " · " +
        (readiness.hasGas ? "Base gas ready" : "add ETH for Base gas") +
        ". Final eligibility is checked onchain.";
    } catch {
      if (note) note.textContent = "Latched claim quote unavailable. The contract checks eligibility when you claim.";
    }
  }

  async function claimTask(task) {
    const api = walletApi();
    if (!api?.address) {
      setDetailStatus("Sign in top-right to claim.", "err");
      return;
    }
    const button = $("rd-market-claim");
    if (button) button.disabled = true;
    try {
      setDetailStatus("Confirm the claim in your wallet…", "busy");
      const result = await api.claimV2(namespacedTaskId(task), (message) => {
        setDetailStatus(message, "busy");
      });
      setDetailStatus("Claimed on Base: " + result.hash, "ok");
      await loadOpenTasks();
      if (openTaskId) await openDetail(openTaskId);
    } catch (error) {
      setDetailStatus(error?.message ?? "Could not claim task", "err");
      if (button) button.disabled = false;
    }
  }

  function setDetailStatus(text, kind) {
    const el = $("rd-market-detail-status");
    if (!el) return;
    el.textContent = text;
    el.className = "rd-market-detail-status" + (kind ? " " + kind : "");
  }

  function syncUrl(taskId) {
    const url = new URL(window.location.href);
    if (taskId) {
      url.searchParams.set("task", taskId);
    } else {
      url.searchParams.delete("task");
      url.searchParams.delete("id");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function closeDetail() {
    const modal = $("rd-market-detail-modal");
    if (!modal || modal.hidden) return;
    if (closeModalTimer) window.clearTimeout(closeModalTimer);
    modal.classList.remove("rd-market-detail-modal--open");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (!modal.classList.contains("rd-market-detail-modal--open")) modal.hidden = true;
    };
    modal.addEventListener("transitionend", (e) => {
      if (e.target === modal && e.propertyName === "opacity") finish();
    }, { once: true });
    closeModalTimer = window.setTimeout(finish, 320);
    openTaskId = null;
    syncUrl(null);
    document.body.classList.remove("rd-market-modal-open");
    document.querySelector(".rd-market-detail-panel")?.scrollTo({ top: 0, behavior: "auto" });
  }

  async function openDetail(taskId) {
    const modal = $("rd-market-detail-modal");
    const grid = $("rd-market-detail-grid");
    const note = $("rd-market-detail-note");
    const links = $("rd-market-detail-links");
    if (!modal || !taskId) return;

    if (closeModalTimer) window.clearTimeout(closeModalTimer);
    openTaskId = String(taskId);
    modal.hidden = false;
    modal.querySelector(".rd-market-detail-panel")?.scrollTo({ top: 0, behavior: "auto" });
    modal.classList.remove("rd-market-detail-modal--open");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("rd-market-detail-modal--open"));
    });
    document.body.classList.add("rd-market-modal-open");
    syncUrl(openTaskId);

    if (grid) grid.hidden = true;
    if ($("rd-market-detail-scope")) $("rd-market-detail-scope").hidden = true;
    if (note) note.hidden = true;
    if (links) links.hidden = true;
    setDetailStatus("Loading task #" + openTaskId + "…", "busy");

    try {
      const task = await fetchTaskDetail(openTaskId);
      activeTask = task;
      renderDetail(task);
    } catch (e) {
      setDetailStatus((e && e.message) || "Could not load task", "err");
    }
  }

  function marketBadge(task) {
    const micro = taskMarket(task) === "micro";
    return (
      '<span class="rd-market-lane' +
      (micro ? " rd-market-lane--micro" : "") +
      '">' +
      (micro ? "Micro" : "Standard") +
      "</span>"
    );
  }

  function renderOpenRows(tasks) {
    const tbody = $("rd-market-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks
      .map(
        (t) =>
          "<tr class=\"rd-market-row\" data-id=\"" +
          escapeHtml(t.id) +
          "\" tabindex=\"0\" role=\"button\" aria-label=\"Open task #" +
          escapeHtml(displayTaskId(t)) +
          "\">" +
          "<td><span class=\"rd-market-id\">#" +
          escapeHtml(displayTaskId(t)) +
          "</span>" +
          marketBadge(t) +
          "</td>" +
          "<td>" +
          amountCell(taskAmount(t)) +
          "</td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.poster || "") +
          "\">" +
          shortAddr(t.poster) +
          "</span></td>" +
          "<td>" +
          fmtAgo(t.createdAt) +
          "</td>" +
          "<td><span class=\"rd-market-open-hint\">View</span></td>" +
          "</tr>"
      )
      .join("");
    bindRowClicks(tbody);
  }

  function renderHistoryRows(tasks) {
    const tbody = $("rd-market-history-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks
      .map(
        (t) =>
          "<tr class=\"rd-market-row\" data-id=\"" +
          escapeHtml(t.id) +
          "\" tabindex=\"0\" role=\"button\" aria-label=\"Open task #" +
          escapeHtml(displayTaskId(t)) +
          "\">" +
          "<td><span class=\"rd-market-id\">#" +
          escapeHtml(displayTaskId(t)) +
          "</span>" +
          marketBadge(t) +
          "</td>" +
          "<td>" +
          stateBadge(t.state) +
          "</td>" +
          "<td>" +
          amountCell(taskAmount(t)) +
          "</td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.poster || "") +
          "\">" +
          shortAddr(t.poster) +
          "</span></td>" +
          "<td><span class=\"rd-market-addr\" title=\"" +
          escapeHtml(t.worker || "") +
          "\">" +
          (t.worker ? shortAddr(t.worker) : "—") +
          "</span></td>" +
          "<td>" +
          fmtAgo(t.createdAt) +
          "</td>" +
          "<td><span class=\"rd-market-open-hint\">View</span></td>" +
          "</tr>"
      )
      .join("");
    bindRowClicks(tbody);
  }

  function renderLegacyRows(tasks) {
    const tbody = $("rd-market-legacy-rows");
    if (!tbody) return;
    tbody.innerHTML = tasks.map((t) =>
      "<tr class=\"rd-market-row\" data-id=\"" + escapeHtml(t.id) + "\" tabindex=\"0\" role=\"button\">" +
      "<td><span class=\"rd-market-id\">#" + escapeHtml(t.id) + "</span></td>" +
      "<td>" + escapeHtml(fmtAzl(t.taskAmountAzl)) + "</td>" +
      "<td><span class=\"rd-market-addr\" title=\"" + escapeHtml(t.poster || "") + "\">" + shortAddr(t.poster) + "</span></td>" +
      "<td>" + escapeHtml(fmtAgo(t.createdAt)) + "</td>" +
      "<td><span class=\"rd-market-open-hint\">Read only</span></td></tr>"
    ).join("");
    bindRowClicks(tbody);
  }

  async function loadOpenTasks() {
    const tableWrap = $("rd-market-table-wrap");
    const empty = $("rd-market-empty");
    const foot = $("rd-market-foot");

    setStatus("Loading Standard and Micro tasks…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = true;

    try {
      const [, tasks] = await Promise.all([fetchAzlUsdPrice(), fetchOpenTasks()]);
      if (!tasks.length) {
        setStatus("No POSTED tasks on Standard or Micro.", undefined);
        if (empty) empty.hidden = false;
        if (currentView === "open") closeDetail();
        return;
      }

      renderOpenRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      if (foot) foot.hidden = false;
      setStatus(
        tasks.length +
          " open task" +
          (tasks.length === 1 ? "" : "s") +
          " on Standard and Micro · click a row for details.",
        "ok"
      );

      if (openTaskId) {
        openDetail(openTaskId);
      }
    } catch (e) {
      const msg = (e && e.message) || "Could not load open tasks";
      setStatus(msg, "err");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        setTimeout(loadOpenTasks, 30000);
      }
    }
  }

  async function loadHistoryTasks() {
    const tableWrap = $("rd-market-history-wrap");
    const empty = $("rd-market-history-empty");
    const foot = $("rd-market-history-foot");

    setStatus("Loading task history…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = true;

    try {
      const [, tasks] = await Promise.all([fetchAzlUsdPrice(), fetchRecentTasks()]);
      if (!tasks.length) {
        setStatus("No tasks indexed yet.", undefined);
        if (empty) empty.hidden = false;
        return;
      }

      renderHistoryRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      if (foot) foot.hidden = false;
      setStatus(
        tasks.length + " recent task" + (tasks.length === 1 ? "" : "s") + " on Base · click a row for details.",
        "ok"
      );

      if (openTaskId) {
        openDetail(openTaskId);
      }
    } catch (e) {
      const msg = (e && e.message) || "Could not load task history";
      setStatus(msg, "err");
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        setTimeout(loadHistoryTasks, 30000);
      }
    }
  }

  async function loadLegacyTasks() {
    const tableWrap = $("rd-market-legacy-wrap");
    const empty = $("rd-market-legacy-empty");
    const foot = $("rd-market-legacy-foot");
    setStatus("Loading archived V1 tasks…", "busy");
    if (tableWrap) tableWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = false;
    try {
      const [, tasks] = await Promise.all([fetchAzlUsdPrice(), fetchLegacyTasks()]);
      if (!tasks.length) {
        setStatus("No archived V1 tasks found.", undefined);
        if (empty) empty.hidden = false;
        return;
      }
      renderLegacyRows(tasks);
      if (tableWrap) tableWrap.hidden = false;
      setStatus(tasks.length + " archived V1 task" + (tasks.length === 1 ? "" : "s") + " · read only.", undefined);
    } catch (e) {
      const msg = (e && e.message) || "";
      if (msg === "not_found" || msg.toLowerCase().includes("not found")) {
        setStatus("Archived V1 data is unavailable in this deployment.", undefined);
        if (empty) {
          empty.textContent = "No archived V1 data is available here. V1 is historical and no longer maintained.";
          empty.hidden = false;
        }
      } else if (msg.toLowerCase().includes("rate") || msg.includes("429")) {
        setStatus("V1 archive RPC is busy. Try refresh in a moment.", undefined);
        if (empty) {
          empty.textContent = "The archived V1 registry is live, but its public RPC is rate-limited right now.";
          empty.hidden = false;
        }
      } else {
        setStatus(msg || "Could not load archived V1 tasks", "err");
      }
    }
  }

  function loadCurrentView() {
    if (currentView === "history") return loadHistoryTasks();
    if (currentView === "legacy") return loadLegacyTasks();
    return loadOpenTasks();
  }

  function syncViewUrl() {
    const url = new URL(window.location.href);
    if (currentView === "history") {
      url.searchParams.set("view", "history");
    } else {
      url.searchParams.delete("view");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function setView(view) {
    const next = view === "history" || view === "legacy" ? view : "open";
    currentView = next;

    const openTab = $("rd-market-view-open");
    const historyTab = $("rd-market-view-history");
    const legacyTab = $("rd-market-view-legacy");
    const openPanel = $("rd-market-panel-open");
    const historyPanel = $("rd-market-panel-history");
    const legacyPanel = $("rd-market-panel-legacy");
    const title = $("rd-market-title");
    const lead = $("rd-market-lead");

    if (openTab) {
      openTab.classList.toggle("on", next === "open");
      openTab.setAttribute("aria-selected", next === "open" ? "true" : "false");
    }
    if (historyTab) {
      historyTab.classList.toggle("on", next === "history");
      historyTab.setAttribute("aria-selected", next === "history" ? "true" : "false");
    }
    if (legacyTab) {
      legacyTab.classList.toggle("on", next === "legacy");
      legacyTab.setAttribute("aria-selected", next === "legacy" ? "true" : "false");
    }
    if (openPanel) openPanel.hidden = next !== "open";
    if (historyPanel) historyPanel.hidden = next !== "history";
    if (legacyPanel) legacyPanel.hidden = next !== "legacy";

    if (title) title.textContent = next === "history" ? "Task history" : next === "legacy" ? "V1 archive" : "Open market";
    if (lead) {
      lead.textContent =
        next === "history"
          ? "Recent tasks across all states on Base — settled, active, and closed."
          : next === "legacy"
            ? "Archived V1 tasks — read-only historical reference, not part of the actively maintained protocol."
          : "All POSTED v2 tasks on Base — access is oracle-priced in AZL; Action Credits cover eligible claims.";
    }

    syncViewUrl();
    loadCurrentView();
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadCurrentView, 120000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("rd-market-refresh")?.addEventListener("click", loadCurrentView);
    $("rd-market-filter-apply")?.addEventListener("click", loadCurrentView);
    $("rd-market-view-open")?.addEventListener("click", () => setView("open"));
    $("rd-market-view-history")?.addEventListener("click", () => setView("history"));
    $("rd-market-view-legacy")?.addEventListener("click", () => setView("legacy"));
    $("rd-market-detail-close")?.addEventListener("click", closeDetail);
    $("rd-market-detail-backdrop")?.addEventListener("click", closeDetail);
    window.addEventListener("azzle-wallet-change", () => {
      if (activeTask && !($("rd-market-detail-modal")?.hidden)) renderDetail(activeTask);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("rd-market-detail-modal")?.hidden) closeDetail();
    });

    const params = new URLSearchParams(window.location.search);
    openTaskId = params.get("task") || params.get("id");
    const view = params.get("view");
    if (view === "history" || view === "legacy") currentView = view;

    setView(currentView);
    scheduleRefresh();
  });
})();
