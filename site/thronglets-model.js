/** Census and chatter after https://github.com/danielvartan/thronglets */
(function (root) {
  const N_CHANGE = 5;
  const GLYPHS = "ѪԒҖϾҥҨӜԘ҂ҎѼӺҸҬӲҕҼҘӍӹԬӎ԰ҴґԞԖҋⱵʠʥʄϪϜҏԆҌҹӁⱷӶӴ҇ԊϨӤӞӄԃӧӱӫҍӵӻӸӇ҈ϗϏԈӔӐӬӰҊҪϴҔҝ϶ӟԡϠϦҜҢҤӊЖ";

  function randN(n) {
    return Math.floor(Math.random() * n);
  }

  function newN(n, fed, attended) {
    let out = n;
    if (fed || attended) out = n + randN(N_CHANGE);
    else if (Math.random() < 0.5) out = n + randN(N_CHANGE);
    else out = n - randN(N_CHANGE);
    return Math.max(0, out);
  }

  function alienScript() {
    if (Math.random() < 0.25) return " ";
    return GLYPHS[randN(GLYPHS.length)];
  }

  function randomOutput(width, minH, maxH) {
    const height = minH + randN(maxH - minH + 1);
    const rows = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) row += alienScript();
      rows.push(row);
    }
    return rows.join("\n");
  }

  function createModel() {
    return {
      running: true,
      feed: false,
      attention: false,
      outputTick: 0,
      output: ".",
      knobs: { thronglets: 35, blongthrets: 50, thrindlequats: 65, zlongfets: 45 },
      totals: { thronglets: 35, blongthrets: 50, thrindlequats: 65, zlongfets: 45 },
    };
  }

  function setup(model) {
    model.feed = false;
    model.attention = false;
    model.outputTick = 0;
    model.output = ".";
    model.totals.thronglets = model.knobs.thronglets;
    model.totals.blongthrets = model.knobs.blongthrets;
    model.totals.thrindlequats = model.knobs.thrindlequats;
    model.totals.zlongfets = model.knobs.zlongfets;
  }

  function writeOutput(model) {
    if (model.outputTick > 16) model.outputTick = 0;
    const t = model.outputTick;
    if (t === 0 || t === 3) model.output = ".";
    else if (t === 1 || t === 4) model.output = "..";
    else if (t === 2 || t === 5) model.output = "...";
    else if (t === 6) model.output = randomOutput(22, 3, 15);
    model.outputTick += 1;
  }

  function go(model) {
    model.totals.thronglets = newN(model.totals.thronglets, model.feed, model.attention);
    model.totals.blongthrets = newN(model.totals.blongthrets, false, false);
    model.totals.thrindlequats = newN(model.totals.thrindlequats, false, false);
    model.totals.zlongfets = newN(model.totals.zlongfets, false, false);
    model.feed = false;
    model.attention = false;
    writeOutput(model);
  }

  root.ThrongletsModel = { N_CHANGE, createModel, setup, go, newN, randomOutput };
})(globalThis);
