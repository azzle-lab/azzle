(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const INTENTS = {
    ACCEPT_WORK: { outcome: 2, workerBps: 10000, onchain: true, note: "Escrow releases to the worker (100%)." },
    REJECT_WORK: { outcome: 1, workerBps: 0, onchain: true, note: "Remaining escrow refunds the poster (0% worker)." },
    SPLIT: { outcome: 3, workerBps: 5000, onchain: true, note: "50/50 split (protocol allows 10–90%)." },
    REQUEST_REVISION: { onchain: false, note: "Offchain. Ask the worker to revise; do not call rule() yet." },
    ESCALATE_HUMAN: { onchain: false, note: "Keep the dispute open and hand it to a human. Do not call rule()." },
  };

  const SANDBOX = [
    {
      id: "sandbox:audit-complete",
      title: "VulnerableBank audit — complete",
      market: "micro",
      state: "DISPUTED",
      poster: "0x1111111111111111111111111111111111111111",
      worker: "0x2222222222222222222222222222222222222222",
      description: JSON.stringify({
        taskType: "solidity-audit",
        source: "contract VulnerableBank { function withdraw() public {} }",
        completionCriteria: {
          items: [
            { id: "findings", description: "Report the posted issues", required: true },
            { id: "hash", description: "receiptHash matches report bytes", required: true },
          ],
        },
      }, null, 2),
      artifactUrl: "https://example.invalid/vulnerablebank-report.json",
      receiptHash: "0x09f92e73",
      expectedIntent: "ACCEPT_WORK",
      dispute: { statusName: "RULING", evidenceDeadline: 0, rulingDeadline: Math.floor(Date.now() / 1000) + 3600, opener: "0x1111111111111111111111111111111111111111", arbitrator: "0x3333333333333333333333333333333333333333", posterEvidence: "0x01", workerEvidence: "0x02" },
    },
    {
      id: "sandbox:empty-delivery",
      title: "Hash with no inspectable artifact",
      market: "micro",
      state: "DISPUTED",
      poster: "0x1111111111111111111111111111111111111111",
      worker: "0x2222222222222222222222222222222222222222",
      description: JSON.stringify({ taskType: "solidity-audit", address: "0x0000000000000000000000000000000000000001" }, null, 2),
      expectedIntent: "REQUEST_REVISION",
      dispute: { statusName: "EVIDENCE", evidenceDeadline: Math.floor(Date.now() / 1000) + 1800, rulingDeadline: 0 },
    },
    {
      id: "sandbox:wrong-contract",
      title: "Delivery audits a different address",
      market: "micro",
      state: "DISPUTED",
      poster: "0x1111111111111111111111111111111111111111",
      worker: "0x2222222222222222222222222222222222222222",
      description: JSON.stringify({ taskType: "solidity-audit", address: "0x0000000000000000000000000000000000000001" }, null, 2),
      artifactUrl: "https://example.invalid/wrong.json",
      expectedIntent: "REJECT_WORK",
      dispute: { statusName: "RULING", rulingDeadline: Math.floor(Date.now() / 1000) + 900 },
    },
  ];

  let source = "live";
  let tasks = [];
  let selectedId = null;
  let metrics = { cases: 0, intents: {} };

  function status(text, kind) {
    const el = $("arb-status");
    el.textContent = text;
    el.className = "rd-checkout-status" + (kind ? " " + kind : "");
  }

  function api() { return window.azzlePoster ?? null; }

  function criteriaFrom(scope) {
    try {
      const json = JSON.parse(scope);
      const items = json.completionCriteria?.items || json.acceptanceCriteria?.items;
      if (Array.isArray(items)) return items;
    } catch { /* prose scope */ }
    return [];
  }

  function preview(intent) {
    return INTENTS[intent] || INTENTS.ESCALATE_HUMAN;
  }

  function renderQueue() {
    const list = $("arb-queue-list");
    $("arb-queue-meta").textContent = String(tasks.length);
    if (!tasks.length) {
      list.innerHTML = '<p class="arb-empty">No open disputes in this view.</p>';
      return;
    }
    list.innerHTML = tasks.map((task) => {
      const due = Number(task.dispute?.rulingDeadline || task.dispute?.evidenceDeadline || task.deadline || 0);
      const urgent = due && due < Date.now() / 1000 + 3600;
      return (
        '<button type="button" class="arb-queue-item' + (task.id === selectedId ? " on" : "") + '" data-id="' + task.id + '">' +
        "<strong>" + (task.title || task.id) + "</strong>" +
        "<small>" + (task.market || "") + " · " + (task.dispute?.statusName || task.state) +
        (urgent ? ' <span class="arb-urgent">due soon</span>' : "") +
        "</small></button>"
      );
    }).join("");
    list.querySelectorAll(".arb-queue-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.dataset.id;
        renderQueue();
        renderDetail();
      });
    });
  }

  function selected() {
    return tasks.find((t) => t.id === selectedId) || null;
  }

  function renderDetail() {
    const task = selected();
    const root = $("arb-detail");
    if (!task) {
      root.innerHTML = '<p class="arb-empty" id="arb-empty">Select a dispute. Sandbox includes the VulnerableBank audit case from the pilot.</p>';
      return;
    }
    const scope = task.description || task.scope || "";
    const checks = criteriaFrom(scope);
    const rec = task.expectedIntent || "ESCALATE_HUMAN";
    const recPrev = preview(rec);
    root.innerHTML =
      '<div class="arb-panel-head"><div><h5>' + (task.title || task.id) + "</h5>" +
      '<span class="arb-muted">' + task.id + " · " + (task.dispute?.statusName || task.state) + "</span></div></div>" +
      '<div class="arb-grid">' +
      '<article class="arb-card"><h5>Requested</h5><pre>' + escapeHtml(scope || "(empty public scope)") + "</pre></article>" +
      '<article class="arb-card"><h5>Delivered</h5><p>receiptHash: ' + escapeHtml(task.receiptHash || "—") +
      "</p><p>artifact: " + (task.artifactUrl ? '<a href="' + task.artifactUrl + '" target="_blank" rel="noopener">' + escapeHtml(task.artifactUrl) + "</a>" : "—") +
      "</p><p class=\"arb-muted\">XMTP is optional. Public tasks may have no chat history.</p></article>" +
      '<article class="arb-card"><h5>Parties</h5><p>Poster ' + escapeHtml(short(task.poster)) + "</p><p>Worker " + escapeHtml(short(task.worker)) +
      "</p><p>Arbitrator " + escapeHtml(short(task.dispute?.arbitrator)) + "</p></article>" +
      '<article class="arb-card"><h5>Completion criteria</h5>' +
      (checks.length
        ? '<ul class="arb-check">' + checks.map((item) => "<li><input type=\"checkbox\" data-crit=\"" + escapeHtml(item.id || item.description) + "\"/> " + escapeHtml(item.description || item.id) + "</li>").join("") + "</ul>"
        : "<p class=\"arb-muted\">None declared. Judge the public scope vs the artifact.</p>") +
      "</article></div>" +
      '<p class="arb-preview" id="arb-preview"><strong>AI assist / sandbox hint:</strong> ' + rec.replaceAll("_", " ") + " — " + recPrev.note + "</p>" +
      '<div class="arb-reason"><label>Decision reasoning<textarea id="arb-reason" placeholder="Structured reason + evidence refs"></textarea></label></div>' +
      '<div class="arb-actions">' +
      Object.keys(INTENTS).map((intent) => '<button type="button" class="rd-action' + (INTENTS[intent].onchain ? " rd-action--primary" : "") + '" data-intent="' + intent + '">' + intent.replaceAll("_", " ") + "</button>").join("") +
      "</div>" +
      '<div class="arb-metrics"><span>Session decisions: ' + metrics.cases + "</span><span>Sandbox expected: " + (task.expectedIntent || "—") + "</span></div>";

    root.querySelectorAll("[data-intent]").forEach((btn) => {
      btn.addEventListener("click", () => decide(btn.dataset.intent, task));
    });
  }

  async function decide(intent, task) {
    const mapped = preview(intent);
    const reason = ($("arb-reason")?.value || "").trim();
    if (!reason) {
      status("Add a short reason before submitting.", "err");
      return;
    }
    $("arb-preview").innerHTML = "<strong>Settlement preview:</strong> " + mapped.note;
    metrics.cases += 1;
    metrics.intents[intent] = (metrics.intents[intent] || 0) + 1;
    if (source === "sandbox") {
      const ok = !task.expectedIntent || task.expectedIntent === intent;
      status(ok ? "Sandbox: that matches the expected outcome." : "Sandbox: expected " + task.expectedIntent + ", you chose " + intent + ".", ok ? "ok" : "err");
      renderDetail();
      return;
    }
    if (!mapped.onchain) {
      status(mapped.note + " Record the reason in XMTP or your case notes. No onchain rule() sent.", "ok");
      return;
    }
    const poster = api();
    if (!poster?.ruleDispute) {
      status("Sign in with a panel arbitrator wallet to submit rule(). Preview only for now.", "err");
      return;
    }
    try {
      status("Submitting " + intent + "…", "busy");
      await poster.ruleDispute(task.id, mapped.outcome, mapped.workerBps, (msg) => status(msg, "busy"));
      status("Ruled " + intent + ".", "ok");
      await loadLive();
    } catch (err) {
      status(err.message || "Rule failed", "err");
    }
  }

  function escapeHtml(value) {
    return String(value ?? "—")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
  function short(addr) {
    if (!addr || !/^0x/i.test(addr)) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  async function loadLive() {
    status("Loading disputed tasks…", "busy");
    try {
      const res = await fetch("/api/market/disputes?limit=25");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load disputes");
      tasks = data.tasks || [];
      selectedId = tasks[0]?.id || null;
      status(tasks.length ? "Open disputes, oldest deadline first." : "No live DISPUTED tasks in the scan window. Use Sandbox to rehearse.", tasks.length ? "ok" : "");
      renderQueue();
      renderDetail();
    } catch (err) {
      status(err.message || "Could not load disputes", "err");
    }
  }

  function loadSandbox() {
    tasks = SANDBOX;
    selectedId = tasks[0].id;
    status("Sandbox cases — no escrow. Grade yourself against the expected intent.", "ok");
    renderQueue();
    renderDetail();
  }

  document.querySelectorAll("[data-arb-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      source = btn.dataset.arbSource;
      document.querySelectorAll("[data-arb-source]").forEach((el) => {
        el.classList.toggle("on", el === btn);
        el.setAttribute("aria-selected", el === btn ? "true" : "false");
      });
      if (source === "sandbox") loadSandbox();
      else loadLive();
    });
  });

  loadLive();
})();
