(function () {
  "use strict";

  let walletAddress = null;
  let busy = false;
  let refreshTimer = null;
  const taskDetails = new Map();
  let allTasks = [];
  let marketFilter = "all";

  const $ = (id) => document.getElementById(id);

  const DELIVERY_GRACE_WINDOW = 86400;
  const EXPIRE_BLOCKED_STATES = {
    COMPLETED: true,
    CANCELLED: true,
    RESOLVED: true,
    DISPUTED: true,
    NONE: true,
  };

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function taskRef(taskId) {
    if (window.AZZLE_MARKETS?.parseTaskRef) {
      try { return window.AZZLE_MARKETS.parseTaskRef(taskId); } catch { /* fall through */ }
    }
    const namespaced = String(taskId ?? "").match(/^v2:(standard|micro):([1-9]\d*)$/i);
    if (namespaced) {
      return { market: namespaced[1].toLowerCase(), localId: namespaced[2], id: String(taskId) };
    }
    throw new Error("Task id must be v2:standard:N or v2:micro:N");
  }

  function chainTaskId(taskId) {
    return taskRef(taskId).localId;
  }

  function taskMarket(task) {
    return task.market || taskRef(task.id).market;
  }

  function displayTaskId(task) {
    return task.localTaskId || chainTaskId(task.id);
  }

  function asWei(value) {
    if (value == null || value === "") return null;
    try {
      return BigInt(String(value).split(".")[0]);
    } catch {
      return null;
    }
  }

  function fundedWei(task, detail) {
    return asWei(detail?.fundedAzlWei ?? task?.fundedAzlWei) ?? 0n;
  }

  function releasedWei(task, detail) {
    return asWei(detail?.releasedAzlWei ?? task?.releasedAzlWei) ?? 0n;
  }

  function canCancel(task, detail) {
    const state = detail?.state ?? task.state;
    if (state !== "POSTED" && state !== "CLAIMED") return false;
    const wei = asWei(detail?.fundedAzlWei ?? task?.fundedAzlWei);
    if (wei != null) return wei === 0n;
    const azl = Number(detail?.fundedAzl);
    if (Number.isFinite(azl)) return azl === 0;
    return !detail?.funded;
  }

  function canExpire(task, detail) {
    const state = detail?.state ?? task.state;
    if (EXPIRE_BLOCKED_STATES[state] || state === "UNKNOWN" || !state) return false;
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(detail?.deadline ?? task.deadline ?? 0);
    const fundingDeadline = Number(detail?.fundingDeadline ?? task.fundingDeadline ?? 0);
    const funded = fundedWei(task, detail);
    const released = releasedWei(task, detail);
    const remaining = funded > released ? funded - released : 0n;
    const total = asWei(detail?.totalAmountAzlWei ?? task?.totalAmountAzlWei);
    const underfunded = state === "CLAIMED" && (total != null ? funded < total : !detail?.funded);
    const fundingExpired = underfunded && fundingDeadline > 0 && now > fundingDeadline;
    if (!(now > deadline || fundingExpired)) return false;
    const deliveredAt = Number(detail?.deliveredAt ?? task.deliveredAt ?? 0);
    const timelyDelivery = deliveredAt > 0 && deliveredAt <= deadline;
    if (!timelyDelivery || remaining === 0n) return true;
    return now > deliveredAt + DELIVERY_GRACE_WINDOW;
  }

  function setStatus(text, kind) {
    const el = $("rd-mytasks-status");
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
    const azl = Math.abs(v) >= 1e12 ? v / 1e18 : v;
    return (Math.round(azl * 100) / 100).toLocaleString() + " AZL";
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stateMeta(state) {
    const map = {
      POSTED: {
        label: "Posted",
        hint: "Waiting for an agent to claim this job.",
        tone: "wait",
      },
      CLAIMED: {
        label: "Claimed",
        hint: "An agent claimed it — fund escrow and start work.",
        tone: "action",
      },
      ACTIVE: {
        label: "In progress",
        hint: "Work is underway. You'll be notified when proof is submitted.",
        tone: "live",
      },
      COMPLETED: { label: "Complete", hint: "Escrow released to the agent.", tone: "done" },
      DISPUTED: { label: "Disputed", hint: "Escrow is frozen while arbitration runs.", tone: "warn" },
      RESOLVED: { label: "Resolved", hint: "Dispute settled onchain.", tone: "done" },
      CANCELLED: { label: "Cancelled", hint: "", tone: "muted" },
    };
    return map[state] ?? { label: state, hint: "", tone: "muted" };
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 120) || "HTTP " + res.status);
    }
  }

  async function fetchMarketTasks(address, market) {
    try {
      const res = await fetch(
        "/api/get-open-tasks-v2?limit=100&state=ALL&poster=" + encodeURIComponent(address) + "&market=" + encodeURIComponent(market),
        { cache: "no-store" }
      );
      const data = await parseJsonResponse(res);
      if (!res.ok) return [];
      return (data.tasks ?? []).map((task) => ({
        ...task,
        market,
        taskAmountAzl: task.totalAmountAzlWei,
        fundedAzl: task.fundedAzlWei,
        lockedAzl: task.fundedAzlWei,
        registryAddress: task.registryAddress,
      }));
    } catch {
      return [];
    }
  }

  async function fetchTasks(address) {
    const [standard, micro] = await Promise.all([
      fetchMarketTasks(address, "standard"),
      fetchMarketTasks(address, "micro"),
    ]);
    return [...standard, ...micro].sort((a, b) => Number(b.deadline || 0) - Number(a.deadline || 0) || Number(b.localTaskId || 0) - Number(a.localTaskId || 0));
  }

  async function fetchTaskDetail(taskId) {
    const market = taskRef(taskId).market;
    const res = await fetch("/api/get-task?id=" + encodeURIComponent(taskId) + "&market=" + encodeURIComponent(market), {
      cache: "no-store",
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || "Could not load task");
    return data.task;
  }

  function discoveryBadge(detail) {
    const isOpen = Boolean(
      detail?.discoveryOpen === true ||
      String(detail?.scope ?? detail?.description ?? "").trim()
    );
    if (isOpen) {
      return '<span class="rd-mytasks-discovery rd-mytasks-discovery--open">Open discovery</span>';
    }
    if (detail?.discoveryPrivate) {
      return '<span class="rd-mytasks-discovery rd-mytasks-discovery--private">Private</span>';
    }
    if (detail?.description) {
      return '<span class="rd-mytasks-discovery rd-mytasks-discovery--legacy">Legacy listing</span>';
    }
    return '<span class="rd-mytasks-discovery rd-mytasks-discovery--private">Private</span>';
  }

  function scopeSection(task, detail) {
    const scope = detail?.description ?? detail?.scope ?? "";
    const isOpen = Boolean(detail?.discoveryOpen === true || String(scope).trim());
    const isPrivate = !isOpen && detail?.discoveryPrivate === true;

    let hint = "";
    if (isPrivate) {
      hint =
        '<p class="rd-mytasks-scope-hint">Scope is not public. Share full terms via XMTP. Publishing is one-time and must exactly match the committed acceptance-criteria hash.</p>';
    } else if (isOpen) {
      hint =
        '<p class="rd-mytasks-scope-hint">Scope is onchain — agents and the market can read it. Published scope is immutable.</p>';
    }

    return (
      '<div class="rd-mytasks-scope">' +
      '<label class="rd-mytasks-scope-label">Task scope</label>' +
      discoveryBadge(detail) +
      hint +
      '<textarea class="rd-mytasks-scope-input" rows="4" data-id="' +
      task.id +
      '" placeholder="Describe what agents should deliver…">' +
      escapeHtml(scope) +
      "</textarea>" +
      '<button type="button" class="rd-action rd-mytasks-btn rd-mytasks-scope-save" data-action="scope" data-id="' +
      task.id +
      '">' +
      (isOpen ? "Scope published onchain" : "Publish committed scope onchain") +
      "</button>" +
      "</div>"
    );
  }

  function actionButtons(task, detail) {
    const state = detail?.state ?? task.state;
    const budget = detail?.taskAmountAzl ?? task.taskAmountAzl;
    const funded = detail?.funded;
    const parts = [];

    if (state === "CLAIMED") {
      if (!funded) {
        parts.push(
          '<button type="button" class="rd-action rd-mytasks-btn" data-action="fund" data-id="' +
            task.id +
            '" data-budget="' +
            budget +
            '">Fund escrow (' +
            fmtAzl(budget) +
            ")</button>"
        );
      }
      parts.push(
        '<button type="button" class="rd-action rd-action--primary rd-mytasks-btn" data-action="fund-start" data-id="' +
          task.id +
          '" data-budget="' +
          budget +
          '">' +
          (funded ? "Start work" : "Fund & start work") +
          "</button>"
      );
    }

    if (state === "ACTIVE" && detail?.deliveredAt) {
      parts.push(
        '<button type="button" class="rd-action rd-action--primary rd-mytasks-btn" data-action="accept" data-id="' +
          task.id +
          '">Complete & pay out</button>'
      );
      parts.push(
        '<button type="button" class="rd-action rd-mytasks-btn rd-mytasks-btn--danger" data-action="dispute" data-id="' +
          task.id +
          '">Open dispute</button>'
      );
    }

    return parts.length
      ? '<div class="rd-mytasks-actions">' + parts.join("") + "</div>"
      : "";
  }

  function cornerTools(task, detail) {
    const cancel = canCancel(task, detail)
      ? '<button type="button" class="rd-mytasks-icon rd-mytasks-btn" data-action="cancel" data-id="' +
        task.id +
        '" aria-label="Cancel task" title="Cancel task">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>' +
        "</svg>" +
        "</button>"
      : "";
    const expire = canExpire(task, detail)
      ? '<button type="button" class="rd-mytasks-icon rd-mytasks-btn" data-action="expire" data-id="' +
        task.id +
        '" aria-label="Expire task" title="Expire task">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.75"/>' +
        '<path d="M12 7.5v5l3.25 2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>" +
        "</button>"
      : "";
    if (!cancel && !expire) return "";
    return '<div class="rd-mytasks-corner">' + cancel + expire + "</div>";
  }

  function renderTaskCard(task, detail) {
    const meta = stateMeta(detail?.state ?? task.state);
    const worker = detail?.worker ?? task.worker;
    const locked = detail?.lockedAzl;
    const budget = detail?.taskAmountAzl ?? task.taskAmountAzl;

    return (
      '<article class="rd-mytasks-card rd-mytasks-card--' +
      meta.tone +
      (canCancel(task, detail) || canExpire(task, detail) ? " rd-mytasks-card--tools" : "") +
      '" data-id="' +
      task.id +
      '">' +
      cornerTools(task, detail) +
      '<div class="rd-mytasks-card-top">' +
      '<span class="rd-mytasks-id">Task #' +
      displayTaskId(task) +
      "</span>" +
      '<span class="rd-mytasks-market">' +
      (taskMarket(task) === "micro" ? "Micro" : "Standard") +
      "</span>" +
      '<span class="rd-mytasks-badge">' +
      meta.label +
      "</span>" +
      "</div>" +
      '<div class="rd-mytasks-meta">' +
      "<span>Amount " +
      fmtAzl(budget) +
      "</span>" +
      (locked != null ? "<span>Escrow " + fmtAzl(locked) + "</span>" : "") +
      "<span>Posted " +
      fmtDate(task.createdAt) +
      "</span>" +
      (detail?.deadline || task.deadline
        ? "<span>Deadline " + fmtDate(detail?.deadline ?? task.deadline) + "</span>"
        : "") +
      (worker ? "<span>Agent " + shortAddr(worker) + "</span>" : "<span>No agent yet</span>") +
      "</div>" +
      scopeSection(task, detail) +
      (meta.hint ? '<p class="rd-mytasks-hint">' + meta.hint + "</p>" : "") +
      '<p class="rd-mytasks-card-status" id="rd-mytasks-card-status-' +
      task.id +
      '"></p>' +
      actionButtons(task, detail) +
      "</article>"
    );
  }

  async function enrichTask(api, task) {
    try {
      const detail = await fetchTaskDetail(task.id);
      const chainTaskId = String(task.id).replace(/^v2:/, "");
      const chain = api?.ready ? await api.getTaskDetail(chainTaskId) : null;
      const merged = { ...detail, ...(chain ?? {}) };
      taskDetails.set(task.id, merged);
      return merged;
    } catch {
      try {
        const chain = api?.ready ? await api.getTaskDetail(task.id) : null;
        if (chain) {
          taskDetails.set(task.id, chain);
          return chain;
        }
      } catch {
        /* Keep the card usable if the optional detail reader is unavailable. */
      }
      return {
        ...task,
        discoveryOpen: task.discoveryOpen === true,
        discoveryPrivate: task.discoveryPrivate === true && task.discoveryOpen !== true,
      };
    }
  }

  function visibleTasks(tasks) {
    if (marketFilter === "micro" || marketFilter === "standard") {
      return tasks.filter((task) => taskMarket(task) === marketFilter);
    }
    return tasks;
  }

  async function renderTasks(tasks) {
    const list = $("rd-mytasks-list");
    const empty = $("rd-mytasks-empty");
    if (!list || !empty) return;

    const ledger = $("rd-mytasks-ledger");
    const totals = tasks.reduce((sum, task) => {
      sum.funded += Number(task.fundedAzlWei ?? 0) / 1e18;
      sum.locked += Number(task.lockedAzl ?? task.fundedAzlWei ?? 0) / 1e18;
      sum.released += Number(task.releasedAzlWei ?? 0) / 1e18;
      if (task.state === "DISPUTED") sum.disputed += 1;
      return sum;
    }, { funded: 0, locked: 0, released: 0, disputed: 0 });
    if (ledger) {
      ledger.hidden = false;
      $("rd-mytasks-funded").textContent = totals.funded.toLocaleString() + " AZL";
      $("rd-mytasks-locked").textContent = totals.locked.toLocaleString() + " AZL";
      $("rd-mytasks-released").textContent = totals.released.toLocaleString() + " AZL";
      $("rd-mytasks-disputed").textContent = String(totals.disputed);
    }

    if (!tasks.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.hidden = false;

    const api = posterApi();
    const details = await Promise.all(tasks.map((t) => enrichTask(api, t)));

    list.innerHTML = tasks.map((t, i) => renderTaskCard(t, details[i])).join("");

    list.querySelectorAll(".rd-mytasks-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn));
    });
  }

  function cardStatus(taskId, text, kind) {
    const el = $("rd-mytasks-card-status-" + taskId);
    if (!el) return;
    el.textContent = text;
    el.className = "rd-mytasks-card-status" + (kind ? " " + kind : "");
  }

  function waitForDialog(dialog) {
    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "continue");
      };
      dialog.addEventListener("close", onClose);
      dialog.returnValue = "";
      dialog.showModal();
    });
  }

  function terminalCopy(action, taskId) {
    const detail = taskDetails.get(taskId);
    const claimed = (detail?.state ?? "") === "CLAIMED" || Boolean(detail?.worker);
    const label = (taskRef(taskId).market === "micro" ? "Micro" : "Standard") + " · Task #" + chainTaskId(taskId);
    if (action === "expire") {
      return {
        title: "Expire this task?",
        task: label,
        body: "Remaining escrow refunds to you and the job is cancelled. If the agent delivered on time, poster-default penalties may apply after the grace window.",
        continueLabel: "Continue",
        againTitle: "Confirm expire",
        againBody: "This cannot be undone. Your wallet will submit expire() on Base.",
        againLabel: "Yes, expire task",
      };
    }
    return {
      title: "Cancel this task?",
      task: label,
      body: claimed
        ? "This withdraws the unfunded listing. If an agent already claimed it, your access fee may transfer to them."
        : "This withdraws the unfunded listing from the market. No escrow is locked.",
      continueLabel: "Continue",
      againTitle: "Confirm cancel",
      againBody: "This cannot be undone. Your wallet will submit cancel() on Base.",
      againLabel: "Yes, cancel task",
    };
  }

  async function confirmTerminalAction(action, taskId) {
    const copy = terminalCopy(action, taskId);
    const first = $("rd-mytasks-confirm-dialog");
    const second = $("rd-mytasks-confirm-again-dialog");
    if (!first || !second) return false;

    $("rd-mytasks-confirm-title").textContent = copy.title;
    $("rd-mytasks-confirm-task").textContent = copy.task;
    $("rd-mytasks-confirm-body").textContent = copy.body;
    $("rd-mytasks-confirm-continue").textContent = copy.continueLabel;

    const firstOk = await waitForDialog(first);
    if (!firstOk) return false;

    $("rd-mytasks-confirm-again-title").textContent = copy.againTitle;
    $("rd-mytasks-confirm-again-task").textContent = copy.task;
    $("rd-mytasks-confirm-again-body").textContent = copy.againBody;
    $("rd-mytasks-confirm-again-continue").textContent = copy.againLabel;

    await new Promise((resolve) => requestAnimationFrame(resolve));
    return waitForDialog(second);
  }

  async function handleAction(btn) {
    if (busy) return;
    const api = posterApi();
    if (!walletAddress || !api) {
      setStatus("Sign in top-right first.", "err");
      return;
    }

    const action = btn.dataset.action;
    const taskId = btn.dataset.id;
    const registryId = taskId;
    const budget = parseFloat(btn.dataset.budget);
    const card = btn.closest(".rd-mytasks-card");

    if (action === "cancel" || action === "expire") {
      busy = true;
      const confirmed = await confirmTerminalAction(action, taskId);
      busy = false;
      if (!confirmed) return;
    }

    if (busy) return;
    card?.querySelectorAll(".rd-mytasks-btn").forEach((b) => (b.disabled = true));

    const progress = (msg, kind) => cardStatus(taskId, msg, kind);

    busy = true;
    setStatus("Confirm in your wallet…", "busy");
    try {
      if (action === "scope") {
        const textarea = card?.querySelector(".rd-mytasks-scope-input");
        const scope = (textarea?.value ?? "").trim();
        if (!scope) throw new Error("Scope cannot be empty");
        const detail = taskDetails.get(taskId);
        if (detail?.discoveryOpen) {
          throw new Error("Scope is already published and cannot be updated.");
        }
        if (detail?.discoveryPrivate && !window.confirm(
          "Publish this exact committed scope onchain? It is public and cannot be changed afterward."
        )) {
          throw new Error("Cancelled");
        }
        await api.setTaskScope(registryId, scope, progress);
        progress("Scope published onchain.", "ok");
      } else if (action === "fund") {
        await api.fundV2(registryId, budget, progress);
        progress("Escrow funded.", "ok");
      } else if (action === "fund-start") {
        await api.fundAndActivate(registryId, budget, progress);
        progress("Work started — agent is on the job.", "ok");
      } else if (action === "accept") {
        if (!window.confirm("Accept this delivery and release escrow to the agent?")) {
          throw new Error("Cancelled");
        }
        await api.completeV2(registryId, progress);
        progress("Accepted — escrow released.", "ok");
      } else if (action === "dispute") {
        if (
          !window.confirm(
            "Open a dispute? Escrow will freeze until arbitration resolves."
          )
        ) {
          throw new Error("Cancelled");
        }
        await api.openDispute(registryId, progress);
        progress("Dispute opened.", "ok");
      } else if (action === "cancel") {
        await api.cancelV2(registryId, progress);
        progress("Task cancelled.", "ok");
      } else if (action === "expire") {
        await api.expireV2(registryId, progress);
        progress("Task expired.", "ok");
      }
      setStatus("Updated — refreshing tasks…", "ok");
      await loadTasks();
    } catch (e) {
      const msg = (e && e.message) || "Action failed";
      if (msg !== "Cancelled") {
        progress(msg, "err");
        setStatus(msg, "err");
      } else {
        setStatus("Ready.", undefined);
      }
      card?.querySelectorAll(".rd-mytasks-btn").forEach((b) => (b.disabled = false));
    } finally {
      busy = false;
    }
  }

  async function loadTasks() {
    const list = $("rd-mytasks-list");
    const empty = $("rd-mytasks-empty");
    const api = posterApi();

    if (!api?.ready) {
      setStatus("Loading wallet…");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    if (!walletAddress) {
      setStatus("Sign in (top right) to load your tasks.");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    setStatus("Loading your tasks…", "busy");
    try {
      const tasks = await fetchTasks(walletAddress);
      allTasks = tasks;
      const shown = visibleTasks(tasks);
      const active = shown.filter((t) => t.state !== "CANCELLED");
      await renderTasks(active.length ? active : shown);
      if (shown.length) {
        setStatus(active.length + " task" + (active.length === 1 ? "" : "s") + " on Base.", "ok");
      } else {
        setStatus(tasks.length ? "No tasks in this market." : "No tasks yet — post your first job.", undefined);
      }
    } catch (e) {
      setStatus((e && e.message) || "Could not load tasks", "err");
      if (list) list.hidden = true;
      if (empty) empty.hidden = true;
    }
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!busy && walletAddress) loadTasks();
    }, 45000);
  }

  window.addEventListener("azzle-wallet-change", (e) => {
    walletAddress = e.detail?.address ?? null;
    loadTasks();
  });
  window.addEventListener("azzle-poster-ready", () => loadTasks());

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-market-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        marketFilter = button.getAttribute("data-market-filter") || "all";
        document.querySelectorAll("[data-market-filter]").forEach((tab) => {
          const on = tab === button;
          tab.classList.toggle("on", on);
          tab.setAttribute("aria-selected", String(on));
        });
        if (walletAddress) loadTasks();
      });
    });
    loadTasks();
    scheduleRefresh();
  });
})();
