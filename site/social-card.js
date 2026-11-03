(function () {
  "use strict";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function render(card) {
    return (
      '<article class="rd-social-card" data-share-url="' + esc(card.url) + '" data-share-title="' + esc(card.title) + '" data-share-text="' + esc(card.shareText || card.body) + '">' +
      '<p class="rd-social-card-kicker">' + esc(card.kicker || "AZZLE") + "</p>" +
      "<h3>" + esc(card.title) + "</h3>" +
      "<p>" + esc(card.body) + "</p>" +
      (card.meta ? '<p class="rd-social-card-meta">' + esc(card.meta) + "</p>" : "") +
      '<div class="rd-social-card-actions">' +
      '<button type="button" class="rd-action" data-social-copy>Copy link</button>' +
      '<button type="button" class="rd-action rd-action--primary" data-social-share>Share</button>' +
      '<p class="rd-social-card-note" data-social-note></p>' +
      "</div></article>"
    );
  }

  async function copy(url, note) {
    try {
      await navigator.clipboard.writeText(url);
      if (note) note.textContent = "Link copied.";
    } catch {
      if (note) note.textContent = url;
    }
  }

  function bind(root) {
    const card = root?.querySelector?.(".rd-social-card");
    if (!card || card.dataset.bound === "1") return;
    card.dataset.bound = "1";
    const url = card.dataset.shareUrl || "";
    const note = card.querySelector("[data-social-note]");
    card.querySelector("[data-social-copy]")?.addEventListener("click", () => copy(url, note));
    card.querySelector("[data-social-share]")?.addEventListener("click", async () => {
      const payload = {
        title: card.dataset.shareTitle || "AZZLE",
        text: card.dataset.shareText || "",
        url,
      };
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
        }
      }
      await copy(url, note);
    });
  }

  window.azzleSocialCard = { render, bind };
})();
