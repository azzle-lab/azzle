(function () {
  "use strict";

  let taskRooms = [];
  let session = null;
  let chats = [];
  let view = "list";
  let threadMeta = { title: "Inbox", otherLabel: "Them" };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function artifactHref(uri) {
    const value = String(uri ?? "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("ipfs://")) {
      return "https://ipfs.io/ipfs/" + value.slice(7).replace(/^ipfs\//, "");
    }
    if (value.startsWith("ar://")) return "https://arweave.net/" + value.slice(5);
    return null;
  }

  function urlsFromText(value) {
    return String(value ?? "").match(/https?:\/\/[^\s<>"']+/gi) || [];
  }

  function displayText(message) {
    const raw = String(message?.text ?? "").trim();
    if (!raw) return "";
    if (raw.includes("initiatedByInboxId") && raw.includes("addedInboxes")) return "";
    if (raw.startsWith("{") && (raw.includes("DeliveryNotice") || raw.includes("azzle-xmtp-v2"))) {
      return message?.notice?.summary || "Delivery notice";
    }
    if (raw.startsWith("{") && raw.length > 400) return "Structured XMTP message";
    return raw;
  }

  function renderLinks(message) {
    const uris = [...(message?.notice?.artifactUris ?? []), ...urlsFromText(message?.text)];
    const links = [];
    const seen = new Set();
    for (const uri of uris) {
      const href = artifactHref(uri);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      links.push(
        '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(href) + "</a>"
      );
    }
    return links.length ? '<div class="rd-mytasks-delivery-links">' + links.join("") + "</div>" : "";
  }

  function renderMessage(message, otherLabel) {
    const body = displayText(message);
    const links = renderLinks(message);
    if (!body && !links) return "";
    const when = message.sentAt ? new Date(message.sentAt).toLocaleString() : "";
    return (
      '<article class="rd-task-chat-msg' + (message.mine ? " is-mine" : "") + '">' +
      '<span class="rd-task-chat-who">' + (message.mine ? "You" : escapeHtml(otherLabel || "Them")) + (when ? " · " + escapeHtml(when) : "") + "</span>" +
      (body ? "<p>" + escapeHtml(body) + "</p>" : "") +
      links +
      "</article>"
    );
  }

  function previewText(chat) {
    const body = displayText(chat?.last);
    return body || (chat?.last?.notice ? "Delivery notice" : "No messages yet");
  }

  function posterApi() {
    return window.azzlePoster ?? null;
  }

  function signedIn() {
    return Boolean(posterApi()?.address);
  }

  function waitForPoster() {
    if (window.azzlePoster) return Promise.resolve(window.azzlePoster);
    return new Promise((resolve) => {
      const done = () => resolve(window.azzlePoster);
      window.addEventListener("azzle-poster-ready", done, { once: true });
      setTimeout(done, 5000);
    });
  }

  function setStatus(text) {
    const node = $("rd-inbox-status");
    if (node) node.textContent = text || "";
  }

  function setExpanded(open) {
    const dock = $("rd-inbox-dock");
    const fab = $("rd-inbox-fab");
    if (!dock || !fab) return;
    dock.classList.toggle("is-collapsed", !open);
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    fab.setAttribute("aria-label", open ? "Collapse inbox" : "Open inbox");
  }

  function isExpanded() {
    return !$("rd-inbox-dock")?.classList.contains("is-collapsed");
  }

  function paintTaskRoomList() {
    const list = $("rd-inbox-list");
    const thread = $("rd-inbox-thread");
    const back = $("rd-inbox-back");
    const title = $("rd-inbox-title");
    const form = $("rd-inbox-form");
    if (!list || !thread) return;
    view = "list";
    list.hidden = false;
    thread.hidden = true;
    if (form) form.hidden = true;
    if (back) back.hidden = true;
    const refresh = $("rd-inbox-refresh");
    if (refresh) refresh.hidden = true;
    if (title) title.textContent = "Task chats";
    if (!taskRooms.length) {
      list.innerHTML = '<p class="rd-receipt-note">No task chatrooms yet. Claimed tasks appear here.</p>';
      return;
    }
    list.innerHTML = taskRooms.map((room, index) => {
      const subtitle = room.subtitle || room.otherLabel || "Private XMTP chat";
      return (
        '<button type="button" class="rd-inbox-item" data-task-index="' + index + '">' +
        '<span class="rd-inbox-item-who">' + escapeHtml(room.taskId) + "</span>" +
        '<span class="rd-inbox-item-preview">' + escapeHtml(subtitle) + "</span>" +
        "</button>"
      );
    }).join("");
    list.querySelectorAll("[data-task-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const room = taskRooms[Number(button.dataset.taskIndex)];
        if (room) openThread(room);
      });
    });
  }

  function paintList() {
    if (taskRooms.length) {
      paintTaskRoomList();
      return;
    }
    const list = $("rd-inbox-list");
    const thread = $("rd-inbox-thread");
    const back = $("rd-inbox-back");
    const title = $("rd-inbox-title");
    const form = $("rd-inbox-form");
    if (!list || !thread) return;
    view = "list";
    list.hidden = false;
    thread.hidden = true;
    if (form) form.hidden = true;
    if (back) back.hidden = true;
    const refresh = $("rd-inbox-refresh");
    if (refresh) refresh.hidden = true;
    if (title) title.textContent = "Inbox";
    if (!chats.length) {
      list.innerHTML = '<p class="rd-receipt-note">No private conversations on this installation yet.</p>';
      return;
    }
    list.innerHTML = chats.map((chat, index) => {
      const when = chat.last?.sentAt ? new Date(chat.last.sentAt).toLocaleString() : "";
      return (
        '<button type="button" class="rd-inbox-item" data-index="' + index + '">' +
        '<span class="rd-inbox-item-who">' + escapeHtml(chat.peerLabel || "Unknown") + "</span>" +
        '<span class="rd-inbox-item-preview">' + escapeHtml(previewText(chat)) + "</span>" +
        (when ? '<span class="rd-inbox-item-when">' + escapeHtml(when) + "</span>" : "") +
        "</button>"
      );
    }).join("");
    list.querySelectorAll("[data-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const chat = chats[Number(button.dataset.index)];
        if (chat) openThread(chat);
      });
    });
  }

  function paintThread(messages, emptyNote) {
    const log = $("rd-inbox-log");
    if (!log) return;
    const html = (messages ?? []).map((message) => renderMessage(message, threadMeta.otherLabel)).filter(Boolean).join("");
    log.innerHTML = html || '<p class="rd-receipt-note">' + escapeHtml(emptyNote) + "</p>";
    log.scrollTop = log.scrollHeight;
  }

  function closeSession() {
    session?.unsubscribe?.();
    session = null;
  }

  async function loadList() {
    const api = posterApi();
    if (!signedIn()) {
      chats = [];
      paintList();
      setStatus("Sign in (top right) to open private chat.");
      return;
    }
    setStatus("Opening inbox…");
    try {
      const result = await api.listInboxChats((message) => setStatus(message));
      chats = result?.chats ?? [];
      paintList();
      setStatus(chats.length ? chats.length + " conversation" + (chats.length === 1 ? "" : "s") : "No conversations yet");
    } catch (error) {
      chats = [];
      paintList();
      setStatus(error?.message ?? "Could not open inbox.");
    }
  }

  async function openThread(target) {
    const api = posterApi();
    const list = $("rd-inbox-list");
    const thread = $("rd-inbox-thread");
    const back = $("rd-inbox-back");
    const title = $("rd-inbox-title");
    const form = $("rd-inbox-form");
    const input = $("rd-inbox-input");
    if (!api?.openTaskChat) {
      setStatus("Sign in first.");
      return;
    }
    closeSession();
    view = "thread";
    threadMeta = {
      title: target.title || ("Chat · " + (target.peerLabel || "Inbox")),
      otherLabel: target.otherLabel || "Them",
    };
    if (list) list.hidden = true;
    if (thread) thread.hidden = false;
    if (form) form.hidden = false;
    if (back) back.hidden = false;
    const refresh = $("rd-inbox-refresh");
    if (refresh) refresh.hidden = false;
    if (title) title.textContent = threadMeta.title;
    paintThread([], "Opening XMTP…");
    setStatus("Opening private chat…");
    try {
      const chat = await api.openTaskChat(
        { peer: target.peerAddress || target.peer, conversationId: target.conversationId },
        (message) => setStatus(message)
      );
      session = {
        chat,
        unsubscribe: chat.subscribe((messages) => {
          paintThread(messages, "No messages yet. Send one below.");
        }),
      };
      paintThread(
        chat.messages,
        "No delivery text on this installation yet. Keep another AZZLE tab open with this wallet, then retry history."
      );
      setStatus(
        chat.messages.length
          ? "Private XMTP chat · " + chat.messages.length + " message" + (chat.messages.length === 1 ? "" : "s")
          : "Private XMTP chat · waiting for history or a new message"
      );
      input?.focus();
    } catch (error) {
      paintThread([], error?.message ?? "Could not open chat.");
      setStatus(error?.message ?? "Could not open chat.");
    }
  }

  async function expandAndLoad() {
    setExpanded(true);
    await waitForPoster();
    if (view === "thread" && session) return;
    if (taskRooms.length) {
      paintTaskRoomList();
      setStatus(taskRooms.length + " task chatroom" + (taskRooms.length === 1 ? "" : "s"));
      return;
    }
    await loadList();
  }

  let roomOpens = Promise.resolve();
  function enqueueRoomOpen(task) {
    const run = roomOpens.then(task, task);
    roomOpens = run.then(() => undefined, () => undefined);
    return run;
  }

  function bindRoom(root, { peer, otherLabel, onProgress } = {}) {
    if (!root) return () => {};
    const log = root.querySelector("[data-room-log]");
    const form = root.querySelector("[data-room-form]");
    const input = root.querySelector("[data-room-input]");
    const sendButton = root.querySelector("[data-room-send]");
    const refreshButton = root.querySelector("[data-room-refresh]");
    const status = root.querySelector("[data-room-status]");
    let stopped = false;
    let unsub = () => {};
    const setRoomStatus = (text) => {
      if (status) status.textContent = text || "";
    };
    const paint = (messages, emptyNote) => {
      if (!log) return;
      const html = (messages ?? [])
        .map((message) => renderMessage(message, otherLabel || "Them"))
        .filter(Boolean)
        .join("");
      log.innerHTML = html || '<p class="rd-receipt-note">' + escapeHtml(emptyNote) + "</p>";
      log.scrollTop = log.scrollHeight;
    };

    if (!peer || !/^0x[a-fA-F0-9]{40}$/.test(peer) || /^0x0{40}$/i.test(peer)) {
      paint([], "Chat opens when a worker claims this task.");
      setRoomStatus("Waiting for a worker.");
      if (form) form.hidden = true;
      if (refreshButton) refreshButton.hidden = true;
      return () => {};
    }

    if (form) form.hidden = false;
    if (refreshButton) refreshButton.hidden = false;
    paint([], "Opening chat…");
    setRoomStatus("Opening private chat…");

    let chat = null;
    const sendMessage = async () => {
      const text = (input?.value ?? "").trim();
      if (!text) return;
      if (!chat) {
        setRoomStatus("Still opening chat…");
        return;
      }
      if (sendButton) sendButton.disabled = true;
      try {
        const messages = await chat.send(text);
        if (input) input.value = "";
        paint(messages, "No messages yet.");
        setRoomStatus("Sent.");
      } catch (error) {
        setRoomStatus(error?.message ?? "Could not send.");
      } finally {
        if (sendButton) sendButton.disabled = false;
        input?.focus();
      }
    };
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        sendMessage();
      });
    }
    if (sendButton) sendButton.disabled = true;

    const connectChat = async () => {
      await waitForPoster();
      if (stopped) return;
      const api = posterApi();
      if (!api?.openTaskChat) {
        setRoomStatus("Sign in to chat.");
        return;
      }
      paint([], "Opening chat…");
      setRoomStatus("Opening private chat…");
      if (sendButton) sendButton.disabled = true;
      try {
        chat = await enqueueRoomOpen(() => {
          if (stopped) return null;
          return api.openTaskChat({ peer }, (message) => {
            if (!stopped) setRoomStatus(message);
            onProgress?.(message);
          });
        });
        if (stopped || !chat) return;
        unsub = chat.subscribe((messages) => {
          paint(messages, "No messages yet. Send one below.");
        }) || (() => {});
        paint(
          chat.messages,
          "No messages on this installation yet. Keep another AZZLE tab open with this wallet, then retry history."
        );
        setRoomStatus(
          chat.messages.length
            ? chat.messages.length + " message" + (chat.messages.length === 1 ? "" : "s")
            : "Waiting for history or a new message"
        );
        if (sendButton) sendButton.disabled = false;
      } catch (error) {
        chat = null;
        if (!stopped) {
          paint([], error?.message ?? "Could not open chat.");
          setRoomStatus((error?.message ?? "Could not open chat.") + " · use Retry history");
        }
      }
    };

    if (refreshButton) {
      refreshButton.onclick = async () => {
        refreshButton.disabled = true;
        try {
          if (!chat) {
            await connectChat();
            return;
          }
          setRoomStatus("Retrying history sync…");
          const messages = await chat.refresh();
          paint(
            messages,
            "Still no messages on this installation. Open another AZZLE tab with the same wallet, then retry."
          );
          setRoomStatus(
            messages.length
              ? "History updated · " + messages.length + " messages"
              : "No archive received yet from another installation"
          );
        } catch (error) {
          setRoomStatus(error?.message ?? "Could not refresh history.");
        } finally {
          refreshButton.disabled = false;
        }
      };
    }

    connectChat();

    return () => {
      stopped = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
    };
  }

  function mount() {
    if ($("rd-inbox-dock")) return;
    const dock = document.createElement("div");
    dock.id = "rd-inbox-dock";
    dock.className = "rd-inbox-dock is-collapsed";
    dock.innerHTML =
      '<div class="rd-inbox-panel" id="rd-inbox-panel">' +
      '<header class="rd-inbox-head">' +
      '<button type="button" class="rd-inbox-back" id="rd-inbox-back" hidden aria-label="Back to inbox">←</button>' +
      '<strong id="rd-inbox-title">Inbox</strong>' +
      '<button type="button" class="rd-inbox-refresh-btn" id="rd-inbox-refresh" hidden>Retry</button>' +
      '<button type="button" class="rd-inbox-collapse" id="rd-inbox-collapse" aria-label="Collapse inbox">×</button>' +
      "</header>" +
      '<p class="rd-inbox-status" id="rd-inbox-status"></p>' +
      '<div class="rd-inbox-list" id="rd-inbox-list"></div>' +
      '<div class="rd-inbox-thread" id="rd-inbox-thread" hidden>' +
      '<div class="rd-inbox-log" id="rd-inbox-log"></div>' +
      "</div>" +
      '<form id="rd-inbox-form" class="rd-inbox-compose" hidden>' +
      '<textarea id="rd-inbox-input" rows="1" placeholder="Message…"></textarea>' +
      '<button type="submit" class="rd-action rd-action--primary" id="rd-inbox-send">Send</button>' +
      "</form></div>" +
      '<button type="button" class="rd-inbox-fab" id="rd-inbox-fab" aria-expanded="false" aria-label="Open inbox">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>' +
      "</button>";
    document.body.appendChild(dock);

    $("rd-inbox-fab")?.addEventListener("click", () => {
      if (isExpanded()) setExpanded(false);
      else expandAndLoad();
    });
    $("rd-inbox-collapse")?.addEventListener("click", () => setExpanded(false));
    $("rd-inbox-back")?.addEventListener("click", () => {
      closeSession();
      paintList();
      setStatus(
        taskRooms.length
          ? taskRooms.length + " task chatroom" + (taskRooms.length === 1 ? "" : "s")
          : (chats.length ? chats.length + " conversation" + (chats.length === 1 ? "" : "s") : "")
      );
    });
    $("rd-inbox-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("rd-inbox-input");
      const sendButton = $("rd-inbox-send");
      const text = (input?.value ?? "").trim();
      if (!text || !session?.chat) return;
      if (sendButton) sendButton.disabled = true;
      try {
        const messages = await session.chat.send(text);
        if (input) input.value = "";
        paintThread(messages, "No messages yet.");
        setStatus("Sent.");
      } catch (error) {
        setStatus(error?.message ?? "Could not send.");
      } finally {
        if (sendButton) sendButton.disabled = false;
        input?.focus();
      }
    });
    $("rd-inbox-refresh")?.addEventListener("click", async () => {
      if (!session?.chat) return;
      const button = $("rd-inbox-refresh");
      if (button) button.disabled = true;
      try {
        setStatus("Retrying history sync…");
        const messages = await session.chat.refresh();
        paintThread(
          messages,
          "Still no delivery text on this installation. Open another AZZLE tab with the same wallet, then retry."
        );
        setStatus(
          messages.length
            ? "History updated · " + messages.length + " messages"
            : "No archive received yet from another installation"
        );
      } catch (error) {
        setStatus(error?.message ?? "Could not refresh history.");
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  window.azzleInboxDock = {
    open() {
      mount();
      return expandAndLoad();
    },
    collapse() {
      setExpanded(false);
    },
    syncTaskRooms(rooms) {
      taskRooms = (rooms ?? [])
        .filter((room) => room?.taskId && room?.peer && /^0x[a-fA-F0-9]{40}$/.test(room.peer) && !/^0x0{40}$/i.test(room.peer))
        .map((room) => ({
          taskId: String(room.taskId),
          peer: room.peer,
          peerAddress: room.peer,
          peerLabel: String(room.taskId),
          title: String(room.taskId),
          otherLabel: room.otherLabel || "Them",
          subtitle: room.subtitle || "",
        }));
      if (isExpanded() && view === "list") {
        paintTaskRoomList();
        setStatus(taskRooms.length + " task chatroom" + (taskRooms.length === 1 ? "" : "s"));
      }
    },
    clearTaskRooms() {
      taskRooms = [];
      if (isExpanded() && view === "list") paintList();
    },
    bindRoom(root, options) {
      return bindRoom(root, options);
    },
    openTask(taskId, options = {}) {
      const room =
        taskRooms.find((entry) => entry.taskId === taskId) ||
        (options.peer
          ? {
              taskId: String(taskId),
              peer: options.peer,
              peerAddress: options.peer,
              peerLabel: String(taskId),
              title: String(taskId),
              otherLabel: options.otherLabel || "Them",
            }
          : null);
      if (!room?.peer) {
        mount();
        setExpanded(true);
        setStatus("No chat peer for this task yet.");
        return Promise.resolve();
      }
      mount();
      setExpanded(true);
      return waitForPoster().then(() => openThread(room));
    },
    openPeer(peer, options = {}) {
      mount();
      setExpanded(true);
      const title = options.title || options.taskId || "Task chat";
      return waitForPoster().then(() => openThread({
        peer,
        peerAddress: peer,
        peerLabel: title,
        title,
        otherLabel: options.otherLabel || "Them",
        conversationId: options.conversationId,
      }));
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
