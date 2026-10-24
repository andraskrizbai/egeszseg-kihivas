/**
 * Headless checks for the static PWA. No build step.
 * Run from the repo root:
 *   npm install --prefix /tmp/ppt puppeteer-core
 *   node tests/e2e.cjs
 * Requires Google Chrome at /usr/bin/google-chrome.
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const puppeteer = require("/tmp/ppt/node_modules/puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4173;
const ORIGIN = "http://127.0.0.1:" + PORT;
const URL = ORIGIN + "/?test=1";
const SHOTS = "/opt/cursor/artifacts/screenshots";
const KEY = "egeszsegKihivas.v1";

function pad(n) { return (n < 10 ? "0" : "") + n; }
function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseKey(k) { const p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return fmt(d); }
function localDT(d) { return fmt(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function diffDays(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
async function assertNoHandlers(page, label) {
  const hit = await page.evaluate(function () {
    const bad = [];
    document.querySelectorAll("*").forEach(function (el) {
      Array.prototype.forEach.call(el.attributes, function (attr) {
        if (/^on/i.test(attr.name)) bad.push(el.tagName + " " + attr.name);
      });
    });
    return { bad: bad.slice(0, 8), imgs: document.querySelectorAll("img").length, xss: window.__xss || 0 };
  });
  assert.deepStrictEqual(hit.bad, [], label + " has inline handlers: " + hit.bad.join(", "));
  assert.strictEqual(hit.imgs, 0, label + " rendered an img");
  assert.strictEqual(hit.xss, 0, label + " ran a payload");
}

const today = fmt(new Date());
const stageStart = addDays(today, -20);
const curStageStart = addDays(stageStart, Math.floor(diffDays(stageStart, today) / 14) * 14);
const yesterday = addDays(today, -1);
const day2 = addDays(today, -2);
const day3 = addDays(today, -3);
const back = diffDays(curStageStart, today);

const seed = {
  version: 1,
  settings: { name: "András", stageStart: stageStart, fastTarget: 16, sleepMin: 7, sleepMax: 9, kcalMin: 2000, kcalMax: 2200 },
  days: {},
  timer: null,
  celebrated: {},
  seenBadges: { elso: today, tokeletes1: today, sor3: today },
  customFoods: [{ id: "cseed1", n: '<img src=x onerror="window.__xss=1">', k: 100, p: 1, c: 2, f: 3, pl: "1 tányér", pg: 300, cat: "C", src: "sajat" }],
  favFoods: [{ id: "o5998", n: "Tej", k: 46, p: 3.4, c: 4.8, f: 1.5, pl: "1 pohár", pg: 250, cat: "W", src: "online", code: "5998", lastG: 250, lastU: "g", lastA: 250 }],
  recentFoods: [{ id: "f0", n: "Gulyásleves", k: 75, p: 5.5, c: 5, f: 3.5, pl: "1 tányér", pg: 400, cat: "L", src: "db" }],
  lastStageSeen: Math.floor(diffDays(stageStart, today) / 14),
  created: "2026-01-01T00:00:00.000Z"
};
seed.days[yesterday] = {
  fastStart: addDays(yesterday, -1) + "T20:00",
  fastEnd: yesterday + "T12:30",
  bed: "23:00",
  wake: "07:00",
  meals: [{ n: "Ebéd", k: 2100, food: "Gulyásleves", g: 400, p: 22, c: 30, f: 12, fid: "f0" }]
};
seed.days[day2] = { fastManual: 16 };
seed.days[day3] = {
  fastStart: '"><img src=x onerror="window.__xss=1">',
  meals: [{ n: "Nasi", k: 100, food: '<svg onload="window.__xss=1">' }]
};
seed.celebrated[yesterday] = true;

function installSpies() {
  window.__shown = [];
  window.__xss = 0;
  function Wrapped(title, opts) {
    window.__shown.push({ title: title, body: opts && opts.body, tag: opts && opts.tag, via: "page" });
  }
  Wrapped.permission = "granted";
  Wrapped.requestPermission = function (cb) {
    if (typeof cb === "function") cb("granted");
    return Promise.resolve("granted");
  };
  window.Notification = Wrapped;
  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      window.__shown.push({ title: title, body: opts && opts.body, tag: opts && opts.tag, via: "sw" });
      return Promise.resolve();
    };
  }
}

async function newPage(browser, extra) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ["notifications"]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("dialog", async (d) => {
    const m = d.message();
    if (m.indexOf("importálás") >= 0) await d.accept();
    else { errors.push("unexpected dialog: " + m); await d.dismiss(); }
  });
  await page.evaluateOnNewDocument(installSpies);
  if (extra) await page.evaluateOnNewDocument(extra);
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 });
  return { context, page, errors };
}

async function setField(page, sel, value) {
  await page.waitForSelector(sel);
  await page.$eval(sel, function (el, v) {
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    await waitForServer();
    const sw = (await httpGet("/sw.js")).body;
    assert(sw.indexOf("egeszseg-kihivas-v2") >= 0, "service worker cache version was not bumped");
    assert(sw.indexOf("egeszseg-kihivas-v1") < 0, "old cache name still present");

    await testMigration(browser);
    await testNotifications(browser);
    await testImportXss(browser);
    await testOpenFoodFacts(browser);
    console.log("ALL TESTS PASSED");
  } finally {
    await browser.close();
    server.kill();
  }
}

function httpGet(urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.get(ORIGIN + urlPath, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
    });
    req.on("error", reject);
  });
}
function waitForServer() {
  return new Promise(function (resolve, reject) {
    let n = 0;
    const t = setInterval(function () {
      n++;
      httpGet("/").then(function (r) {
        if (r.status === 200) { clearInterval(t); resolve(); }
      }).catch(function (e) {
        if (n > 50) { clearInterval(t); reject(e); }
      });
    }, 100);
  });
}

async function testMigration(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument(function (payload, key) {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, JSON.stringify(payload));
      sessionStorage.setItem("seeded", "1");
    }
  }, seed, KEY);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas && document.querySelector(".pill.xp"); });

  const loaded = await page.evaluate(function (y, d3) {
    const s = window.__kihivas.state();
    const day = s.days[y];
    return {
      xp: window.__kihivas.xp(),
      yXP: window.__kihivas.dayXP(y),
      yN: window.__kihivas.evalDay(y).n,
      name: s.settings.name,
      fastTarget: s.settings.fastTarget,
      version: s.version,
      notify: s.settings.notifyFast,
      meal: day && day.meals && day.meals[0],
      fastStart: day && day.fastStart,
      bed: day && day.bed,
      custom: s.customFoods[0] && s.customFoods[0].n,
      fav: s.favFoods[0] && { n: s.favFoods[0].n, p: s.favFoods[0].p, lastG: s.favFoods[0].lastG },
      recent: s.recentFoods[0] && s.recentFoods[0].n,
      badFast: s.days[d3] && s.days[d3].fastStart,
      badFood: s.days[d3] && s.days[d3].meals && s.days[d3].meals[0].food,
      lastStageSeen: s.lastStageSeen,
      xss: window.__xss
    };
  }, yesterday, day3);

  assert.strictEqual(loaded.xp, 60, "XP changed while loading old data: " + loaded.xp);
  assert.strictEqual(loaded.yXP, 50, "perfect day XP");
  assert.strictEqual(loaded.yN, 3, "perfect day goals");
  assert.strictEqual(loaded.name, "András");
  assert.strictEqual(loaded.fastTarget, 16);
  assert.strictEqual(loaded.version, 2);
  assert.strictEqual(loaded.notify, false);
  assert.strictEqual(loaded.meal.food, "Gulyásleves");
  assert.strictEqual(loaded.meal.k, 2100);
  assert.strictEqual(loaded.fastStart, addDays(yesterday, -1) + "T20:00");
  assert.strictEqual(loaded.bed, "23:00");
  assert.strictEqual(loaded.custom, '<img src=x onerror="window.__xss=1">');
  assert.strictEqual(loaded.fav.n, "Tej");
  assert.strictEqual(loaded.fav.p, 3.4);
  assert.strictEqual(loaded.fav.lastG, 250);
  assert.strictEqual(loaded.recent, "Gulyásleves");
  assert.strictEqual(loaded.badFast, undefined, "malicious fastStart should be dropped");
  assert.strictEqual(loaded.badFood, '<svg onload="window.__xss=1">');
  assert.strictEqual(loaded.xss, 0);
  assert.ok(loaded.lastStageSeen >= 1);

  await assertNoHandlers(page, "initial page");

  await page.click('[data-act="tab"][data-v="cal"]');
  for (let i = 0; i < 4 && !(await page.$('[data-act="openDay"][data-v="' + day3 + '"]')); i++) {
    await page.click('[data-act="cal"][data-v="-1"]');
  }
  await page.click('[data-act="openDay"][data-v="' + day3 + '"]');
  await page.waitForFunction(function (food) {
    return document.body.textContent.indexOf(food) >= 0;
  }, {}, '<svg onload="window.__xss=1">');
  assert.strictEqual(await page.evaluate(function () { return window.__xss; }), 0);
  const dayHtml = await page.$eval("#main", function (el) { return el.innerHTML; });
  assert(dayHtml.includes("&lt;svg"), "svg payload was not escaped");
  await assertNoHandlers(page, "journal day");

  await page.click('[data-act="gotoToday"]');
  const xpBefore = await page.evaluate(function () { return window.__kihivas.xp(); });
  const streakBefore = await page.$eval(".pill.flame", function (el) { return el.textContent.trim(); });
  await setField(page, "#weightIn", "10");
  const rejected = await page.evaluate(function (k) { return window.__kihivas.state().days[k] && window.__kihivas.state().days[k].weight; }, today);
  assert.strictEqual(rejected, undefined, "out-of-range weight was stored");
  await setField(page, "#weightIn", "82.44");
  const rounded = await page.evaluate(function (k) { return window.__kihivas.state().days[k].weight; }, today);
  assert.strictEqual(rounded, 82.4, "weight was not rounded to one decimal");
  await setField(page, "#weightIn", "88,5");
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.state().days[k].weight; }, today), 88.5);
  assert.strictEqual(await page.evaluate(function () { return window.__kihivas.xp(); }), xpBefore, "weight changed XP");
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.evalDay(k).n; }, today), 0);
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.evalDay(k).logged; }, today), false);
  assert.strictEqual(await page.$eval(".pill.flame", function (el) { return el.textContent.trim(); }), streakBefore);

  for (let i = 0; i < back; i++) await page.click('[data-act="day"][data-v="-1"]');
  await setField(page, "#weightIn", "90");
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.state().days[k].weight; }, curStageStart), 90);
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.dayXP(k); }, yesterday), 50, "past weight edit changed a logged day's XP");
  await page.click('[data-act="gotoToday"]');
  await page.click('[data-act="clearWeight"]');
  assert.strictEqual(await page.evaluate(function (k) { return window.__kihivas.state().days[k].weight; }, today), undefined);
  await setField(page, "#weightIn", "88.5");

  const backup = await page.evaluate(function (key) { return localStorage.getItem(key + ".pre-v2"); }, KEY);
  assert(backup && backup.indexOf('"version":1') >= 0, "pre-upgrade backup missing");
  assert(backup.indexOf("88.5") < 0, "backup should be the original data");
  const stored = JSON.parse(await page.evaluate(function (key) { return localStorage.getItem(key); }, KEY));
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.days[today].weight, 88.5);
  assert.strictEqual(stored.days[curStageStart].weight, 90);
  assert.strictEqual(stored.days[yesterday].meals[0].food, "Gulyásleves");

  await page.click('[data-act="tab"][data-v="stats"]');
  await page.waitForSelector("#weightSummary");
  const card = await page.$eval("#weightSummary", function (el) { return el.closest(".card").innerText; });
  assert(card.includes("88,5"), "current weight missing in stats: " + card);
  assert(card.includes("90,0"), "stage start weight missing: " + card);
  assert(card.includes("-1,5"), "weight change missing: " + card);
  assert(card.includes("Testsúly"));
  const base = await page.evaluate(function (k) { return window.__kihivas.baseline(k); }, curStageStart);
  assert.strictEqual(base.pt.w, 90);
  assert.strictEqual(base.carried, false);
  await page.$eval("#weightSummary", function (el) { el.closest(".card").scrollIntoView(); });
  await page.screenshot({ path: path.join(SHOTS, "stats-weight.png") });

  await page.click('[data-act="tab"][data-v="today"]');
  await page.waitForSelector("#weightIn");
  await page.$eval("#weightIn", function (el) { el.closest(".card").scrollIntoView(); });
  await page.screenshot({ path: path.join(SHOTS, "today-weight.png") });

  await page.click('[data-act="tab"][data-v="cal"]');
  await page.waitForFunction(function () { return document.body.innerText.indexOf("88,5 kg") >= 0 || document.body.innerText.indexOf("90,0 kg") >= 0; });

  const xpGoals = await page.evaluate(function () { return window.__kihivas.xp(); });
  await page.click('[data-act="tab"][data-v="today"]');
  await page.click('[data-act="fastPreset"][data-v="20:00|12:00"]');
  await setField(page, 'input[data-f="bed"]', "23:00");
  await setField(page, 'input[data-f="wake"]', "07:00");
  await page.click('details[data-det="quick"] summary');
  await page.waitForSelector("#kcalIn", { visible: true });
  await page.$eval("#kcalIn", function (el) { el.value = "2100"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click('[data-act="addMeal"]');
  await page.waitForSelector(".modal");
  assert((await page.$eval(".modal h2", function (el) { return el.textContent; })).indexOf("Tökéletes") >= 0);
  await page.click('.modal [data-act="closeModal"]');
  const afterGoals = await page.evaluate(function (k) {
    return { xp: window.__kihivas.xp(), n: window.__kihivas.evalDay(k).n, w: window.__kihivas.state().days[k].weight };
  }, today);
  assert.strictEqual(afterGoals.n, 3);
  assert.strictEqual(afterGoals.xp, xpGoals + 50, "perfect day should add 50 XP and nothing from weight");
  assert.strictEqual(afterGoals.w, 88.5, "logging goals wiped the weight");

  await page.evaluate(async function () {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(function (resolve) { navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }); });
    }
    const keys = await caches.keys();
    if (keys.indexOf("egeszseg-kihivas-v2") < 0) throw new Error("cache missing " + keys.join(","));
    return reg.scope;
  });
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas && window.__kihivas.xp() > 0; });
  const offline = await page.evaluate(function (k, y) {
    const s = window.__kihivas.state();
    return { xp: window.__kihivas.xp(), w: s.days[k] && s.days[k].weight, food: s.days[y].meals[0].food, name: s.settings.name };
  }, today, yesterday);
  assert.strictEqual(offline.food, "Gulyásleves");
  assert.strictEqual(offline.w, 88.5);
  assert.strictEqual(offline.name, "András");
  assert.strictEqual(offline.xp, afterGoals.xp);
  await page.setOfflineMode(false);

  const csp = await page.evaluate(function () {
    return new Promise(function (resolve) {
      window.__csp = 0;
      const d = document.createElement("div");
      d.innerHTML = '<img src="x" onerror="window.__csp=1">';
      document.body.appendChild(d);
      setTimeout(function () { resolve(window.__csp); }, 400);
    });
  });
  assert.strictEqual(csp, 0, "CSP did not block an injected inline event handler");
  assert.deepStrictEqual(errors, []);
  const exported = await page.evaluate(function () { return JSON.stringify(window.__kihivas.state()); });
  fs.writeFileSync("/tmp/egeszseg-backup.json", exported);
  await context.close();
}

async function testNotifications(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas; });
  await page.click('[data-act="tab"][data-v="profile"]');
  await page.waitForSelector('[data-act="enableNotify"]');
  assert((await page.$eval("#main", function (el) { return el.innerText; })).includes("bezárt"));
  await page.screenshot({ path: path.join(SHOTS, "profile-notify.png") });
  await page.click('[data-act="enableNotify"]');
  await page.waitForFunction(function () { return window.__kihivas.state().settings.notifyFast === true; });

  await page.click('[data-act="tab"][data-v="today"]');
  await page.click('[data-act="startFast"]');
  const beforeReload = await page.evaluate(function () {
    const s = window.__kihivas.state();
    const d = window.__kihivas.deadlines();
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s.timer.start);
    const st = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return { start: s.timer.start, at: d.fast.at, expected: st.getTime() + s.settings.fastTarget * 36e5, on: d.on };
  });
  assert.strictEqual(beforeReload.at, beforeReload.expected);
  assert.strictEqual(beforeReload.on, true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas && window.__kihivas.state().timer; });
  const afterReload = await page.evaluate(function (start) {
    const s = window.__kihivas.state();
    const d = window.__kihivas.deadlines();
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s.timer.start);
    const st = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return { start: s.timer.start, at: d.fast.at, expected: st.getTime() + 16 * 36e5, same: s.timer.start === start };
  }, beforeReload.start);
  assert.strictEqual(afterReload.same, true, "fast start was not read back from storage");
  assert.strictEqual(afterReload.at, afterReload.expected, "deadline is not derived from the stored start");

  const past = localDT(new Date(Date.now() - (16 * 3600 + 90) * 1000));
  await setField(page, 'input[data-f="timerStart"]', past);
  await page.waitForFunction(function () { return window.__shown.some(function (n) { return n.title === "Böjt kész"; }); });
  const fastNote = await page.evaluate(function () { return window.__shown.filter(function (n) { return n.tag === "fast"; }); });
  assert.strictEqual(fastNote.length, 1);
  assert(fastNote[0].body.indexOf("16 órás") >= 0, fastNote[0].body);
  const sentId = await page.evaluate(function () { return Object.keys(window.__kihivas.state().sentNotifs)[0]; });
  assert(sentId.indexOf("fast|" + past) === 0, sentId);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas; });
  await new Promise(function (r) { setTimeout(r, 1200); });
  const shownAfter = await page.evaluate(function () { return window.__shown.length; });
  assert.strictEqual(shownAfter, 0, "fast notification fired again after reload");

  const eatStart = localDT(new Date(Date.now() - (7 * 3600 + 90) * 1000));
  await setField(page, 'input[data-f="fastEnd"]', eatStart);
  await page.waitForFunction(function () { return window.__shown.some(function (n) { return n.tag === "eat"; }); });
  const eat = (await page.evaluate(function () { return window.__shown; })).filter(function (n) { return n.tag === "eat"; })[0];
  assert(eat.body.indexOf("7 óra") >= 0, eat.body);
  assert(eat.body.indexOf("8 órás") >= 0, eat.body);
  const math = await page.evaluate(function () {
    const d = window.__kihivas.deadlines().eat;
    const days = window.__kihivas.state().days;
    const end = days[Object.keys(days).sort().pop()].fastEnd;
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(end);
    const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return { at: d && d.at, closeAt: d && d.closeAt, expectAt: ms + 7 * 36e5, expectClose: ms + 8 * 36e5 };
  });
  assert.strictEqual(math.at, math.expectAt, "eat warning is not 7h after the first meal");
  assert.strictEqual(math.closeAt, math.expectClose, "eating window is not 8h");
  const sentEat = await page.evaluate(function (start) {
    const keys = Object.keys(window.__kihivas.state().sentNotifs);
    return keys.filter(function (k) { return k.indexOf("eat|" + start) === 0; }).length;
  }, eatStart);
  assert.strictEqual(sentEat, 1);

  const futureEnd = localDT(new Date(Date.now() - 2 * 3600 * 1000));
  const before = await page.evaluate(function () { return window.__shown.length; });
  await setField(page, 'input[data-f="fastEnd"]', futureEnd);
  await page.evaluate(function () { window.__kihivas.check(); });
  const after = await page.evaluate(function () { return window.__shown.length; });
  assert.strictEqual(after, before, "eat warning fired before the 7th hour");
  const future = await page.evaluate(function () {
    const d = window.__kihivas.deadlines().eat;
    return d.at - Date.now();
  });
  assert(future > 4 * 3600 * 1000 && future < 6 * 3600 * 1000, "warn time not ~5h ahead: " + future);

  await page.click('[data-act="tab"][data-v="profile"]');
  await page.click('[data-act="disableNotify"]');
  await page.waitForFunction(function () { return window.__kihivas.state().settings.notifyFast === false; });
  assert.deepStrictEqual(errors, []);
  await context.close();
}

async function testImportXss(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () { return window.__kihivas; });
  const good = JSON.parse(fs.readFileSync("/tmp/egeszseg-backup.json", "utf8"));
  const goodPath = "/tmp/egeszseg-backup.json";
  await page.click('[data-act="tab"][data-v="profile"]');
  const input = await page.waitForSelector("#impFile");
  await input.uploadFile(goodPath);
  await page.waitForFunction(function (w) {
    const s = window.__kihivas.state();
    return Object.keys(s.days).some(function (k) { return s.days[k].weight === w; });
  }, {}, 88.5);
  const imported = await page.evaluate(function (y) {
    const s = window.__kihivas.state();
    return {
      xp: window.__kihivas.xp(),
      food: s.days[y] && s.days[y].meals[0].food,
      name: s.settings.name,
      custom: s.customFoods[0].n,
      notify: s.settings.notifyFast
    };
  }, yesterday);
  assert.strictEqual(imported.food, "Gulyásleves");
  assert.strictEqual(imported.name, "András");
  assert.strictEqual(imported.custom, good.customFoods[0].n);
  assert(imported.xp >= 60);

  const evil = {
    settings: { name: '<img src=x onerror="window.__xss=1">', stageStart: stageStart, fastTarget: 16, sleepMin: 7, sleepMax: 9, kcalMin: 2000, kcalMax: 2200, notifyFast: true },
    days: {},
    customFoods: [{ id: "cx", n: '<img src=x onerror="window.__xss=1">', k: 1, p: 0, c: 0, f: 0, cat: "C", src: "sajat" }]
  };
  evil.days[yesterday] = {
    fastStart: '"><img src=x onerror="window.__xss=1">',
    fastEnd: yesterday + "T12:00",
    bed: '"><x',
    meals: [{ n: '<img src=x onerror="window.__xss=1">', k: 2100, food: '<svg onload="window.__xss=1">' }]
  };
  fs.writeFileSync("/tmp/egeszseg-evil.json", JSON.stringify(evil));
  await page.click('[data-act="tab"][data-v="profile"]');
  await (await page.$("#impFile")).uploadFile("/tmp/egeszseg-evil.json");
  await page.waitForFunction(function () {
    return window.__kihivas.state().settings.name.indexOf("<img") === 0;
  });
  await page.click('[data-act="tab"][data-v="today"]');
  await page.click('[data-act="day"][data-v="-1"]');
  await page.waitForFunction(function () { return document.body.textContent.indexOf("<svg onload") >= 0; });
  const evilHtml = await page.content();
  await assertNoHandlers(page, "imported backup");
  assert(evilHtml.includes("&lt;svg") || (await page.evaluate(function () { return document.body.textContent.indexOf("<svg onload") >= 0; })), "imported meal name was not shown as text");
  const cleaned = await page.evaluate(function (y) {
    const d = window.__kihivas.state().days[y];
    return { fastStart: d.fastStart, fastEnd: d.fastEnd, bed: d.bed, food: d.meals[0].food, k: d.meals[0].k };
  }, yesterday);
  assert.strictEqual(cleaned.fastStart, undefined);
  assert.strictEqual(cleaned.bed, undefined);
  assert.strictEqual(cleaned.fastEnd, yesterday + "T12:00");
  assert.strictEqual(cleaned.k, 2100);
  assert.strictEqual(cleaned.food, '<svg onload="window.__xss=1">');
  assert.strictEqual(await page.evaluate(function () { return ({}).polluted || window.polluted || 0; }), 0);

  const big = { settings: evil.settings, days: { pad: "x".repeat(2 * 1024 * 1024) } };
  fs.writeFileSync("/tmp/egeszseg-big.json", JSON.stringify(big));
  const nameBefore = await page.evaluate(function () { return window.__kihivas.state().settings.name; });
  await page.click('[data-act="tab"][data-v="profile"]');
  await (await page.$("#impFile")).uploadFile("/tmp/egeszseg-big.json");
  await page.waitForFunction(function () { return document.body.innerText.indexOf("túl nagy") >= 0; });
  assert.strictEqual(await page.evaluate(function () { return window.__kihivas.state().settings.name; }), nameBefore);
  assert.deepStrictEqual(errors, []);
  await context.close();
}

async function testOpenFoodFacts(browser) {
  const { context, page, errors } = await newPage(browser);
  let referer = "unset";
  const seen = [];
  await page.setRequestInterception(true);
  page.on("request", function (req) {
    const url = req.url();
    // A controlling service worker hides cross-origin fetches from interception.
    if (url.indexOf("/sw.js") >= 0) {
      req.respond({ status: 404, contentType: "text/javascript", body: "/* no sw in this case */" }).catch(function (e) { errors.push(String(e)); });
      return;
    }
    if (url.indexOf("openfoodfacts.org") >= 0) {
      referer = req.headers().referer || req.headers().referrer || "";
      seen.push(url);
      req.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          products: [
            { product_name: { bad: true }, nutriments: { "energy-kcal_100g": 10 } },
            { code: "12345678", product_name: '<img src=x onerror="window.__xss=1">', brands: "Rossz<b>", nutriments: { "energy-kcal_100g": 123, proteins_100g: 1, carbohydrates_100g: 2, fat_100g: 3 } }
          ]
        })
      }).catch(function (e) { errors.push(String(e)); });
      return;
    }
    req.continue().catch(function () {});
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#foodQ");
  await page.type("#foodQ", "xss");
  await page.waitForSelector('[data-act="offSearch"]');
  await page.click('[data-act="offSearch"]');
  try {
    await page.waitForFunction(function () { return document.body.innerText.indexOf("123") >= 0; });
  } catch (err) {
    const text = await page.evaluate(function () { return document.body.innerText.slice(0, 800); });
    throw new Error("OFF result missing (seen " + seen.length + " requests). " + text);
  }
  const list = await page.$eval("#foodRes", function (el) { return el.innerHTML; });
  assert(list.includes("&lt;img"), "OFF name was not escaped: " + list.slice(0, 400));
  await assertNoHandlers(page, "Open Food Facts result");
  assert(list.includes("Rossz&lt;b&gt;"), "brand HTML was not escaped: " + list.slice(0, 400));
  const buttons = await page.$$("#foodRes .fitem");
  assert.strictEqual(buttons.length, 1, "non-string OFF product should be dropped");
  await buttons[0].click();
  assert.strictEqual(await page.evaluate(function () { return window.__xss; }), 0);
  assert.strictEqual(referer, "", "Open Food Facts request sent a referrer: " + referer);
  assert.deepStrictEqual(errors, []);
  await context.close();
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
