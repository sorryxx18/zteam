// ---- 活動勤務看板：大型活動的時程與本局支援（資料在 activity-data.js，不經後端，免登入可看） ----
// 要排在 app.js 前面載入：app.js 一啟動就會畫目前的專案，這時 renderActivity 必須已經存在
const actF = {};      // 各活動目前的篩選與檢視：{ cat, view }
const actOpen = {};   // 使用者手動展開／折疊過的活動
const actCam = {};    // 各活動的「附近即時影像」：{ spot: 目前看哪個地點（null＝沒開）, more: 是否多看幾支 }
const CAM_FIRST = 4, CAM_MORE = 8;   // 一個地點先看幾支、按「多看幾支」之後看幾支

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const hm = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const actSpan = (it) => (it.end ? `${it.start}–${it.end}` : it.start);
const laneCat = (l) => l.group || l.name;

// 現在的台北時間（網址加 ?actnow=2026-10-10T13:10 可以預覽當天的樣子，時鐘從那個時間開始走）
let actShift = null;
function actNow() {
  if (actShift === null) {
    const q = new URLSearchParams(location.search).get("actnow");
    const fake = q ? new Date(q + ":00+08:00") : null;
    actShift = fake && !isNaN(fake) ? fake.getTime() - Date.now() : 0;
  }
  const ms = Date.now() + actShift, p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), sec: Number(p.second), ms };
}

// 活動第一個項目的開始時間
const actFirst = (a) => a.items.map((it) => it.start).sort()[0];
const actStartMs = (a) => Date.parse(`${a.date}T${actFirst(a)}:00+08:00`);

// 時鐘和倒數：每秒只改文字，不重畫
function actTick(now = actNow()) {
  const [y, m, d] = now.date.split("-").map(Number);
  const clock = `${y - 1911}/${m}/${d}（${WEEK[new Date(now.date + "T12:00:00+08:00").getUTCDay()]}）${hhmm(now.min)}:${String(now.sec).padStart(2, "0")}`;
  document.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = clock; });
  document.querySelectorAll("[data-count]").forEach((el) => {
    const s = Math.floor((Number(el.dataset.count) - now.ms) / 1000);
    el.textContent = s <= 0 ? "已經開始" : `${s >= 86400 ? Math.floor(s / 86400) + " 天 " : ""}${Math.floor((s % 86400) / 3600)} 小時 ${Math.floor((s % 3600) / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒`;
  });
}
const actIn = (n) => (n >= 60 ? `再 ${Math.floor(n / 60)} 小時${n % 60 ? ` ${n % 60} 分` : ""}` : `再 ${n} 分鐘`);

// 活動日距離今天幾天：正數＝還沒到，0＝今天，負數＝已結束
const actDiff = (a, now) => dayN(a.date) - dayN(now.date);

function actDateText(a) {
  const [y, m, d] = a.date.split("-").map(Number);
  return `${y - 1911}/${m}/${d}（${WEEK[new Date(a.date + "T12:00:00+08:00").getUTCDay()]}）`;
}

// 活動當天，每個項目是已結束、進行中，還是還沒開始
function actState(it, diff, now) {
  if (diff !== 0) return "";
  const s = hm(it.start), e = it.end ? hm(it.end) : s;
  if (it.end ? now.min >= e : now.min > s) return "past";
  return now.min >= s ? "now" : "";
}

function renderActivity() {
  const now = actNow();
  const list = [...ACTIVITIES].sort((a, b) => (a.date < b.date ? 1 : -1));
  $("#view").innerHTML = `<div class="banner abanner" style="background-image:url('img/act-main.webp')"><div class="btitle">活動勤務看板</div></div>
    <div class="aclock noprint" role="timer" aria-label="現在時間">現在時間 <b data-clock></b></div>
    <p class="note noprint">轄區大型活動的時程與本局支援。新的活動排在最上面；活動日過了會自動折疊，點一下可以再展開。</p>
    ${list.map((a) => {
      const diff = actDiff(a, now);
      const open = a.id in actOpen ? actOpen[a.id] : diff >= 0;
      const badge = diff > 0 ? `<span class="tag warn">還有 ${diff} 天</span>` : diff === 0 ? `<span class="tag bad">今天</span>` : `<span class="tag">已結束</span>`;
      const sup = a.lanes.filter((l) => l.support).map((l) => `${l.name}：${l.support}`);
      return `<details class="card act" data-act="${a.id}"${open ? " open" : ""}>
        <summary><span class="adate">${actDateText(a)}</span><span class="atitle">${esc(a.title)}</span>${badge}
          <span class="asum">${esc(a.place)}｜本局支援：${sup.length ? esc(sup.join("；")) : "無"}</span></summary>
        <div class="abox" id="actBody-${a.id}"></div>
        ${a.spots && a.spots.length ? `<div class="acam noprint" id="actCam-${a.id}"></div>` : ""}
      </details>`;
    }).join("")}`;
  $("#view").querySelectorAll("details.act").forEach((d) => {
    const a = ACTIVITIES.find((x) => x.id === d.dataset.act);
    d.addEventListener("toggle", () => { actOpen[a.id] = d.open; if (!d.open && actCam[a.id] && actCam[a.id].spot !== null) { actCam[a.id].spot = null; drawCam(a); } });   // 折起來就把影像關掉，不在背景一直抓
    d.querySelector(".abox").addEventListener("click", (x) => {
      const b = x.target.closest("[data-k]");
      if (b) { actF[a.id][b.dataset.k] = b.dataset.v; drawAct(a); return; }
      if (x.target.closest("[data-print]")) printAct(d);
    });
    drawAct(a);
    const cam = d.querySelector(".acam");
    if (cam) {
      cam.addEventListener("click", (x) => {
        const f = actCam[a.id], b = x.target.closest("[data-spot]");
        if (b) { const i = Number(b.dataset.spot); f.spot = f.spot === i ? null : i; f.more = false; drawCam(a); return; }
        if (x.target.closest("[data-camoff]")) { f.spot = null; drawCam(a); return; }
        if (x.target.closest("[data-cammore]")) { f.more = true; drawCam(a); return; }
        if (x.target.closest("[data-camretry]")) { drawCam(a); return; }
        const t = x.target.closest(".ctile");
        if (t) t.classList.toggle("big");
      });
      drawCam(a);
    }
  });
  actTick(now);
}

// 附近即時影像：和上面的時程分開畫，時程每分鐘重畫時影像才不會被打斷
function drawCam(a) {
  const box = $("#actCam-" + a.id);
  if (!box) return;
  const f = actCam[a.id] || (actCam[a.id] = { spot: null, more: false });
  cctvStopIn(box);
  const chips = a.spots.map((s, i) => `<button class="ghost chip${f.spot === i ? " on" : ""}" data-spot="${i}" aria-pressed="${f.spot === i}">${esc(s.name)}</button>`).join("");
  const head = `<h3>📹 附近即時影像</h3><div class="filters"><div class="chips" role="group" aria-label="活動地點">${chips}</div>${f.spot !== null ? `<div class="actions"><button class="ghost" data-camoff>關閉影像</button></div>` : ""}</div>`;
  const src = `<p class="note csrc">影像來源：<a href="${CCTV_SITE}" target="_blank" rel="noopener noreferrer">臺北市即時交通資訊網</a>（臺北市交通管制工程處）。畫面可能延遲或離線，僅供路況參考。</p>`;
  if (f.spot === null) { box.innerHTML = head + `<p class="note">點一個地點，就會載入它周圍路口的即時影像。影像會持續用網路流量，看完請按「關閉影像」。</p>`; return; }
  if (!cctvList) {
    box.innerHTML = head + `<p class="note">攝影機清單載入中…</p>`;
    cctvLoad().then(() => drawCam(a), () => {
      if ($("#actCam-" + a.id) && f.spot !== null) box.innerHTML = head + `<div class="cfail"><p class="err">攝影機清單讀不到。</p><p class="note">可能是這裡的網路連不到臺北市交通資訊網，或官方網站暫時沒有回應。</p><button data-camretry>再試一次</button> <a href="${CCTV_SITE}" target="_blank" rel="noopener noreferrer">改開官方網站 ↗</a></div>`;
    });
    return;
  }
  const s = a.spots[f.spot], all = cctvNear(s.lat, s.lng, CAM_MORE), cams = all.slice(0, f.more ? CAM_MORE : CAM_FIRST);
  if (!cams.length) { box.innerHTML = head + `<p class="note">「${esc(s.name)}」周圍 ${CCTV_RADIUS} 公尺內沒有路口攝影機。</p>` + src; return; }
  box.innerHTML = head + `<div class="cgrid">${cams.map((c) => `<figure class="ctile" data-cam="${esc(c.id)}" title="點一下放大或縮小">
      <video muted playsinline></video>
      <figcaption><b>${esc(c.name)}</b><span class="cdist">${c.m} 公尺</span><span class="tag cstate">連線中…</span></figcaption></figure>`).join("")}</div>
    ${all.length > cams.length ? `<p class="more"><button class="ghost" data-cammore>多看幾支（還有 ${all.length - cams.length} 支）</button></p>` : ""}` + src;
  cams.forEach((c) => {
    const t = box.querySelector(`.ctile[data-cam="${CSS.escape(c.id)}"]`), st = t.querySelector(".cstate");
    cctvPlay(t.querySelector("video"), c.url, (text, bad) => { st.textContent = text; st.classList.toggle("warn", !!bad); st.classList.toggle("ok", text === "即時"); t.classList.toggle("off", !!bad); });
  });
}

function drawAct(a) {
  const box = $("#actBody-" + a.id);
  if (!box) return;
  const now = actNow(), diff = actDiff(a, now);
  const f = actF[a.id] || (actF[a.id] = { cat: "", view: isMobile() ? "tl" : "tb" });
  const lane = Object.fromEntries(a.lanes.map((l) => [l.key, l]));
  const cats = [...new Set(a.lanes.map(laneCat))];
  const lanes = a.lanes.filter((l) => !f.cat || (f.cat === "*" ? !!l.support : laneCat(l) === f.cat));
  const items = a.items.filter((it) => lanes.includes(lane[it.lane])).sort((x, y) => hm(x.start) - hm(y.start));
  const chip = (k, v, label) => `<button class="ghost chip${f[k] === v ? " on" : ""}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${f[k] === v}">${esc(label)}</button>`;

  box.dataset.view = f.view;
  box.innerHTML = `
    <div class="asupport">${a.lanes.filter((l) => l.support).map((l) => `<div><span class="tag sup">本局支援</span> <b>${esc(l.name)}</b>　${esc(l.support)}</div>`).join("") || `<div>這個活動本局沒有支援人車。</div>`}</div>
    ${actNowBox(a, lane, diff, now)}
    <div class="filters dfilters noprint">
      <div class="chips" role="group" aria-label="活動類別">${chip("cat", "", "全部")}${chip("cat", "*", "本局支援")}${cats.map((c) => chip("cat", c, c)).join("")}</div>
      <div class="chips" role="group" aria-label="檢視方式">${chip("view", "tl", "時間軸")}${chip("view", "tb", "總表")}</div>
      <div class="actions"><button class="ghost" data-print>列印總表</button></div>
    </div>
    <div class="atl">${actTimeline(a, items, lane, diff, now)}</div>
    <div class="atb">${actTable(a, lanes, diff, now)}</div>`;
  actTick(now);
}

// 活動當天：現在進行中、接下來；還沒到：倒數
function actNowBox(a, lane, diff, now) {
  if (diff < 0) return "";
  const count = `<div class="acount">距離活動開始（${actDateText(a)} ${actFirst(a)}）還有<b data-count="${actStartMs(a)}"></b></div>`;
  if (diff > 0) return `<div class="anow noprint">${count}<div class="note">當天這裡會顯示「現在進行中」和「接下來」。</div></div>`;
  const row = (it) => `<li><span class="atime">${actSpan(it)}</span> <span class="tag" style="background:${lane[it.lane].color}">${esc(lane[it.lane].name)}</span> ${esc(it.title)}${lane[it.lane].support ? ` <span class="tag sup">本局支援</span>` : ""}${hm(it.start) > now.min ? ` <span class="ain">${actIn(hm(it.start) - now.min)}</span>` : ""}</li>`;
  const going = a.items.filter((it) => actState(it, diff, now) === "now");
  const next = a.items.filter((it) => hm(it.start) > now.min).sort((x, y) => hm(x.start) - hm(y.start)).slice(0, 3);
  if (!going.length && !next.length) return `<div class="anow noprint"><b>今天的活動都結束了。</b></div>`;
  return `<div class="anow noprint">${now.ms < actStartMs(a) ? count : ""}
    <h3>現在進行中</h3>${going.length ? `<ul>${going.map(row).join("")}</ul>` : `<p>目前沒有進行中的項目。</p>`}
    ${next.length ? `<h3>接下來</h3><ul>${next.map(row).join("")}</ul>` : ""}</div>`;
}

// 時間軸：依開始時間排，分上午／下午／晚上三段，各有一張橫幅
function actTimeline(a, items, lane, diff, now) {
  if (!items.length) return `<p class="note">這個類別沒有項目。</p>`;
  const parts = a.parts && a.parts.length ? a.parts : [{ from: "00:00" }];
  return parts.map((p, i) => {
    const to = i + 1 < parts.length ? hm(parts[i + 1].from) : 1440;
    const own = items.filter((it) => hm(it.start) >= hm(p.from) && hm(it.start) < to);
    if (!own.length) return "";
    return (p.img ? `<div class="banner abanner part" style="background-image:url('img/${p.img}');background-position:${p.pos || "center"}"><div class="btitle">${esc(p.name)}</div></div>` : "")
      + own.map((it) => {
        const l = lane[it.lane], st = actState(it, diff, now);
        return `<div class="aitem ${st}"><div class="atime">${it.start}${it.end ? `<span>–${it.end}</span>` : ""}</div>
          <div class="abody" style="border-left-color:${l.color}">
            <div class="atags"><span class="tag" style="background:${l.color}">${esc(l.group ? l.group + "・" + l.name : l.name)}</span>${l.support ? `<span class="tag sup">本局支援</span>` : l.info ? "" : `<span class="tag">本局未支援人車</span>`}${st === "now" ? `<span class="tag bad">進行中</span>` : st === "past" ? `<span class="tag">已結束</span>` : ""}</div>
            <div class="aname">${esc(it.title)}</div>
            ${it.details ? `<ul>${it.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
            ${l.support ? `<div class="asup">本局：${esc(l.support)}</div>` : ""}
          </div></div>`;
      }).join("");
  }).join("");
}

// 總表：每半小時一列、每個活動一欄，跨時段的項目往下合併
function actTable(a, lanes, diff, now) {
  if (!lanes.length) return "";
  const t0 = Math.floor(Math.min(...a.items.map((it) => hm(it.start))) / 30) * 30;
  const t1 = Math.ceil(Math.max(...a.items.map((it) => hm(it.end || it.start) + (it.end ? 0 : 1))) / 30) * 30;
  const n = (t1 - t0) / 30;
  const col = lanes.map((l) => {
    const c = new Array(n).fill(null);
    a.items.filter((it) => it.lane === l.key).forEach((it) => {
      const i0 = Math.floor((hm(it.start) - t0) / 30), i1 = Math.max(i0 + 1, Math.ceil((hm(it.end || it.start) - t0) / 30));
      c[i0] = { it, span: i1 - i0 };
      for (let i = i0 + 1; i < i1; i++) c[i] = "skip";
    });
    return c;
  });
  const supText = (l) => (l.info ? "" : l.support ? `<span class="tag sup">${esc(l.support)}</span>` : `<span class="hnote">本局未支援人車</span>`);
  // 表頭：同一組（例如寶可夢）併成一格，底下再分欄
  let h1 = "", h2 = "";
  for (let i = 0; i < lanes.length; i++) {
    const l = lanes[i];
    if (!l.group) { h1 += `<th rowspan="2">${esc(l.name)}<br>${supText(l)}</th>`; continue; }
    let j = i;
    while (j < lanes.length && lanes[j].group === l.group) j++;
    h1 += `<th colspan="${j - i}">${esc(l.group)}<br>${supText(l)}</th>`;
    for (let k = i; k < j; k++) h2 += `<th>${esc(lanes[k].name)}</th>`;
    i = j - 1;
  }
  let rows = "";
  for (let r = 0; r < n; r++) {
    const t = t0 + r * 30;
    const cur = diff === 0 && now.min >= t && now.min < t + 30;
    rows += `<tr${cur ? ` class="nowrow"` : ""}><th scope="row">${hhmm(t)}${cur ? `<br><span class="tag bad">現在</span>` : ""}</th>` + col.map((c, i) => {
      if (c[r] === "skip") return "";
      if (!c[r]) return "<td></td>";
      const { it, span } = c[r];
      return `<td rowspan="${span}" class="fill ${actState(it, diff, now)}" style="background:${lanes[i].color}"><b>${actSpan(it)}</b><br>${esc(it.title)}${it.details ? `<ul>${it.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</td>`;
    }).join("") + "</tr>";
  }
  return `<div class="tablewrap"><table class="atable"><caption>${esc(a.title)}　${actDateText(a)}</caption>
    <thead><tr><th rowspan="2">時間</th>${h1}</tr><tr>${h2}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// 只印這一個活動的總表（A4 橫式）
function printAct(d) {
  document.body.classList.add("act-print");
  d.classList.add("printing");
  const done = () => { document.body.classList.remove("act-print"); d.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

// 每秒更新時鐘和倒數；換分鐘時重畫當天活動的「現在進行中」，換日時整頁重畫（倒數天數、自動折疊）
let actLast = null;
setInterval(() => {
  if (!$("#view details.act")) { actLast = null; return; }
  const now = actNow();
  if (actLast && actLast.date !== now.date) renderActivity();
  else if (actLast && actLast.min !== now.min) ACTIVITIES.filter((a) => actDiff(a, now) === 0).forEach(drawAct);
  actLast = now;
  actTick(now);
}, 1000);
