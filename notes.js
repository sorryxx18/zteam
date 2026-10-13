// ---- 犀牛留言版：用 Gmail 登入、取了稱呼的人都能看、都能貼；修改、置頂、刪除只有本人和管理者；清單打勾大家都可以 ----
let nb = null;               // {notes, admin, nick, banned}；還沒取稱呼時是 {need_nick: true}
let nbToken = null;          // 這份資料是哪一次登入拿的（換人登入要重抓）
const nbF = { q: "", bin: false };
const nbOpen = new Set();    // 已按「看全部」的留言
let nbTimer = null, nbBusy = 0, nbAt = "";
const NB_COLORS = [["yellow", "黃"], ["pink", "粉"], ["blue", "藍"], ["green", "綠"], ["orange", "橘"], ["purple", "紫"]];
const NB_MAX = { title: 60, text: 2000, items: 30, item: 120, nick: 12 };
const NB_REFRESH = 45000;    // 每隔多久自動看有沒有新留言
const NB_TILT = [-1.6, 0.9, -0.6, 1.5, -1.1, 0.5];

const nbBanner = () => `<div class="banner nbbanner" style="background-image:url('img/notes-main.webp')"><div class="btitle">犀牛留言版</div></div>`;
const nbClock = () => new Date().toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" });

// 後端時間是「2026-10-13 06:20」（臺北時間）
function nbWhen(s) {
  if (!s) return "剛剛";
  const [d, t] = s.split(" ");
  const day = (n) => { const x = new Date(Date.now() - n * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  if (d === day(0)) return "今天 " + t;
  if (d === day(1)) return "昨天 " + t;
  const [, m, dd] = d.split("-");
  return `${+m}/${+dd} ${t}`;
}

const nbHash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const nbLink = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const nbFind = (id) => nb.notes.find((n) => n.id === id);

async function renderNotes() {
  if (me.role === "guest") {
    $("#view").innerHTML = `${nbBanner()}<div class="card empty nbempty"><img src="img/notes-sleep.webp" alt="" width="160">
      <h2>登入後才能看留言、貼留言</h2><p class="note">用 Gmail 登入、幫自己取個稱呼，就可以留言。不用申請單位。</p><button id="nbLogin">登入</button></div>`;
    $("#nbLogin").addEventListener("click", () => logout(""));
    return;
  }
  if (nbToken !== token) { nb = null; nbToken = token; nbF.q = ""; nbF.bin = false; nbOpen.clear(); }
  if (!nb) {
    $("#view").innerHTML = `${nbBanner()}<p class="note" style="text-align:center;padding:32px 16px;font-size:1.1rem">留言載入中…</p>`;
    try {
      nb = await api({ action: "notes_data" });
      nbAt = nbClock();
    } catch (e) {
      if (e.message === "login" || tab !== "notes") return;
      $("#view").innerHTML = `${nbBanner()}<div class="card empty"><p class="err">留言載入失敗：${esc(e.message)}</p><button id="nbRetry">再試一次</button></div>`;
      $("#nbRetry").addEventListener("click", () => { nb = null; renderNotes(); });
      return;
    }
    if (tab !== "notes") return;
  }
  if (nb.need_nick) { nbAskNick(true); return; }
  $("#view").innerHTML = `${nbBanner()}
    <button class="nbnew" id="nbNew"><img src="img/notes-write.webp" alt="" width="84" height="83"><span>寫一張留言…</span><b>＋ 貼上去</b></button>
    <div class="nbbar">
      <input id="nbQ" type="search" placeholder="搜尋留言、稱呼" aria-label="搜尋留言" value="${esc(nbF.q)}">
      <span class="note" id="nbInfo"></span>
      <button class="ghost" id="nbMe" title="改稱呼"></button>
      <button class="ghost" id="nbBan" hidden></button>
      <button class="ghost" id="nbBin" hidden></button>
      <button class="ghost" id="nbReload" title="重新整理">↻ 更新</button>
    </div>
    <div id="nbBoard"></div>`;
  $("#nbNew").addEventListener("click", () => nbEdit(null));
  $("#nbQ").addEventListener("input", (e) => { nbF.q = e.target.value; nbDraw(); });
  $("#nbBin").addEventListener("click", () => { nbF.bin = !nbF.bin; nbDraw(); });
  $("#nbReload").addEventListener("click", () => nbPull(true));
  $("#nbMe").addEventListener("click", () => nbAskNick(false));
  $("#nbBan").addEventListener("click", nbBanList);
  $("#nbBoard").addEventListener("click", nbClick);
  $("#nbBoard").addEventListener("change", nbTick);
  nbDraw();
  clearInterval(nbTimer);
  nbTimer = setInterval(() => {
    if (project !== "notes" || !nb) { clearInterval(nbTimer); nbTimer = null; return; }
    if (!document.hidden && !$("#modal")) nbPull(false);
  }, NB_REFRESH);
}

// 重新抓一次：還在存的、沒存成功的留在畫面上
async function nbPull(manual) {
  if (nbBusy) { if (manual) flash("還有留言正在儲存，等一下再更新"); return; }
  const btn = $("#nbReload");
  if (manual && btn) { btn.disabled = true; btn.textContent = "更新中…"; }
  try {
    const r = await api({ action: "notes_data" });
    if (nbBusy || project !== "notes" || !nb) return;
    if (r.need_nick) { nb = r; renderNotes(); return; }
    const keep = nb.notes.filter((n) => n._failed);
    const ids = new Set(keep.map((n) => n.id));
    nb = { ...r, notes: keep.concat(r.notes.filter((n) => !ids.has(n.id))) };
    nbAt = nbClock();
    if ($("#nbBoard")) nbDraw();
  } catch (e) {
    if (manual) domeFail("更新失敗", "畫面上還是剛才的留言，等一下再按一次「更新」。", e);
  } finally {
    const b = $("#nbReload");
    if (manual && b) { b.disabled = false; b.textContent = "↻ 更新"; }
  }
}

function nbCard(n) {
  const gone = !!n.deleted_at;
  const done = n.items.length > 0 && n.items.every((x) => x.done);
  const long = n.text.length > 260 || n.text.split("\n").length > 9;
  const clamp = long && !nbOpen.has(n.id);
  const tilt = NB_TILT[nbHash(n.id) % NB_TILT.length];
  const state = n._failed ? `<div class="nbstate bad" role="alert">沒有存成功${n._err ? `（${esc(n._err)}）` : ""}　<button data-nact="retry">再存一次</button> <button class="ghost" data-nact="drop">${n._new ? "不貼了" : "還原"}</button></div>`
    : n._pending ? `<div class="nbstate">儲存中…</div>` : "";
  let ops = "";
  if (!n._pending && !n._failed && n.can) {
    ops = gone ? `<button class="ghost" data-nact="restore">救回</button>`
      : `${nb.admin && !n.mine ? `<button class="ghost" data-nact="ban" title="停用這個人留言">🚫</button>` : ""}<button class="ghost" data-nact="pin" aria-pressed="${n.pinned}" title="${n.pinned ? "取消置頂" : "置頂"}">📌</button><button class="ghost" data-nact="edit" title="修改">✏️</button><button class="ghost" data-nact="del" title="刪除">🗑</button>`;
  }
  return `<article class="nb nb-${esc(n.color)}${n.pinned ? " pin" : ""}${n._pending ? " pending" : ""}${gone ? " gone" : ""}" data-nid="${esc(n.id)}" style="--r:${tilt}deg">
    <i class="${n.pinned ? "nbtack" : "nbtape"}" aria-hidden="true"></i>
    <div class="nbin"><div class="nbpaper">
      ${n.title ? `<h3>${esc(n.title)}</h3>` : ""}
      ${n.text ? `<div class="nbtext${clamp ? " clamp" : ""}">${nbLink(n.text)}</div>${long ? `<button class="nbmore" data-nact="more">${clamp ? "看全部 ▾" : "收起來 ▴"}</button>` : ""}` : ""}
      ${n.items.length ? `<ul class="nbitems">${n.items.map((x, i) => `<li class="${x.done ? "done" : ""}"><label><input type="checkbox" data-ni="${i}" ${x.done ? "checked" : ""} ${gone || n._pending || n._failed ? "disabled" : ""}><span>${esc(x.t)}</span></label></li>`).join("")}</ul>` : ""}
      ${state}
      <footer><span class="nbwho">${esc(n.author)}${n.mine ? "（我）" : ""}${n.email && !n.mine ? `<br><span class="nbmail">${esc(n.email)}</span>` : ""}<br>${gone ? `刪除於 ${esc(nbWhen(n.deleted_at))}` : esc(nbWhen(n.created_at)) + (n.updated_at ? "・改過" : "")}</span><span class="nbops">${ops}</span></footer>
    </div></div>
    ${done && !gone ? `<img class="nbgood" src="img/notes-good.webp" alt="全部完成" width="64" height="62">` : ""}
  </article>`;
}

function nbDraw() {
  const q = nbF.q.trim().toLowerCase();
  const hit = (n) => !q || [n.title, n.text, n.author, ...n.items.map((x) => x.t)].join("\n").toLowerCase().includes(q);
  const live = nb.notes.filter((n) => !n.deleted_at), bin = nb.notes.filter((n) => n.deleted_at);
  if (nbF.bin && !bin.length) nbF.bin = false;
  const order = (a, b) => (b._new ? 1 : 0) - (a._new ? 1 : 0) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
  const list = (nbF.bin ? bin : live).filter(hit).sort(order);
  const binBtn = $("#nbBin");
  binBtn.hidden = !bin.length;
  binBtn.textContent = nbF.bin ? "← 回留言版" : `🗑 已刪除 ${bin.length}`;
  $("#nbNew").hidden = nbF.bin;
  $("#nbMe").textContent = `🙂 ${nb.nick}`;
  const banned = nb.banned || [];
  $("#nbBan").hidden = !banned.length;
  $("#nbBan").textContent = `🚫 停用名單 ${banned.length}`;
  $("#nbInfo").textContent = (nbF.bin ? `已刪除 ${list.length} 張` : q ? `找到 ${list.length} 張` : `共 ${live.length} 張`) + (nbAt ? `・${nbAt} 更新` : "");
  let html;
  if (nbF.bin) {
    html = `<p class="note nbhint">刪除的留言只有本人和管理者看得到，30 天內可以救回，之後就會清掉。</p><div class="nbgrid">${list.map(nbCard).join("")}</div>`;
  } else if (!list.length) {
    html = `<div class="card empty nbempty"><img src="img/notes-sleep.webp" alt="" width="180"><h2>${q ? "找不到符合的留言" : "還沒有留言"}</h2><p class="note">${q ? "換個字再找找看。" : "按上面的「寫一張留言」，來貼第一張吧。"}</p></div>`;
  } else {
    const pin = list.filter((n) => n.pinned), rest = list.filter((n) => !n.pinned);
    html = (pin.length ? `<h2 class="nbsec">📌 置頂</h2><div class="nbgrid">${pin.map(nbCard).join("")}</div>${rest.length ? `<h2 class="nbsec">其他留言</h2>` : ""}` : "")
      + (rest.length ? `<div class="nbgrid">${rest.map(nbCard).join("")}</div>` : "");
  }
  $("#nbBoard").innerHTML = html;
}

// 送出新增或修改：畫面先變，背景再存；失敗就在那一張上面標出來，可以再存一次
async function nbSend(n) {
  n._pending = true; n._failed = false; n._err = "";
  nbBusy++;
  if ($("#nbBoard")) nbDraw();
  try {
    const r = await api({ action: "notes_save", note: { id: n._new ? "" : n.id, title: n.title, text: n.text, color: n.color, pinned: n.pinned, items: n.items } });
    const i = nb ? nb.notes.indexOf(n) : -1;
    if (i !== -1) nb.notes[i] = r.note;
    if (n._new) nbCheer();
  } catch (e) {
    n._pending = false; n._failed = true; n._err = e.message === "login" ? "登入逾時，重新登入後再存" : e.message === "Failed to fetch" ? "連線中斷" : e.message;
  } finally {
    nbBusy--;
    if ($("#nbBoard")) nbDraw();
  }
}

async function nbRemove(n, restore) {
  const old = n.deleted_at;
  n.deleted_at = restore ? "" : "剛剛";
  nbBusy++;
  nbDraw();
  try {
    const r = await api({ action: "notes_remove", id: n.id, restore });
    const i = nb ? nb.notes.indexOf(n) : -1;
    if (i !== -1) nb.notes[i] = r.note;
    flash(restore ? "已救回，回到留言版了" : "已刪除，30 天內可以從「已刪除」救回");
  } catch (e) {
    n.deleted_at = old;
    domeFail(restore ? "沒有救回成功" : "沒有刪除成功", "留言還在原來的地方，等一下再試一次。", e);
  } finally {
    nbBusy--;
    if ($("#nbBoard")) nbDraw();
  }
}

function nbClick(e) {
  const b = e.target.closest("[data-nact]");
  if (!b) return;
  const n = nbFind(b.closest("[data-nid]").dataset.nid);
  if (!n) return;
  const act = b.dataset.nact;
  if (act === "more") { nbOpen.has(n.id) ? nbOpen.delete(n.id) : nbOpen.add(n.id); nbDraw(); }
  else if (act === "edit") nbEdit(n);
  else if (act === "pin") { n._old = { ...n }; n.pinned = !n.pinned; nbSend(n); }
  else if (act === "del") { if (confirm(`要刪掉這張留言嗎？\n「${(n.title || n.text || n.items.map((x) => x.t).join("、")).slice(0, 30)}」\n\n30 天內可以從「已刪除」救回。`)) nbRemove(n, false); }
  else if (act === "restore") nbRemove(n, true);
  else if (act === "ban") nbBan(n);
  else if (act === "retry") nbSend(n);
  else if (act === "drop") {
    const i = nb.notes.indexOf(n);
    if (n._new) nb.notes.splice(i, 1); else nb.notes[i] = n._old;
    nbDraw();
  }
}

async function nbTick(e) {
  const box = e.target.closest("[data-ni]");
  if (!box) return;
  const n = nbFind(box.closest("[data-nid]").dataset.nid), i = +box.dataset.ni;
  if (!n || !n.items[i]) return;
  const it = n.items[i];
  it.done = box.checked;
  nbBusy++;
  nbDraw();
  try {
    const r = await api({ action: "notes_tick", id: n.id, i, t: it.t, done: it.done });
    const k = nb ? nb.notes.indexOf(n) : -1;
    if (k !== -1) nb.notes[k] = r.note;
  } catch (err) {
    it.done = !it.done;
    domeFail("沒有勾成功", "這一項已經恢復原狀，等一下再勾一次；如果清單被改過，先按「更新」。", err);
  } finally {
    nbBusy--;
    if ($("#nbBoard")) nbDraw();
  }
}

// 貼出成功：歡呼的犀牛跳出來一下
function nbCheer() {
  const el = document.createElement("img");
  el.src = "img/notes-cheer.webp"; el.alt = ""; el.className = "nbcheer";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// 寫新的或修改：n 是 null 就是新的
function nbEdit(n) {
  const d = n ? { title: n.title, text: n.text, color: n.color, pinned: n.pinned, items: n.items.map((x) => ({ ...x })) }
    : { title: "", text: "", color: NB_COLORS[Math.floor(Math.random() * NB_COLORS.length)][0], pinned: false, items: [] };
  const start = JSON.stringify(d);
  const m = document.createElement("div");
  m.id = "modal"; m.className = "nbmodal";
  const row = (x) => `<li><input type="checkbox" ${x.done ? "checked" : ""} aria-label="已完成"><input type="text" maxlength="${NB_MAX.item}" value="${esc(x.t)}" placeholder="要做的事" aria-label="項目"><button class="ghost" data-nrm title="拿掉這一項">✕</button></li>`;
  m.innerHTML = `<div class="nbedit nb-${d.color}" role="dialog" aria-modal="true" aria-label="${n ? "修改留言" : "寫一張留言"}">
    <input id="neTitle" maxlength="${NB_MAX.title}" placeholder="標題（可不填）" value="${esc(d.title)}">
    <textarea id="neText" maxlength="${NB_MAX.text}" rows="5" placeholder="寫點什麼…">${esc(d.text)}</textarea>
    <ul class="nelist" id="neList">${d.items.map(row).join("")}</ul>
    <button class="ghost" id="neAdd">＋ 加一個勾選項目</button>
    <div class="nerow">
      <div class="necolors" role="group" aria-label="顏色">${NB_COLORS.map(([c, name]) => `<button class="nedot nb-${c}" data-nc="${c}" aria-pressed="${c === d.color}" title="${name}色" aria-label="${name}色"></button>`).join("")}</div>
      <button class="ghost" id="nePin" aria-pressed="${d.pinned}">📌 置頂</button>
    </div>
    <p class="err" id="neErr"></p>
    <div class="nerow"><span class="note" id="neCount"></span><span class="neacts"><button class="ghost" id="neCancel">取消</button><button id="neSave">${n ? "儲存" : "貼上去"}</button></span></div>
  </div>`;
  document.body.appendChild(m);
  const box = m.querySelector(".nbedit"), list = m.querySelector("#neList"), text = m.querySelector("#neText");
  const read = () => ({
    title: m.querySelector("#neTitle").value.trim(), text: text.value.replace(/\r/g, "").trim(), color: d.color, pinned: d.pinned,
    items: [...list.children].map((li) => ({ t: li.querySelector('input[type="text"]').value.trim(), done: li.querySelector('input[type="checkbox"]').checked })).filter((x) => x.t),
  });
  const grow = () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight + 4, 360) + "px"; m.querySelector("#neCount").textContent = `${text.value.length}／${NB_MAX.text} 字`; };
  const close = (ask) => {
    if (ask && JSON.stringify(read()) !== start && !confirm("寫到一半的內容還沒貼出去，關掉就會不見。確定要關掉？")) return;
    document.removeEventListener("keydown", key); m.remove();
  };
  const save = () => {
    const v = read();
    if (!v.title && !v.text && !v.items.length) { m.querySelector("#neErr").textContent = "還沒寫東西。標題、內容、勾選項目至少要有一樣。"; text.focus(); return; }
    close(false);
    if (n) {
      if (JSON.stringify(v) === start) return;
      n._old = { ...n, items: n.items.map((x) => ({ ...x })) };
      Object.assign(n, v);
      nbSend(n);
    } else {
      const t = { ...v, id: "tmp" + Date.now(), _new: true, author: nb.nick, created_at: "", updated_at: "", deleted_at: "", mine: true, can: true };
      nb.notes.push(t);
      nbF.q = ""; if ($("#nbQ")) $("#nbQ").value = "";
      nbSend(t);
    }
  };
  function key(e) {
    if (e.key === "Escape") close(true);
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
  }
  document.addEventListener("keydown", key);
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(true); });
  text.addEventListener("input", grow);
  m.querySelector("#neAdd").addEventListener("click", () => {
    if (list.children.length >= NB_MAX.items) { m.querySelector("#neErr").textContent = `勾選項目最多 ${NB_MAX.items} 個。`; return; }
    list.insertAdjacentHTML("beforeend", row({ t: "", done: false }));
    list.lastElementChild.querySelector('input[type="text"]').focus();
  });
  list.addEventListener("click", (e) => { const b = e.target.closest("[data-nrm]"); if (b) b.closest("li").remove(); });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && e.target.type === "text") { e.preventDefault(); m.querySelector("#neAdd").click(); } });
  m.querySelector(".necolors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nc]"); if (!b) return;
    box.classList.remove("nb-" + d.color); d.color = b.dataset.nc; box.classList.add("nb-" + d.color);
    m.querySelectorAll("[data-nc]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  });
  m.querySelector("#nePin").addEventListener("click", (e) => { d.pinned = !d.pinned; e.currentTarget.setAttribute("aria-pressed", d.pinned); });
  m.querySelector("#neCancel").addEventListener("click", () => close(true));
  m.querySelector("#neSave").addEventListener("click", save);
  grow();
  (n ? text : m.querySelector("#neTitle")).focus();
}

// 取稱呼：第一次進來一定要取（first），之後可以從工具列改
function nbAskNick(first) {
  const form = `<p class="note">留言只會顯示這個稱呼，不會顯示本名、單位和信箱。2～${NB_MAX.nick} 個字，不能跟別人一樣，之後可以改。</p>
    <div class="nbnick"><input id="nkIn" maxlength="${NB_MAX.nick}" placeholder="例如：莊敬小犀牛" value="${first ? "" : esc(nb.nick || "")}" aria-label="稱呼"><button id="nkOk">${first ? "就叫這個" : "改好了"}</button>${first ? "" : `<button class="ghost" id="nkNo">取消</button>`}</div>
    <p class="err" id="nkErr"></p>`;
  let host;
  if (first) {
    $("#view").innerHTML = `${nbBanner()}<div class="card empty nbempty nbnickcard"><img src="img/notes-write.webp" alt="" width="150"><h2>先幫自己取個稱呼</h2>${form}</div>`;
    host = $("#view");
  } else {
    host = document.createElement("div");
    host.id = "modal"; host.className = "nbmodal";
    host.innerHTML = `<div class="mbox nbnickcard" role="dialog" aria-modal="true" aria-label="改稱呼"><h2>改稱呼</h2>${form}</div>`;
    document.body.appendChild(host);
    host.addEventListener("mousedown", (e) => { if (e.target === host) host.remove(); });
    host.querySelector("#nkNo").addEventListener("click", () => host.remove());
  }
  const input = host.querySelector("#nkIn"), ok = host.querySelector("#nkOk"), err = host.querySelector("#nkErr");
  const go = async () => {
    const nick = input.value.replace(/\s+/g, " ").trim();
    if (nick.length < 2) { err.textContent = "稱呼至少要 2 個字。"; input.focus(); return; }
    if (!first && nick === nb.nick) { host.remove(); return; }
    ok.disabled = true; err.textContent = "";
    try {
      await api({ action: "notes_nick", nick });
      if (!first) host.remove();
      nb = null;
      if (tab === "notes") renderNotes();
      flash(`稱呼設定好了：${nick}`);
    } catch (e) {
      if (e.message === "login") return;
      err.textContent = e.message === "Failed to fetch" ? "連線中斷，等一下再按一次。" : e.message;
      ok.disabled = false; input.focus();
    }
  };
  ok.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); else if (e.key === "Escape" && !first) host.remove(); });
  input.focus();
}

// 管理者：停用某個人留言（從他的留言上按）
async function nbBan(n) {
  const mine = nb.notes.filter((x) => x.email === n.email && !x.deleted_at).length;
  if (!confirm(`要停用「${n.author}」（${n.email}）留言嗎？\n停用後他看不到留言版，也不能貼。之後可以從「停用名單」恢復。`)) return;
  const wipe = mine > 0 && confirm(`他貼過的 ${mine} 張留言要一起刪掉嗎？\n按「確定」一起刪（30 天內可救回），按「取消」留著。`);
  nbBusy++;
  try {
    const r = await api({ action: "notes_ban", id: n.id, wipe });
    flash(`已停用${r.wiped ? `，並刪除 ${r.wiped} 張留言` : ""}`);
  } catch (e) {
    domeFail("沒有停用成功", "等一下再試一次。", e);
  } finally {
    nbBusy--;
    nbPull(false);
  }
}

// 管理者：停用名單，可以恢復
function nbBanList() {
  const m = document.createElement("div");
  m.id = "modal"; m.className = "nbmodal";
  m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true" aria-label="停用名單"><div class="mtop"><b>停用留言的帳號</b><button class="ghost" id="blClose">關閉</button></div>
    <ul class="nbbanlist">${(nb.banned || []).map((u) => `<li><span>${esc(u.nick || "（還沒取稱呼）")}<br><span class="nbmail">${esc(u.email)}</span></span><button class="ghost" data-unban="${esc(u.email)}">恢復</button></li>`).join("")}</ul></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
  m.querySelector("#blClose").addEventListener("click", close);
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-unban]");
    if (!b) return;
    b.disabled = true;
    try {
      await api({ action: "notes_ban", email: b.dataset.unban, off: true });
      b.closest("li").remove();
      flash("已恢復，他可以再留言了");
      if (!m.querySelector("li")) close();
      nbPull(false);
    } catch (err) {
      b.disabled = false;
      domeFail("沒有恢復成功", "等一下再試一次。", err);
    }
  });
}
