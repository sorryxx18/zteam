// 指揮面板（#command）的資料。2026-10-18 先做示意版：全部是假資料，給長官看版面用，網址要加 ?preview=1 才進得去。
// 之後分區燈號、事件、救護統計改由幕僚操作頁寫進後端，這份只留分區範圍、階段時程這類固定資料。
// 燈號：red＝要長官決策／立即處置、amber＝注意、green＝正常
// 事件照 FEMA 社區生命線的寫法：現況（what）、影響（so what）、下一步（now what）、缺什麼（gap）
const COMMAND = {
  demo: true,
  act: "1151231",                    // 對應 activity-data.js 跨年那一則
  now: "2026-12-31T23:40",           // 示意畫面的時間；網址加 ?cmdnow=2027-01-01T00:20 可換（散場）
  center: [25.0350, 121.5650], zoom: 15.1,
  phases: [
    { name: "進場", from: "16:00" },
    { name: "晚會高峰", from: "20:00" },
    { name: "煙火", from: "23:55" },
    { name: "散場", from: "00:10" },
    { name: "收場", from: "02:00" },
  ],
  countdown: { name: "101 煙火", at: "2026-12-31T23:59:50" },
  weather: { temp: 16, sky: "多雲", rain: 20, wind: "東北風 3 級" },
  stats: { ems: 14, hosp: 6, onsite: 8, ambReady: 5, ambAll: 7, staffOn: 186, staffAll: 192 },
  // 分區：範圍是示意，之後照同仁給的管制圖改
  zones: [
    { id: "hall", name: "市府舞台區", light: "green", crowd: "滿七成", box: [[25.0366, 121.5612], [25.0386, 121.5648]] },
    { id: "s101", name: "101 周邊觀賞區", light: "red", crowd: "超過容量", box: [[25.0326, 121.5628], [25.0347, 121.5662]] },
    { id: "songshou", name: "松壽路觀賞帶", light: "green", crowd: "滿八成", box: [[25.0349, 121.5618], [25.0357, 121.5685]] },
    { id: "xiangti", name: "香堤大道", light: "green", crowd: "滿六成", box: [[25.0359, 121.5652], [25.0368, 121.5682]] },
    { id: "mrtcity", name: "捷運市政府站", light: "amber", crowd: "排隊延伸到地面", box: [[25.0404, 121.5640], [25.0416, 121.5668]] },
    { id: "mrt101", name: "捷運台北101／世貿站", light: "green", crowd: "正常", box: [[25.0323, 121.5603], [25.0336, 121.5624]] },
    { id: "elephant", name: "象山觀景步道", light: "amber", crowd: "步道排隊", box: [[25.0266, 121.5698], [25.0292, 121.5735]] },
    { id: "sysmh", name: "國父紀念館", light: "green", crowd: "滿五成", box: [[25.0392, 121.5588], [25.0412, 121.5614]] },
  ],
  // 需處置：最嚴重的排前面；at 是開始時間
  issues: [
    { zone: "s101", level: "red", at: "2026-12-31T23:22", title: "松智路口人潮推擠",
      what: "松智路與信義路口人潮密集，已有民眾推擠", sowhat: "救護車無法從松智路進出 101 救護站", nowwhat: "請警方啟動松智路單向管制，救護改走松廉路", gap: "警力 10 人、移動式圍欄 20 座", ask: "請指揮官協調警察局" },
    { zone: "elephant", level: "amber", at: "2026-12-31T23:31", title: "觀景平台傷患待後送",
      what: "民眾跌倒疑似小腿骨折，人在觀景平台", sowhat: "步道排隊，擔架下山約需 25 分鐘", nowwhat: "已派山域搜救組 4 人上山", gap: "需要第 2 組擔架" },
    { zone: "mrtcity", level: "amber", at: "2026-12-31T23:35", title: "市府站進站排隊延伸",
      what: "3 號出口排隊延伸到忠孝東路人行道", sowhat: "散場時可能更擠", nowwhat: "北捷評估 00:10 起單向進站", gap: "" },
  ],
  // 救護站、待命點
  posts: [
    { name: "市府救護站", lat: 25.0379, lng: 121.5650 },
    { name: "101 救護站", lat: 25.0343, lng: 121.5655 },
    { name: "香堤救護站", lat: 25.0364, lng: 121.5684 },
    { name: "象山待命點", lat: 25.0287, lng: 121.5694 },
  ],
  // 車輛（之後接 Traccar 車輛回報）
  cars: [
    { name: "信義 91", lat: 25.0381, lng: 121.5655, state: "待命" },
    { name: "信義 92", lat: 25.0341, lng: 121.5660, state: "待命" },
    { name: "安和 91", lat: 25.0322, lng: 121.5676, state: "送醫中" },
    { name: "莊敬 91", lat: 25.0288, lng: 121.5690, state: "待命" },
    { name: "大安 91", lat: 25.0398, lng: 121.5560, state: "回程" },
  ],
  // 輿情（之後接犀牛巡邏隊）
  social: [
    { src: "Threads", at: "2026-12-31T23:37", text: "101 下面擠到完全動不了，有人在喊不要推", zone: "s101" },
    { src: "新聞", at: "2026-12-31T23:30", text: "北捷：市府站人潮眾多，建議改搭其他站", zone: "mrtcity" },
    { src: "IG", at: "2026-12-31T23:18", text: "象山步道大排長龍，平台已經站滿", zone: "elephant" },
  ],
};
