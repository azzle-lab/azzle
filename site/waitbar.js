(function () {
  "use strict";

  const bootUntil = Date.now() + 8000;
  const startup = /could not (load|read)|failed to fetch|networkerror|429|too many requests|unavailable|did not respond|rate-?limited/i;

  function watched(el) {
    if (!el || el.nodeType !== 1) return false;
    return el.classList.contains("rd-checkout-status")
      || el.classList.contains("rd-market-detail-status")
      || el.classList.contains("rd-crowd-status")
      || el.classList.contains("rd-claim-confirm-status");
  }

  function hold(el) {
    if (!el || el.dataset.waitHeld || Date.now() >= bootUntil) return;
    const text = (el.textContent || "").trim();
    if (!el.classList.contains("err") || !startup.test(text)) return;
    el.dataset.waitHeld = text;
    el.classList.remove("err");
    el.classList.add("busy");
    el.textContent = "Starting…";
  }

  function release(el) {
    if (!el?.dataset.waitHeld) return;
    if ((el.textContent || "").trim() !== "Starting…") delete el.dataset.waitHeld;
  }

  function scan(root) {
    const nodes = [];
    if (watched(root)) nodes.push(root);
    root.querySelectorAll?.(".rd-checkout-status, .rd-market-detail-status, .rd-crowd-status, .rd-claim-confirm-status")
      .forEach((el) => nodes.push(el));
    nodes.forEach((el) => {
      release(el);
      hold(el);
    });
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (watched(el)) {
        release(el);
        hold(el);
      }
    }
  });

  function start() {
    scan(document);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.setTimeout(() => {
      document.querySelectorAll("[data-wait-held]").forEach((el) => {
        const held = el.dataset.waitHeld;
        if (!held || (el.textContent || "").trim() !== "Starting…") return;
        delete el.dataset.waitHeld;
        el.classList.remove("busy");
        el.classList.add("err");
        el.textContent = held;
      });
    }, Math.max(0, bootUntil - Date.now() + 40));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
