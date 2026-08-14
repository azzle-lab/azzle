(function () {
  "use strict";
  const body = document.body;
  if (!body?.classList.contains("page-docs")) return;

  const key = "azzle-docs-background";
  const themes = {
    lime: "#dfff00",
    paper: "#f7f8f2",
    night: "#101217",
    ice: "#eaf4ff",
    rose: "#fff0f3",
  };
  const stored = localStorage.getItem(key) || themes.lime;

  function apply(value) {
    const palettes = {
      "#dfff00": {
        bg:"#dfff00", surface:"#edff56", s2:"#d4f500", card:"#f5ff84",
        text:"#151b00", muted:"#354000", dim:"#586600", heading:"#0a0e00",
        accent:"#263300", accentLo:"#465400", onAccent:"#eaff00",
        border:"rgba(20,28,0,.28)", borderStrong:"rgba(20,28,0,.46)",
        row:"rgba(20,28,0,.11)", green:"#263300", cyan:"#07595e",
        amber:"#765000", magenta:"#771f63", slate:"#4e5a00"
      },
      "#f7f8f2": {
        bg:"#f7f8f2", surface:"#ffffff", s2:"#eef1e5", card:"#ffffff",
        text:"#151b00", muted:"#3d4800", dim:"#5c6800", heading:"#080c00",
        accent:"#263300", accentLo:"#465400", onAccent:"#f3ff9b",
        border:"rgba(20,28,0,.18)", borderStrong:"rgba(20,28,0,.34)",
        row:"rgba(20,28,0,.07)", green:"#263300", cyan:"#07595e",
        amber:"#765000", magenta:"#771f63", slate:"#4e5a00"
      },
      "#101217": {
        bg:"#101217", surface:"#191c23", s2:"#222631", card:"#1b1f27",
        text:"#edf2df", muted:"#bdc8a5", dim:"#899471", heading:"#ffffff",
        accent:"#dfff00", accentLo:"#aac400", onAccent:"#111500",
        border:"rgba(235,245,220,.16)", borderStrong:"rgba(235,245,220,.3)",
        row:"rgba(235,245,220,.07)", green:"#dfff00", cyan:"#7ee8dc",
        amber:"#ffd36e", magenta:"#ff8cdd", slate:"#b4c4a5"
      },
      "#eaf4ff": {
        bg:"#eaf4ff", surface:"#f7fbff", s2:"#dcecff", card:"#ffffff",
        text:"#10243a", muted:"#31516d", dim:"#55718a", heading:"#071a2d",
        accent:"#0c466f", accentLo:"#327da8", onAccent:"#eaf6ff",
        border:"rgba(11,48,88,.18)", borderStrong:"rgba(11,48,88,.34)",
        row:"rgba(11,48,88,.07)", green:"#0c466f", cyan:"#07595e",
        amber:"#765000", magenta:"#771f63", slate:"#24527e"
      },
      "#fff0f3": {
        bg:"#fff0f3", surface:"#fff9fa", s2:"#ffe1e7", card:"#ffffff",
        text:"#351522", muted:"#6b3b4b", dim:"#966274", heading:"#280b16",
        accent:"#8f2345", accentLo:"#c15e7e", onAccent:"#fff0f4",
        border:"rgba(86,18,39,.18)", borderStrong:"rgba(86,18,39,.34)",
        row:"rgba(86,18,39,.06)", green:"#8f2345", cyan:"#07595e",
        amber:"#765000", magenta:"#8f2345", slate:"#8f4358"
      }
    };
    const palette = palettes[value] || palettes["#dfff00"];
    body.dataset.docsBg = value;
    Object.entries({
      "--bg":palette.bg, "--surface":palette.surface, "--s2":palette.s2, "--card":palette.card,
      "--text":palette.text, "--muted":palette.muted, "--dim":palette.dim, "--heading":palette.heading,
      "--accent":palette.accent, "--accent-lo":palette.accentLo, "--on-accent":palette.onAccent,
      "--b":palette.border, "--b2":palette.borderStrong, "--line":palette.border,
      "--line-strong":palette.borderStrong, "--border-faint":palette.border, "--row-hover":palette.row,
      "--surface-strong":palette.surface, "--surface-raised":palette.card,
      "--green":palette.green, "--cyan":palette.cyan, "--amber":palette.amber,
      "--magenta":palette.magenta, "--slate":palette.slate
    }).forEach(([name, color]) => body.style.setProperty(name, color));
    body.removeAttribute("data-docs-custom");
    const select = document.querySelector("#docs-bg-select");
    if (select) select.value = value;
    const dot = document.querySelector(".docs-bg-trigger-dot");
    if (dot) dot.style.background = value;
  }

  const picker = document.createElement("div");
  picker.className = "docs-bg-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Documentation background");
  picker.innerHTML =
    '<span class="docs-bg-trigger-dot" aria-hidden="true"></span>' +
    '<label class="docs-bg-select-label"><span>Canvas</span><select id="docs-bg-select" aria-label="Documentation background">' +
    Object.keys(themes).map((name) => `<option value="${themes[name]}">${name}</option>`).join("") +
    "</select></label>";
  const navActions = document.querySelector(".azzle-nav-actions");
  const target = navActions || document.querySelector(".azzle-nav");
  if (target) target.appendChild(picker);

  picker.querySelector("#docs-bg-select").addEventListener("change", (event) => {
      const value = event.target.value;
      localStorage.setItem(key, value);
      apply(value);
  });
  apply(stored);
})();
