// 活動勤務看板的資料。新活動加在最前面；活動日過了頁面會自動折疊。
// lanes：總表的欄位（group 相同的會併成一組）；support 有寫＝本局有支援，空字串＝本局未支援人車，info: true＝純資訊不標支援
// items：start／end 用 24 小時制；沒有 end 的是單一時間點
const ACTIVITIES = [
  {
    id: "1151010", date: "2026-10-10", title: "115 年國慶日各項活動", place: "市府周邊・信義區",
    parts: [
      { from: "00:00", name: "上午・升旗典禮與慶祝活動", img: "act-1010-am.webp", pos: "center 56%" },
      { from: "12:00", name: "下午・香堤大道遊行與舞台", img: "act-1010-pm.webp", pos: "center 56%" },
      { from: "18:00", name: "晚上・演唱會與 101 煙火", img: "act-1010-night.webp", pos: "center 40%" },
    ],
    lanes: [
      { key: "flag", name: "升旗", color: "#ffd9d6", support: "" },
      { key: "eoc", name: "府應變中心", color: "#ffe98a", support: "信義中隊長擔任醫護防救組組員" },
      { key: "show", group: "寶可夢", name: "遊行＆舞台表演（香堤大道）", color: "#d8ecff", support: "" },
      { key: "meet", group: "寶可夢", name: "見面會", color: "#c9f1e4", support: "" },
      { key: "gift", group: "寶可夢", name: "贈品發放＆Kid's TV", color: "#e3f5c4", support: "" },
      { key: "bigbang", name: "BIGBANG 演唱會", color: "#e6dcff", support: "" },
      { key: "fire", name: "101 煙火暨無人機展演", color: "#ffd0e6", support: "莊敬 1 車 4 人（警消 2 人、義消 2 人）" },
      { key: "traffic", name: "交通管制", color: "#e5e9ef", info: true },
    ],
    items: [
      { lane: "traffic", start: "06:00", end: "15:00", title: "國慶升旗交通管制", details: ["市民廣場（新仁愛路）：假日常態管制封閉。", "市府路（松高－松壽）：10 月 9 日 10 時起至 10 月 10 日 15 時全線封閉。"] },
      { lane: "flag", start: "07:00", end: "12:00", title: "市府國慶升旗暨慶祝活動", details: ["07:00–07:50　中籤民眾現場報到、領取兌換券。", "07:30–08:00　主舞台精彩暖場表演。", "08:00–08:30　國慶升旗典禮。", "08:30–12:00　慶祝活動全面開玩（舞台劇、魔術泡泡秀、早安市集、大型遊具體驗、憑券兌換限量國慶巧拼椅）。"] },
      { lane: "meet", start: "10:30", title: "見面會開放排隊等候" },
      { lane: "eoc", start: "10:45", end: "23:00", title: "府應變中心" },
      { lane: "meet", start: "11:00", end: "19:30", title: "見面會", details: ["19:00 最終受理。"] },
      { lane: "gift", start: "11:00", end: "20:00", title: "贈品發放（遮陽紙帽、Pokéscape）＆Kid's TV", details: ["19:00 最終受理。"] },
      { lane: "show", start: "11:30", end: "12:00", title: "遊行①", details: ["香堤大道遊行表演。"] },
      { lane: "show", start: "13:00", end: "13:35", title: "舞台①", details: ["13:00–13:15　EDM", "13:20–13:35　KidsTV"] },
      { lane: "show", start: "16:00", end: "16:30", title: "遊行②", details: ["香堤大道遊行表演。"] },
      { lane: "show", start: "17:30", end: "17:45", title: "舞台②［ROCK］" },
      { lane: "bigbang", start: "18:00", end: "21:30", title: "BIGBANG 演唱會" },
      { lane: "show", start: "19:15", end: "19:45", title: "舞台③［PokéXciting! 夜間秀］" },
      { lane: "traffic", start: "21:00", end: "22:30", title: "101 周邊交通管制" },
      { lane: "fire", start: "22:00", end: "22:14", title: "煙火暨無人機展演", details: ["煙火數量 16,000 發。"] },
    ],
  },
];
