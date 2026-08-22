(function () {
  "use strict";
  const key = "azzle-theme";
  const root = document.documentElement;
  const stored = localStorage.getItem(key);
  if (stored === "light" || stored === "dark") root.dataset.theme = stored;
  else if (window.matchMedia("(prefers-color-scheme: light)").matches) root.dataset.theme = "light";

  function update(button) {
    const light = root.dataset.theme === "light";
    button.setAttribute("aria-pressed", light ? "true" : "false");
    button.setAttribute("aria-label", light ? "Use dark mode" : "Use light mode");
    button.title = light ? "Use dark mode" : "Use light mode";
    button.innerHTML = light ? "☾<span>Dark</span>" : "☼<span>Light</span>";
  }

  if (!document.querySelector("[data-theme-toggle]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "azzle-theme-toggle azzle-theme-toggle--floating";
    button.dataset.themeToggle = "";
    button.setAttribute("aria-pressed", "false");
    button.textContent = "☼";
    document.body.appendChild(button);
  }

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    update(button);
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "light" ? "dark" : "light";
      root.dataset.theme = next;
      localStorage.setItem(key, next);
      update(button);
    });
  });

  // Mobile navigation is a compact bottom dock. The AZZLE mark is its
  // launcher; the full link list lives in the animated drop-up above it.
  const mobileQuery = window.matchMedia("(max-width: 640px)");
  const navs = Array.from(document.querySelectorAll(".azzle-nav, .rd-subnav"));
  navs.forEach((nav) => {
    // Documentation has its own sidebar/menu. Do not expose a duplicate
    // "Docs" destination in the global navigation or mobile drop-up.
    nav.querySelectorAll(".azzle-nav-app a").forEach((link) => {
      const label = link.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      if (label === "docs") link.closest("li")?.remove();
    });
    let launcher = nav.querySelector(".azzle-nav-logo, .rd-subnav-logo");
    const menu = nav.querySelector(".azzle-nav-center");
    if (!launcher || !menu) return;

    // Do not leave the launcher as an <a href="/">. On mobile that anchor
    // competes with the drop-up and sends users to the chat home screen.
    if (launcher.tagName === "A") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = launcher.className;
      button.innerHTML = launcher.innerHTML;
      launcher.replaceWith(button);
      launcher = button;
    }
    launcher.setAttribute("role", "button");
    launcher.setAttribute("aria-label", "Open navigation");
    launcher.setAttribute("aria-expanded", "false");
    launcher.dataset.navLauncher = "";
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");

    const dropup = document.createElement("div");
    dropup.className = "mobile-nav-dropup";
    dropup.hidden = true;
    dropup.setAttribute("aria-hidden", "true");
    dropup.setAttribute("aria-label", "Navigation menu");
    const links = nav.querySelectorAll(".azzle-nav-app a, .azzle-nav-docs a, .rd-subnav-links a");
    links.forEach((link) => {
      const item = document.createElement("a");
      item.href = link.href;
      item.innerHTML = link.innerHTML;
      item.className = link.classList.contains("azzle-nav-on") ? "is-current" : "";
      dropup.appendChild(item);
    });
    document.body.appendChild(dropup);

    const setOpen = (open) => {
      if (!mobileQuery.matches) open = false;
      nav.classList.toggle("nav-menu-open", open);
      launcher.setAttribute("aria-expanded", String(open));
      launcher.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      menu.hidden = !open;
      menu.setAttribute("aria-hidden", String(!open));
      dropup.hidden = !open;
      dropup.setAttribute("aria-hidden", String(!open));
      dropup.classList.toggle("is-open", open);
    };

    const toggleFromLauncher = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!mobileQuery.matches) {
        window.location.assign("/");
        return;
      }
      setOpen(!nav.classList.contains("nav-menu-open"));
    };
    launcher.addEventListener("click", toggleFromLauncher);
    launcher.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && mobileQuery.matches) {
        event.preventDefault();
        toggleFromLauncher(event);
      }
    });

    dropup.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("click", (event) => {
      if (mobileQuery.matches && nav.classList.contains("nav-menu-open") &&
          !nav.contains(event.target) && !dropup.contains(event.target)) {
        setOpen(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    mobileQuery.addEventListener?.("change", () => {
      setOpen(false);
      if (!mobileQuery.matches) dropup.hidden = true;
    });
  });
})();
