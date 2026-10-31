// 活動勤務看板的資料。新活動加在最前面；活動日過了頁面會自動折疊。
// lanes：總表的欄位（group 相同的會併成一組）；support 有寫＝本局有支援，空字串＝本局未支援人車，info: true＝純資訊不標支援
// items：start／end 用 24 小時制；沒有 end 的是單一時間點
// pending：勤務資料還沒到齊時寫哪些待提供；有寫就不會顯示「本局支援：無／本局未支援人車」，資料齊了再拿掉
// spots：活動地點（名稱＋座標）；有填的話，活動底下會多一區「附近即時影像」，列出每個地點周圍的路口攝影機
const ACTIVITIES = [
  {
    // 2026-10-31 同志遊行：使用者當天下午給公告；戰情室同時切到這則（command-data.js COMMAND_PRIDE，20 時後自動回跨年）
    id: "1151031", date: "2026-10-31", title: "2026 第 24 屆臺灣同志遊行", place: "市民廣場・大安區／信義區",
    pending: "本局支援、進駐編組待提供",
    map: {
      center: [25.0375, 121.5560], zoom: 14.6,
      camBox: [[25.0325, 121.5480], [25.0425, 121.5670]],
      zones: [
        { name: "市府路管制（松高－松壽）", color: "#e2554a", note: "10/31 0～20 時雙向全線、20～24 時西側 4 線；11/1 0 時全線通行", points: [[25.0394, 121.5650], [25.0394, 121.5662], [25.0357, 121.5662], [25.0357, 121.5650]] },
        { name: "新仁愛路（市民廣場）", color: "#e2554a", note: "10/30 20 時起管制；集會、遊行起終點", points: [[25.0384, 121.5615], [25.0384, 121.5648], [25.0371, 121.5648], [25.0371, 121.5615]] },
        { name: "彈性擴大疏導管制範圍", color: "#f0a020", note: "敦化南路～市府路、忠孝東路～信義路；視現場狀況彈性調整", points: [[25.0416, 121.5488], [25.0416, 121.5665], [25.0332, 121.5665], [25.0332, 121.5488]] },
      ],
      posts: [],
      lives: [],
    },
    spots: [
      { name: "市民廣場（起終點）", lat: 25.0377, lng: 121.5632 },
      { name: "仁愛敦化圓環", lat: 25.0379, lng: 121.5490 },
      { name: "忠孝逸仙路口", lat: 25.0414, lng: 121.5617 },
      { name: "光復信義路口", lat: 25.0333, lng: 121.5576 },
    ],
    parts: [{ from: "00:00", name: "同志遊行" }],
    lanes: [
      { key: "rally", name: "市民廣場集會", color: "#ffd0e6", info: true },
      { key: "march", name: "遊行（北路線、南路線）", color: "#d6e4ff", info: true },
    ],
    items: [
      { lane: "rally", start: "10:00", end: "20:00", title: "集會（市民廣場、市府路）" },
      { lane: "march", start: "14:05", end: "17:35", title: "遊行出發→返回市民廣場", details: [
        "北路線約 3.75 公里：仁愛路4段→敦化南路→忠孝東路→逸仙路→仁愛路",
        "南路線約 4 公里：仁愛路4段→光復南路→信義路（逆向）→敦化南路→仁愛路4段",
        "沿線階段性彈性交通管制",
      ] },
    ],
  },
  {
    // 跨年：2026-10-19 使用者說「公開」，拿掉 hidden（原本 10/17 起隱藏、?preview=1 才看得到）
    // 時程、支援、管制區、進駐點等同仁給資料再填；直播連結拿到再加進 map.lives
    id: "1151231", date: "2026-12-31", title: "115 年跨年晚會暨 101 煙火", place: "市府周邊・信義區",
    pending: "管制區、進駐編組、直播、時程待提供",
    map: {
      center: [25.0355, 121.5645], zoom: 16,
      camBox: [[25.030, 121.556], [25.042, 121.572]],   // 這個範圍內的路口攝影機都標在地圖上
      zones: [],   // 管制區：{ name, points: [[lat, lng], ...], color, note }
      posts: [],   // 進駐點：{ name, lat, lng, unit, car, people, contact }
      lives: [     // 直播：{ name, lat, lng, url（YouTube 直播網址，可不公開） }；座標是鏡頭位置
        // 臺北市觀光傳播局「台北觀光即時影像」24 小時 4K 直播，正對 101。直播重開時網址會換，跨年前要再確認一次
        { name: "象山看台北（4K）", lat: 25.0272, lng: 121.5763, url: "https://www.youtube.com/live/z_fY1pj1VBw" },
      ],
    },
    spots: [
      { name: "市民廣場", lat: 25.0375, lng: 121.5630 },
      { name: "台北 101", lat: 25.0338, lng: 121.5645 },
      { name: "信義商圈", lat: 25.0360, lng: 121.5670 },
    ],
    parts: [{ from: "00:00", name: "跨年晚會與 101 煙火", img: "act-1010-night.webp", pos: "center 40%" }],
    lanes: [
      { key: "fire", name: "101 跨年煙火", color: "#ffd0e6", support: "" },
    ],
    items: [
      { lane: "fire", start: "23:59", end: "24:00", title: "101 跨年煙火" },
    ],
  },
  {
    id: "1151010", date: "2026-10-10", title: "115 年國慶日各項活動", place: "市府周邊・信義區",
    spots: [
      { name: "市民廣場（升旗）", lat: 25.0375, lng: 121.5630 },
      { name: "香堤大道（遊行）", lat: 25.0365, lng: 121.5670 },
      { name: "台北 101（煙火）", lat: 25.0338, lng: 121.5645 },
      { name: "臺北大巨蛋", lat: 25.0443, lng: 121.5603 },
    ],
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
      { key: "fire101", group: "101 煙火暨無人機展演", name: "101 管制中心進駐", color: "#ffe1ee", support: "大隊第一組組長、承辦人及信義中隊派員進駐 101 煙火管制中心（58 樓）" },
      { key: "fire", group: "101 煙火暨無人機展演", name: "煙火展演", color: "#ffd0e6", support: "莊敬 1 車 4 人（警消 2 人、義消 2 人）" },
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
      { lane: "fire101", start: "18:00", end: "24:00", title: "進駐 101 煙火管制中心（58 樓）", details: ["大隊第一組組長、承辦人及信義中隊派員進駐。"] },
      { lane: "bigbang", start: "18:00", end: "21:30", title: "BIGBANG 演唱會" },
      { lane: "show", start: "19:15", end: "19:45", title: "舞台③［PokéXciting! 夜間秀］" },
      { lane: "traffic", start: "21:00", end: "22:30", title: "101 周邊交通管制" },
      { lane: "fire", start: "22:00", end: "22:14", title: "煙火暨無人機展演", details: ["煙火數量 16,000 發。"] },
    ],
  },
];
