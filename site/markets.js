(function (global) {
  "use strict";

  var ZERO = "0x0000000000000000000000000000000000000000";
  var STORAGE_KEY = "azzle-market";
  var ECONOMICS = {
    standard: {
      id: "standard",
      label: "Standard",
      range: "$6 – $10k",
      entryDepositUsd: 25,
      liveTaskReserveUsd: 8,
      accessFeeUsd: 5,
      exitCompensationUsd: 2.5,
      exitProtocolShareUsd: 2.5,
      minTaskUsd: 6,
      maxTaskUsd: 10000,
      postingFloorUsd: 45,
      postingFloorUsd6: 45000000,
      creditRate: "1 credit / 30d / 100M AZL",
      creditCap: "600,000",
    },
    micro: {
      id: "micro",
      label: "Micro",
      range: "$0.60 – $50",
      entryDepositUsd: 3,
      liveTaskReserveUsd: 1,
      accessFeeUsd: 0.5,
      exitCompensationUsd: 0.25,
      exitProtocolShareUsd: 0.25,
      minTaskUsd: 0.6,
      maxTaskUsd: 50,
      postingFloorUsd: 5,
      postingFloorUsd6: 5000000,
      creditRate: "1 credit / 30d / 10M AZL",
      creditCap: "6,000,000",
    },
  };

  function normalizeMarket(value) {
    var market = String(value || "").trim().toLowerCase();
    if (market === "micro" || market === "standard") return market;
    if (!market) return "standard";
    throw new Error("Unknown market '" + value + "'. Use standard or micro.");
  }

  function money(n) {
    var value = Number(n);
    if (!Number.isFinite(value)) return "—";
    if (value >= 1000) return "$" + value.toLocaleString("en-US");
    if (Number.isInteger(value)) return "$" + value;
    return "$" + value.toFixed(2);
  }

  function economics(market) {
    return ECONOMICS[normalizeMarket(market || getSelectedMarket())];
  }

  function marketForBudget(usd) {
    var n = Number(usd);
    if (!Number.isFinite(n) || n <= 0) return "standard";
    return n > 50 ? "standard" : "micro";
  }

  function copyFor(market) {
    var e = economics(market);
    return {
      name: e.label,
      range: e.range,
      floor: money(e.postingFloorUsd),
      entry: money(e.entryDepositUsd),
      live: money(e.liveTaskReserveUsd),
      access: money(e.accessFeeUsd),
      exit: money(e.exitCompensationUsd) + " / " + money(e.exitProtocolShareUsd),
      minTask: money(e.minTaskUsd),
      maxTask: money(e.maxTaskUsd),
      budgetRange: money(e.minTaskUsd) + " – " + money(e.maxTaskUsd),
      creditRate: e.creditRate,
      creditCap: e.creditCap,
    };
  }

  function getSelectedMarket() {
    try {
      var query = new URLSearchParams(global.location.search).get("market");
      if (query === "micro" || query === "standard") return query;
      var stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored === "micro" || stored === "standard") return stored;
    } catch (_) { /* ignore */ }
    return "standard";
  }

  function setSelectedMarket(market, options) {
    var next = normalizeMarket(market);
    try { global.localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* ignore */ }
    try {
      var url = new URL(global.location.href);
      url.searchParams.set("market", next);
      global.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (_) { /* ignore */ }
    bindEconomics(global.document);
    syncSwitchers();
    if (!(options && options.silent)) {
      global.dispatchEvent(new CustomEvent("azzle-market-change", { detail: { market: next } }));
    }
    return next;
  }

  function namespacedTaskId(market, localId) {
    var id = String(localId);
    if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid local task id");
    return "v2:" + normalizeMarket(market) + ":" + id;
  }

  function parseTaskRef(raw) {
    var value = String(raw || "").trim();
    var namespaced = value.match(/^v2:(standard|micro):([1-9]\d*)$/i);
    if (namespaced) {
      return { market: namespaced[1].toLowerCase(), localId: namespaced[2], id: namespacedTaskId(namespaced[1], namespaced[2]) };
    }
    if (/^v2:\d+$/i.test(value)) {
      throw new Error("Unscoped task id v2:N is illegal. Use v2:standard:N or v2:micro:N.");
    }
    if (/^\d+$/.test(value)) {
      throw new Error("Bare numeric task ids are illegal. Use v2:standard:N or v2:micro:N.");
    }
    throw new Error("Invalid task id");
  }

  function withMarket(url, market) {
    var u = new URL(url, global.location.origin);
    u.searchParams.set("market", normalizeMarket(market || getSelectedMarket()));
    return u.pathname + u.search + u.hash;
  }

  function isMarketLive(manifest) {
    var registry = manifest && manifest.taskRegistry;
    return Boolean(registry) && registry.toLowerCase() !== ZERO && manifest.status !== "pending";
  }

  function bindEconomics(root) {
    if (!root || !root.querySelectorAll) return;
    var copy = copyFor();
    root.querySelectorAll("[data-market-copy]").forEach(function (node) {
      var key = node.getAttribute("data-market-copy");
      if (key && copy[key] != null) node.textContent = copy[key];
    });
  }

  function optionHtml(id, current) {
    var e = ECONOMICS[id];
    var on = current === id;
    return (
      '<button type="button" class="azzle-market-switch-option' + (on ? " on" : "") + '" data-market="' + id + '" role="radio" aria-checked="' + on + '">' +
        '<span class="azzle-market-switch-name">' + e.label + '</span>' +
        '<span class="azzle-market-switch-meta">' + money(e.accessFeeUsd) + ' per task</span>' +
      "</button>"
    );
  }

  function updateSwitchGlider(switchEl) {
    var glider = switchEl.querySelector(".azzle-market-switch-glider");
    var active = switchEl.querySelector(".azzle-market-switch-option.on");
    if (!glider || !active) return;
    glider.style.left = active.offsetLeft + "px";
    glider.style.top = active.offsetTop + "px";
    glider.style.width = active.offsetWidth + "px";
    glider.style.height = active.offsetHeight + "px";
    glider.style.opacity = "1";
  }

  function mountSwitch(root) {
    var host = typeof root === "string" ? document.querySelector(root) : root;
    if (!host) return;
    var current = getSelectedMarket();
    var context = host.getAttribute("data-switch-context") || "market";
    host.innerHTML =
      '<div class="azzle-market-switch" role="radiogroup" aria-label="Choose ' + context + ' market">' +
        '<span class="azzle-market-switch-glider" aria-hidden="true"></span>' +
        optionHtml("standard", current) +
        optionHtml("micro", current) +
      "</div>";
    host.querySelectorAll("[data-market]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.getAttribute("data-market") === getSelectedMarket()) return;
        setSelectedMarket(button.getAttribute("data-market"));
      });
    });
    requestAnimationFrame(function () {
      var switchEl = host.querySelector(".azzle-market-switch");
      if (switchEl) updateSwitchGlider(switchEl);
    });
  }

  function syncSwitchers() {
    var current = getSelectedMarket();
    if (!global.document) return;
    global.document.querySelectorAll(".azzle-market-switch [data-market]").forEach(function (button) {
      var on = button.getAttribute("data-market") === current;
      button.classList.toggle("on", on);
      button.setAttribute("aria-checked", String(on));
    });
    global.document.querySelectorAll(".azzle-market-switch").forEach(updateSwitchGlider);
  }

  global.AZZLE_MARKETS = {
    ECONOMICS: ECONOMICS,
    STORAGE_KEY: STORAGE_KEY,
    normalizeMarket: normalizeMarket,
    getSelectedMarket: getSelectedMarket,
    setSelectedMarket: setSelectedMarket,
    economics: economics,
    marketForBudget: marketForBudget,
    money: money,
    copyFor: copyFor,
    bindEconomics: bindEconomics,
    namespacedTaskId: namespacedTaskId,
    parseTaskRef: parseTaskRef,
    withMarket: withMarket,
    isMarketLive: isMarketLive,
    mountSwitch: mountSwitch,
  };

  if (global.document) {
    function boot() {
      global.document.querySelectorAll("[data-azzle-market-switch]").forEach(mountSwitch);
      bindEconomics(global.document);
      global.addEventListener("resize", function () {
        global.document.querySelectorAll(".azzle-market-switch").forEach(updateSwitchGlider);
      }, { passive: true });
    }
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(window);
