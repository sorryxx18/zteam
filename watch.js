// ---- 犀牛巡邏隊：新聞、Threads、Facebook 上跟消防、災害有關的公開內容（獨立後端定時抓，免登入可看） ----
// 要排在 app.js 前面載入（app.js 一啟動就會畫目前的專案）
const WATCH_API = "https://script.google.com/macros/s/AKfycbwFgbXawD8ZrHFvjVjbqjIZ1mGz8EOz9qmPCpUVYqFIIDYJWHvoCdMAxTUv-GAKkYq8jw/exec";
const WATCH_SRC = { news: ["新聞", "#d8ecff"], threads: ["Threads", "#e6dcff"], fb: ["Facebook", "#cfe0ff"] };
const WATCH_RANGE = [[0.25, "6 小時"], [1, "24 小時"], [3, "3 天"], [7, "7 天"]];
// 分級：依跟二大隊的關係遠近排。事件類（轄區／臺北市／全台）同一件事跨平台會合成一張；圈內話題和其他平常收起來
const WATCH_SEC = [
  { key: "unit", name: "💬 在地碎碎唸", note: "外面怎麼講我們：指名二大隊（中隊、分隊）的貼文，和在講臺北市消防局內部的貼文。正在發生的事件不在這裡，在下面的事件區。", empty: "這段時間沒有人在網路上講到二大隊或臺北市消防局。" },
  { key: "local", name: "轄區事件", img: "watch-local.webp", pos: "center 25%", empty: "這段時間大安、信義、南港沒有事件消息。" },
  { key: "taipei", name: "臺北市事件", empty: "這段時間臺北市其他區沒有事件消息。" },
  { key: "taiwan", name: "全台事件", img: "watch-news.webp", pos: "center 34%", empty: "這段時間沒有全台的事件消息。" },
  { key: "unverified", name: "社群未證實", fold: true, note: "臺北市其他區和外縣市，只有個人帳號、廠商或一般粉專在講、還沒有新聞或官方佐證的事件（轄區的不在這裡，直接放轄區事件並標「未證實」）。等新聞或官方也報了，會自動移到上面的事件區。" },
  { key: "circle", name: "圈內話題", fold: true, note: "消防圈的評論、制度討論、宣導和活動，不是正在發生的事件。" },
  { key: "noise", name: "其他", fold: true, note: "國外、廣告和跟消防無關的內容，平常不用看；資料都還在，可以搜尋或匯出 CSV。" },
];

// ---- 分級規則（2026-10-14） ----
// 轄區地標：和後端 Code.js 的 LOCAL_WORDS／LOCAL_ROADS 同一份，兩邊要一起改
const WATCH_LOCAL = ["大安區", "信義區", "南港區",
  "台北101", "臺北101", "101大樓", "信義計畫區", "信義商圈", "市府轉運站", "台北市政府", "臺北市政府", "大巨蛋", "台北文化體育園區", "臺北文化體育園區", "國父紀念館", "松山文創", "松菸",
  "台北世貿", "臺北世貿", "世貿一館", "世貿三館", "台北國際會議中心", "臺北國際會議中心", "信義新光三越", "新光三越信義", "新光三越A", "微風信義", "微風南山", "ATT 4 FUN", "ATT4FUN", "BELLAVITA", "統一時代", "誠品信義", "象山", "四獸山", "福德街", "北醫附", "吳興街", "永春",
  "大安森林", "臺灣大學", "台灣大學", "台大校園", "師範大學", "師大夜市", "臺灣科技大學", "台灣科技大學", "台科大", "忠孝SOGO", "復興SOGO", "SOGO忠孝", "SOGO復興", "遠企", "遠東企業中心", "永康街", "通化街", "臨江街", "國泰醫院", "仁愛院區", "建國花市", "建國玉市", "六張犁", "富陽", "大安運動中心",
  "南港展覽館", "南港車站", "南港站", "CITYLINK南港", "南港CITYLINK", "環球購物中心南港", "台北流行音樂中心", "臺北流行音樂中心", "中研院", "中央研究院", "研究院路", "南港軟體園區", "中國信託總部", "南港經貿", "南港公園", "南港山", "九五峰", "瓶蓋工廠", "昆陽", "202兵工廠"];
const WATCH_LOCAL_ROADS = /忠孝東路[四五六七4-7]段|信義路[三四五六3-6]段|仁愛路[三四3-4]段|光復南路|敦化南路|和平東路|復興南路|松仁路|松智路|松高路|松壽路|市府路|莊敬路|虎林街|經貿[一二]路|南港路/;
const W_OTHER_CITY = /台中|臺中|基隆|新北|桃園|新竹|台南|臺南|高雄/;   // 臺中也有大安區、基隆也有信義區
const W_FIRST_CITY = /台北|臺北|(?<![新竹])北市|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|竹北|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|馬祖/;   // 文中第一個出現的城市
const W_TPE_AREA = /(中正|大同|中山|松山|萬華|文山|內湖|士林|北投|大安|信義|南港)區|內湖|士林|北投|萬華|西門町|木柵|景美|天母|公館/;
// 事件字：真的有事情正在發生。單一個「火災」「消防」太常出現在宣導和評論，社群貼文不算；新聞標題的「火災／火警」才算
const W_EVENT = /火警|失火|起火|竄火|竄出火|延燒|燒毀|燒光|全毀|大火|惡火|火海|火燒|濃煙|冒煙|悶燒|氣爆|爆炸|受困|救出|送醫|不治|身亡|罹難|喪命|燒傷|燒燙傷|嗆傷|墜樓|墜落|墜谷|溺水|溺斃|落水|坍塌|倒塌|崩塌|土石流|天坑|淹水|一氧化碳|失聯|搜救|OHCA|無生命跡象|觸電|電線走火/;
const W_EVENT_NEWS = /火災|火警/;
const W_EDU = /專家|風險|怎樣|怎麼|如何|教你|必清|秘訣|要訣|小心|預防|防範|注意事項|迷思|一次看|懶人包/;   // 新聞標題有「火災」但其實是防災知識
const W_QUAKE = /規模\s*[\d０-９]|震度|震央|芮氏|地震速報|國家級警報|有感/;
const W_SKIP = /演練|演習|宣導|模擬|預演|體驗|判刑|判決|交保|起訴|約談|索賠|求償|動土|捐贈|表揚|講習|研習|招募|招生|徵才|課程|懶人包|小撇步|爆炸頭|週年|周年|回顧|紀念/;   // 不是正在發生的事
// 重大：多人傷亡（2 死以上、3 傷以上）、大火延燒、氣爆、建物倒塌、大規模疏散、規模 5／震度 4 以上地震、出動 20 車以上。單一人的意外（墜落、溺水、夾傷）不算
const W_MAJOR = /[2-9２-９二兩三四五六七八九十]\s*人?(?:死|罹難|身亡|不治)|(?:[3-9３-９三四五六七八九十]|\d{2,})\s*人?(?:傷|受傷|送醫|受困|輕重傷|燒傷|疏散)|\d{2,}\s*人(?:疏散|撤離)|大火|惡火|火海|延燒|氣爆|爆炸|坍塌|倒塌|二級火警|三級火警|撤離|規模\s*[5-7５-７]|震度\s*[4-7４-７]|出動\s*(?:[2-9]\d|\d{3})\s*車/;
const W_MAJOR_NEWS = 5;   // 同一件事有 5 則以上新聞報導，也算重大
const W_ABROAD = /日本|東京|大阪|美國|加州|紐約|中國大陸|大陸|陸媒|香港|港鐵|藍田|九龍|新界|旺角|將軍澳|屯門|沙田|荃灣|觀塘|葵涌|元朗|天水圍|銅鑼灣|尖沙咀|宏福苑|澳門|韓國|南韓|首爾|菲律賓|印尼|越南|泰國|曼谷|馬來西亞|新加坡|印度|土耳其|烏克蘭|俄羅斯|以色列|伊朗|加薩|法國|巴黎|英國|倫敦|德國|澳洲|加拿大|巴西|墨西哥|沙烏地|沙國|葉門|胡塞|利雅德|中東|黎巴嫩|敘利亞|伊拉克|阿富汗|巴基斯坦|緬甸|柬埔寨|尼泊爾|熊本|北海道|沖繩|札幌|名古屋|福岡|京都|橫濱|神戶|雪梨|墨爾本|布魯塞爾|Brussel|葵青|大窩口|梨泰院|韓文|巴拿馬|智利|秘魯|阿根廷|哥倫比亞|厄瓜多|委內瑞拉|紐西蘭|義大利|西班牙|希臘|荷蘭|瑞士|瑞典|挪威|波蘭|埃及|南非|[唔嘅喎冇嘢啲]|係咪|佢哋|搞乜/;
const W_SIMPLIFIED = /[们这说时过还没灭习发现动东车门开关网样从会对觉响让给应实为]/g;   // 簡體字出現兩個以上＝中國、馬來西亞等地的貼文
const W_TW = /台灣|臺灣|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|竹北|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|馬祖|國軍|消防署/;
const W_AD = /出租|租屋|售屋|買房|權狀|坪數|團購|優惠價|折扣碼|限時優惠|下單|私訊|加賴|官方LINE|代購|免運|業配|歡迎洽詢|預約諮詢|廠牌|報價|維修保養|故障更新|有限公司.{0,20}(?:維修|安裝|施工)/;
// 消防設備名稱裡的「火警」不是發生火警（火警受信總機、火警探測器…），判斷事件前先拿掉
const W_EQUIP = /火警(?:受信總機|受信|總機|探測器|探測|警報器|警報設備|自動警報|發信機|綜合盤|系統|設備)|受信總機/g;
const W_CIRCLE = /消防|警消|義消|救護|119|防災|EMT|火災|火警|救災|災害/;
const W_CITY = /台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|馬祖/;
const W_TYPES = [["fire", /火|燒|煙|爆/], ["collapse", /坍塌|倒塌|崩塌|土石流|天坑/], ["rescue", /受困|墜|溺|落水|失聯|搜救|山難|迷途/], ["quake", /地震/], ["flood", /淹水|豪雨/]];
const W_ROAD_STOP = /^(道路|馬路|公路|鐵路|網路|線路|走路|出路|上路|山路|一路|後路|小路|大路|迷路|退路|思路|套路|門路|心路|來路|去路|活路|末路|生路|近路|遠路|水路|陸路|航路|電路|通路|銷路|半路|回路|帶路|讓路|開路|趕路|順路|攔路|擋路|上街|逛街|大街|老街|過街|滿街|沿街|臨街|掃街|美食街|商店街)$/;
// 國外：先提到的是國外地名就算國外（「美國南加州淹水，跟台北有得比」）；簡體字出現兩個以上也算
const wAbroad = (t) => { const a = t.search(W_ABROAD), w = t.search(W_TW); return (a >= 0 && (w < 0 || a < w)) || new Set(t.match(W_SIMPLIFIED) || []).size >= 2; };
const wLocal = (t) => !(W_OTHER_CITY.test(t) && !/台北|臺北/.test(t)) && (WATCH_LOCAL.some((w) => t.includes(w)) || WATCH_LOCAL_ROADS.test(t));
// 臺北市：文中第一個提到的城市是臺北（貼文常在後面順帶提到台北，不能只看有沒有出現）；沒提城市就看臺北的區名
const wTaipei = (t) => { const c = t.match(W_FIRST_CITY); return c ? /台北|臺北|北市/.test(c[0]) : W_TPE_AREA.test(t); };
// 在地碎碎唸：講到我們單位的（2026-10-15）。單位名依消防局官網「業務職掌－第二大隊」：3 個中隊、9 個分隊
const W_UNIT = /第二救災救護大隊|(?:信義|大安|南港)中隊|(?:信義|永吉|莊敬|安和|金華|復興|南港|舊莊|成德)(?:消防)?分隊/;
const W_UNIT_BN = /第?二大隊/;   // 各縣市都有第二大隊，要同時提到臺北才算
const W_UNIT_SLANG = /(?:天龍|台北|臺北|北市).{0,20}(?:101|信義|大安|南港|東區|大巨蛋|松菸).{0,10}(?:中隊|分隊|大隊)|(?:101|信義|大安|南港).{0,8}(?:旁|附近|靠近|那).{0,6}(?:中隊|分隊)|靠近101|101旁/;
const W_TFD = /靠北天龍|天龍國?(?:消防|局長|大隊|中隊|分隊)|(?:(?<!新)北市|臺北市|台北市)(?:政府)?消防局|(?<!新)北市消防/;   // 臺北市消防局（「天龍」＝臺北市）
const W_TPE_ANY = /台北|臺北|北市|天龍/;
const W_OWN_PAGE = /北市消防第二大隊|臺北市政府消防局|台北市政府消防局|消防署/;   // 官方粉專發的是公告，不算
function wUnit(i, t) {
  if (W_OWN_PAGE.test(i.o || "") || (W_OTHER_CITY.test(t) && !W_TPE_ANY.test(t))) return "";
  if (W_UNIT.test(t) || (W_UNIT_BN.test(t) && W_TPE_ANY.test(t)) || W_UNIT_SLANG.test(t)) return "ours";
  return W_TFD.test(t) && !wLocal(t) ? "tfd" : "";   // 轄區里長、居民提到消防局的，是轄區的事，不算
}
// 幫每則內容算分級（結果存在項目上，只算一次）：_g 分級、_loc 有提到轄區、_m 重大、_type 事件類型
function wTier(i) {
  if (i._g) return i;
  // Google 收錄的 FB 貼文：「｜」後面是 Google 摘要，常混進同一頁別篇貼文的字（例如八仙山 OHCA 摘要裡夾著大巨蛋演唱會），只看前面本文
  const x = (/Google收錄/.test(i.o || "") ? (i.x || "").split("｜")[0] : (i.x || "")).replace(W_EQUIP, "設備"), t = x + " " + (i.h || "").replace(W_EQUIP, "設備");   // h：Threads 卡片底下真正提到事件的留言
  const abroad = wAbroad(t), ad = W_AD.test(x);
  const ev = !abroad && !ad && !W_SKIP.test(x) && (W_EVENT.test(t) || (i.s === "news" && W_EVENT_NEWS.test(x) && !W_EDU.test(x)) || (/地震/.test(t) && W_QUAKE.test(t)));
  i._loc = wLocal(t);
  i._g = abroad || ad ? "noise" : ev ? (i._loc ? "local" : wTaipei(t) ? "taipei" : "taiwan") : (i._loc || W_CIRCLE.test(x)) ? "circle" : "noise";
  i._unit = wUnit(i, t);
  // 在講我們的放在地碎碎唸：不是事件的都放；指名本大隊的社群貼文就算提到火警（像靠北消防在講三級火警統計）也放這裡，新聞報導的事件仍留在事件區
  if (i._unit && !abroad && !ad && (i._g === "circle" || i._g === "noise" || (i._unit === "ours" && i.s !== "news"))) i._g = "unit";
  i._m = ev && i._g !== "unit" && W_MAJOR.test(t);
  i._type = ev ? ((W_TYPES.find(([, r]) => r.test(t)) || ["other"])[0]) : "";
  return i;
}

// ---- 跨平台同一事件合併：同類型、6 小時內、不同城市不併；要嘛同一條路／公路／鄉鎮／地標，要嘛文字有四成以上相同（新聞對新聞三成五） ----
// 只合在畫面上：主卡下面列出其他來源，每一則都還點得到，原始資料不動。Threads 的同串分組（thread_id）照後端，不在這裡改
const W_LM_SAME = { "南港站": "南港車站", "101大樓": "台北101", "SOGO忠孝": "忠孝SOGO", "SOGO復興": "復興SOGO", "中央研究院": "中研院", "松菸": "松山文創", "臺灣大學": "台灣大學", "臺灣科技大學": "台科大", "台灣科技大學": "台科大", "南港CITYLINK": "CITYLINK南港", "新光三越信義": "信義新光三越", "遠東企業中心": "遠企", "臺北文化體育園區": "大巨蛋", "台北文化體育園區": "大巨蛋" };   // 同一個地標的不同寫法
const W_EV_HOURS = 6;          // 只靠文字相似：6 小時內
const W_EV_PLACE_HOURS = 24;   // 同一條路／公路／鄉鎮／地標：24 小時內（大火、重大車禍隔天還會有後續報導）
const wGrams = (s) => { const t = s.replace(/[^一-鿿0-9a-z]/gi, ""), g = new Set(); for (let k = 0; k < t.length - 1; k++) g.add(t.slice(k, k + 2)); return g; };
// 鄉鎮市區名（跨平台合併用）：大部分直接認；「中山、信義、成功」這種也是常見詞或路名的、和「宜蘭、花蓮」這種跟縣名同名的，要寫成「○○區／鄉／鎮／市」才算
const W_TOWNS = /(三地門|那瑪夏|阿里山|太麻里|車城|六腳|望安|麥寮|橋頭|金沙|國姓|新化|臺西|文山|豐原|平鎮|金寧|頭屋|南州|口湖|溪湖|竹崎|池上|名間|褒忠|枋寮|造橋|瑞穗|三峽|楊梅|大肚|歸仁|朴子|學甲|番路|瑞芳|北斗|林園|茄萣|礁溪|岡山|鹽埕|麻豆|潭子|新豐|恆春|四湖|雙溪|金湖|芬園|萬丹|林內|五股|水里|前金|梓官|南澳|官田|鳥松|佳里|善化|龍崎|伸港|西屯|萬巒|田寮|板橋|芳苑|集集|竹東|淡水|南化|美濃|虎尾|關西|鹿草|小港|冬山|銅鑼|豐濱|六甲|後龍|龜山|竹南|北投|峨眉|南屯|海端|芎林|關廟|茂林|竹田|楠梓|頭城|新社|甲仙|新園|蘆洲|獅潭|卓蘭|佳冬|金城|石碇|蘇澳|土庫|汐止|八德|大雅|橫山|北屯|彌陀|北埔|社頭|通霄|石岡|永靖|東石|萬華|二水|仁德|花壇|霧台|馬公|滿州|七股|柳營|霧峰|鳳山|潮州|杉林|神岡|左鎮|埔里|新埔|崙背|金峰|麟洛|鼓山|安南|龍潭|鶯歌|斗南|後壁|來義|玉里|壽豐|南庄|二崙|埤頭|觀音|員山|和美|鹿野|三星|鹿谷|土城|外埔|七堵|大甲|古坑|寶山|梅山|湖西|六龜|士林|玉井|沙鹿|埔心|大園|元長|線西|太保|大埤|前鎮|安平|樹林|平溪|吉安|溪口|竹塘|卑南|達仁|魚池|新埤|里港|大溪|泰武|羅東|烏來|台西|中西|大里|燕巢|左營|苑裡|義竹|新營|西港|秀林|西嶼|溪州|萬榮|阿蓮|泰安|鹿港|苓雅|新莊|員林|鳳林|仁武|三重|林邊|后里|卓溪|民雄|大林|旗山|內埔|七美|烏日|貢寮|草屯|三灣|田尾|中寮|湖口|枋山|內湖|鹽埔|中壢|坪林|尖石|旗津|莿桐|頭份|二林|鹽水|高樹|崁頂|壯圍|楠西|三義|八里|下營|西螺|五結|斗六|秀水|水林|瑪家|深坑|梧棲|新店|蘆竹|三芝|大寮|埔鹽|暖暖|烈嶼)(?![路街]|大道|國小|國中|高中)/g;
const W_TOWNS_SUFFIX = /(三地門|阿里山|那瑪夏|太麻里|車城|麥寮|信義|琉球|文山|平鎮|南州|池上|竹崎|瑞穗|朴子|竹北|雙溪|芬園|萬丹|林內|大湖|東港|佳里|善化|萬巒|田寮|集集|竹東|虎尾|冬山|小港|後龍|水上|海端|九如|蘆洲|白河|延平|竹山|佳冬|金城|石碇|中山|社頭|大村|永靖|花壇|馬公|北港|左鎮|金峰|麟洛|鼓山|七美|斗南|東山|埤頭|員山|鹿野|土城|六龜|埔心|太保|平溪|龍井|里港|台西|大里|燕巢|苑裡|西港|秀林|新屋|新莊|大林|內埔|三灣|田尾|新興|五結|斗六|秀水|水林|新港|蘆竹|三芝|埔鹽|彰化|橋頭|金沙|金山|臺西|名間|枋寮|大肚|宜蘭|台東|茄萣|礁溪|永和|岡山|四湖|水里|石門|官田|南澳|板橋|芳苑|屏東|美濃|花蓮|豐濱|六甲|中埔|龜山|竹南|北投|關廟|三民|獅潭|土庫|大雅|北屯|彌陀|仁德|二水|霧台|西湖|霧峰|和平|安南|鶯歌|後壁|壽豐|玉里|桃園|和美|鹿谷|大甲|古坑|湖西|士林|太平|東勢|前鎮|春日|安平|竹塘|達仁|魚池|獅子|泰武|大埔|西嶼|溪州|萬榮|阿蓮|大城|鹿港|福興|仁武|三重|后里|旗山|烏日|中寮|大同|莿桐|頭份|二林|內門|林口|瑪家|大寮|六腳|大安|大武|金寧|頭屋|口湖|溪湖|褒忠|山上|三峽|永康|學甲|番路|瑞芳|林園|麻豆|新豐|金湖|南港|龍崎|伸港|西屯|南投|淡水|南化|關西|銅鑼|新市|峨眉|南屯|成功|長濱|竹田|楠梓|頭城|東河|新社|甲仙|八德|橫山|白沙|北埔|松山|東石|滿州|鳳山|杉林|五峰|長治|崙背|來義|南庄|觀音|三星|寶山|梅山|新城|沙鹿|大園|元長|線西|中正|湖內|吉安|溪口|卑南|左營|義竹|泰安|苓雅|員林|蘭嶼|中和|桃源|湖口|苗栗|大樹|枋山|鹽埔|高樹|香山|仁愛|旗津|崁頂|壯圍|下營|安定|光復|北門|深坑|梧棲|新店|大內|暖暖|烈嶼|望安|國姓|新化|公館|豐原|造橋|楊梅|歸仁|牡丹|北斗|路竹|鹽埕|潭子|恆春|前金|梓官|永安|鳥松|鹿草|芎林|茂林|關山|將軍|新園|卓蘭|蘇澳|富里|汐止|通霄|石岡|萬華|泰山|七股|萬里|柳營|潮州|神岡|田中|埔里|新埔|龍潭|二崙|安樂|外埔|七堵|玉井|復興|大埤|樹林|新埤|大溪|羅東|烏來|中西|新營|鳳林|林邊|卓溪|民雄|貢寮|草屯|清水|內湖|中壢|坪林|尖石|鹽水|楠西|三義|八里|西螺|綠島|布袋|大社|五股)[區鄉鎮市](?![長民府政議])/g;
const wNum = (x) => x.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/^十$/, "10").replace(/^十([一二三四五六七八九])/, "1$1").replace(/^([一二三四五六七八九])十$/, "$10").replace(/([一二三四五六七八九])十([一二三四五六七八九])/, "$1$2").replace(/[一二三四五六七八九]/g, (c) => "一二三四五六七八九".indexOf(c) + 1);
function wSig(i) {
  if (i._sig) return i._sig;
  const t = (/Google收錄/.test(i.o || "") ? i.x.split("｜")[0] : i.x) + " " + (i.h || ""), places = new Set();
  for (const m of t.matchAll(/([一-龥]{2}(?:路|街|大道))/g)) {
    if (W_ROAD_STOP.test(m[1].slice(-2))) continue;
    places.add(m[1]);
  }
  for (const m of t.matchAll(/(?:台|臺)\s*([\d０-９一二三四五六七八九十]{1,3}[甲乙丙]?)\s*線|國道\s*([\d０-９一二三四五六七八九十]+)號?|(蘇花改|蘇花公路|北宜|中橫|南橫)/g)) places.add("hw" + wNum(m[1] || m[2] || m[3]));   // 公路（台九線＝台9線）
  for (const m of t.matchAll(W_TOWNS)) places.add("town" + m[1]);
  for (const m of t.matchAll(W_TOWNS_SUFFIX)) places.add("town" + m[1]);
  WATCH_LOCAL.forEach((w) => { if (t.includes(w)) places.add("lm" + (W_LM_SAME[w] || w).replace(/臺/g, "台")); });
  const city = ((t.match(W_FIRST_CITY) || [""])[0].replace("臺", "台").replace(/^(?:竹北)$/, "新竹").replace(/^北市$/, "台北")) || (i._g === "local" || i._g === "taipei" ? "台北" : "");
  return (i._sig = { places, city, g: wGrams(i.x.slice(0, 80)) });
}
function wSame(a, b) {
  const dt = Math.abs(a.t - b.t);
  if (a._type !== b._type || dt > W_EV_PLACE_HOURS * 3600000) return false;
  const A = wSig(a), B = wSig(b);
  if (A.city && B.city && A.city !== B.city) return false;
  let n = 0; A.g.forEach((x) => { if (B.g.has(x)) n++; });
  const ratio = n / Math.max(1, Math.min(A.g.size, B.g.size));
  // 同一條路、同一段公路、同一個鄉鎮或地標（大安區這種行政區太大不算；轄區內就靠路名、地標和文字相似）
  for (const r of A.places) if (B.places.has(r) && !/^lm(大安區|信義區|南港區)$|^town(大安|信義|南港)$/.test(r)) return true;
  return dt <= W_EV_HOURS * 3600000 && ratio >= (a.s === "news" && b.s === "news" ? 0.35 : 0.4);
}
const W_PRI = { news: 0, fb: 1, threads: 2 };
// ---- 可信來源（2026-10-14 使用者選的做法）：新聞、官方消防單位、媒體粉專／帳號、固定報災情的消防圈粉專 ----
// 事件要有至少一則可信來源（同一事件合併後只要其中一則是）才進轄區／臺北市／全台事件；只有不明帳號在講的進「社群未證實」
const W_TRUST_FIRE = /消防局|消防署|消防.{0,4}大隊|消防分隊|救災救護|義消|消防神主牌|靠北消防/;
const W_TRUST_MEDIA = /新聞|日報|時報|週刊|晚報|電視|TVBS|ETtoday|三立|中天|東森|民視|公視|華視|台視|聯合報|自由時報|鏡週刊|Yahoo|壹蘋|CTWANT|NOWnews|風傳媒|報導者|中央社|setn|mnews|nextapple|udn|ltn|ebc|ftv|cts|pts|cna|tvbs|ettoday|nownews|ctwant|chinatimes|ctitv/i;
const W_NOT_TRUST = /有限公司|企業社|工程行|行號|實業|興業|機電|保全/;   // 名字裡有「消防」的設備廠商不算
const wTrusted = (i) => i.s === "news" || (!W_NOT_TRUST.test(i.o || "") && (W_TRUST_FIRE.test(i.o || "") || W_TRUST_MEDIA.test(i.o || "")));
const W_EVENT_SEC = { local: 1, taipei: 1, taiwan: 1, unverified: 1 };
const W_RANK = { local: 0, taipei: 1, taiwan: 2 };
function wEvents(items) {   // items：已經是事件類的；回傳 [{main, rel:[], g, m}]，依最新時間排
  const groups = [];
  [...items].sort((a, b) => b.t - a.t).forEach((i) => {
    const g = groups.find((x) => x.all.some((y) => wSame(i, y)));
    if (g) g.all.push(i); else groups.push({ all: [i] });
  });
  return groups.map(({ all }) => {
    const main = [...all].sort((a, b) => (W_PRI[a.s] - W_PRI[b.s]) || (b.t - a.t))[0];
    // 轄區例外（2026-10-15 使用者選 A）：轄區最早的消息常是路人發文，沒有佐證也留在轄區事件，卡片標「未證實」
    const area = all.map((i) => i._g).sort((a, b) => W_RANK[a] - W_RANK[b])[0], unv = !all.some(wTrusted), g = !unv || area === "local" ? area : "unverified";
    const nNews = all.filter((i) => i.s === "news").length, news = nNews > 0;   // 社群貼文常是轉貼、回顧或宣導，有新聞報導的事件才算「重大」
    return { main, rel: all.filter((i) => i !== main), g, area, unv, news, nNews, m: news && (nNews >= W_MAJOR_NEWS || all.some((i) => i.s === "news" && i._m)), t: Math.max(...all.map((i) => i.t)), loc: all.some((i) => i._loc) };
  }).sort((a, b) => b.t - a.t);
}
const WATCH_PAGE = 10;       // 每一區先顯示幾則
const WATCH_REFRESH = 10 * 60000;   // 開著頁面時每 10 分鐘自動更新
const WATCH_TIMEOUT = 70000;         // 一次請求最多等多久（後端慢的時候一次要 20～60 秒）
const WATCH_RETRY = [2000, 5000, 10000, 20000, 30000, 30000];   // 失敗後隔多久再試；連同等待大約撐 4 分鐘

// 置頂：新聞或 Threads 在這段時間內的火警、災害事件；臺北市排最前面
const PIN_HOURS = 4;
const PIN_HIT = /火警|火災|大火|惡火|起火|失火|火海|濃煙|冒煙|爆炸|氣爆|地震|強震|海嘯|淹水|土石流|坍塌|倒塌|崩塌|山難/;   // 車禍受困這類救助案件不算
const PIN_MAX = 8;           // 置頂先顯示幾則
const PIN_SKIP = /演練|演習|宣導|模擬|預演|體驗|判刑|交保|起訴|約談|索賠|求償|動土|捐贈|表揚|檢討|相關報導|標籤頁|後院失火/;   // 不是正在發生的事
// 「地震」「海嘯」當形容詞用（政壇大地震、裁員海嘯）不算災害：要同時出現真的災害才會有的字，規則和後端 REAL_ 一致
const QUAKE_REAL = /規模|震度|震央|有感|搖晃|晃|地牛|餘震|強震|主震|震災|震後|地震後|防震|耐震|氣象署|芮氏|地震速報|國家級警報|發生地震|海域|外海|近海|災情|傷亡/;
const TSUNAMI_REAL = /警報|地震|浪高|公尺|沿海|氣象署|撤離|侵襲|海嘯襲/;
const pinHit = (x) => PIN_HIT.test(x.replace(/地震/g, QUAKE_REAL.test(x) ? "地震" : "").replace(/海嘯/g, TSUNAMI_REAL.test(x) ? "海嘯" : ""));

let watch = null;            // 後端回來的資料 {items, lastFetch, now, days}
let watchState = "";         // "loading"｜"error"｜""
let watchTry = 0;             // 這次載入已經重試幾次（0＝還沒失敗過）
const watchF = { src: "", q: "", days: "1", loc: "" };   // loc："1"＝只看有提到轄區的內容
const watchShown = {};       // 各區目前顯示幾則
const watchOpen = {};        // 收起來的區塊（圈內話題、其他）有沒有被打開

async function loadWatch(days) {
  watchState = "loading"; watchTry = 0; drawWatch();
  try {
    let data;
    for (let i = 0; ; i++) {   // 後端偶爾會有兩三分鐘很慢或回 404、非 JSON（暫時性）：每次最多等 WATCH_TIMEOUT，失敗就照 WATCH_RETRY 的間隔再試
      try { data = await (await fetch(`${WATCH_API}?days=${days}`, { signal: AbortSignal.timeout(WATCH_TIMEOUT) })).json(); if (!data.ok) throw new Error(data.error || "error"); break; }
      catch (e) {
        if (i >= WATCH_RETRY.length) throw e;
        watchTry = i + 1;
        if (!watch) drawWatch(); else if ($("#wReload")) $("#wReload").textContent = `後端忙碌，重試中（${watchTry}）…`;   // 已有資料時只改按鈕文字，不重畫整頁（會打斷正在輸入的搜尋）
        await new Promise((r) => setTimeout(r, WATCH_RETRY[i]));
      }
    }
    data.items = data.items.filter((i) => i.s in WATCH_SRC).map(wTier);   // 已經不看的來源（PTT、Instagram）舊資料不顯示；每則先算好分級
    watch = data; watch.at = Date.now(); watchState = "";
  } catch (e) { watchState = "error"; }
  drawWatch();
}

const watchTime = (t) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const watchAgo = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時 ${m % 60} 分前`; };

function watchFiltered() {
  if (!watch) return [];
  const since = Date.now() - Number(watchF.days) * 86400000, q = watchF.q.trim().toLowerCase();
  return watch.items.filter((i) => i.t >= since && (!watchF.src || i.s === watchF.src) && (!watchF.loc || i._loc)
    && (!q || (i.x + " " + i.o + " " + (i.h || "")).toLowerCase().includes(q)));
}

// 置頂清單：4 小時內的事件（用分級和跨平台合併的結果）。轄區、臺北市的全收；外縣市要有新聞報導、而且是火警或災害（車禍受困這類救助案件不算）
function watchPinned() {
  if (!watch) return [];
  const since = Date.now() - PIN_HOURS * 3600000;
  return wEvents(watch.items.filter((i) => i.t >= since && W_RANK[i._g] !== undefined))
    .filter((e) => e.g === "local" || e.g === "taipei" || (e.g === "taiwan" && e.news && e.main._type !== "rescue" && e.main._type !== "other" && [e.main, ...e.rel].some((i) => i.s === "news" && pinHit(i.x) && !PIN_SKIP.test(i.x))))
    .map((e) => ({ i: e.main, more: e.rel.length, taipei: e.g !== "taiwan", local: e.g === "local", unv: e.unv }))
    .sort((a, b) => (b.local - a.local) || (b.taipei - a.taipei) || (b.i.t - a.i.t));
}

function renderWatch() {
  $("#view").innerHTML = `<div class="banner wbanner" style="background-image:url('img/skyline.webp');background-position:center 36%"><div class="btitle">犀牛巡邏隊</div></div>
    <p class="note">犀牛幫你巡新聞和社群：自動蒐集新聞、Threads、Facebook 上跟消防、災害有關的公開內容，依跟二大隊的關係分成轄區、臺北市、全台事件；同一件事多個來源會合成一張。新聞每小時更新，Facebook／Threads 關鍵字搜尋每 15 分鐘更新。</p>
    <div class="wbox" id="wBox"></div>`;
  $("#wBox").addEventListener("click", (x) => {
    const jump = x.target.closest("[data-jump]");   // 犀牛速報的格子：跳到那一區
    if (jump) { const el = $(`#wsec-${jump.dataset.jump}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const b = x.target.closest("[data-k]");
    if (b) {
      const card = b.classList.contains("stat");   // 數字卡：再點一次取消，並跳到下面清單
      watchF[b.dataset.k] = card && watchF[b.dataset.k] === b.dataset.v ? "" : b.dataset.v;
      Object.keys(watchShown).forEach((k) => delete watchShown[k]);
      if (b.dataset.k === "days" && watch && Number(b.dataset.v) > watch.days) loadWatch(Number(b.dataset.v)); else drawWatch();
      if (card && $("#wList")) $("#wList").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const more = x.target.closest("[data-more]");
    if (more) { const k = more.dataset.more; watchShown[k] = (watchShown[k] || (k === "pin" ? PIN_MAX : WATCH_PAGE)) + 20; drawWatch(); return; }
    if (x.target.closest("#wReload")) { loadWatch(Math.max(7, Number(watchF.days))); return; }
    if (x.target.closest("#wCsv")) watchCsv();
  });
  $("#wBox").addEventListener("keydown", (x) => { if ((x.key === "Enter" || x.key === " ") && x.target.matches("[role=button]")) { x.preventDefault(); x.target.click(); } });
  $("#wBox").addEventListener("toggle", (x) => { if (x.target.dataset && x.target.dataset.fold) watchOpen[x.target.dataset.fold] = x.target.open; }, true);
  $("#wBox").addEventListener("input", (x) => { if (x.target.id === "wQ") { watchF.q = x.target.value; drawWatchList(); } });
  if (!watch && watchState !== "loading") loadWatch(7); else drawWatch();
}

// Google 收錄的 FB：畫面只顯示「｜」前面的本文，後面的 Google 摘要常夾雜別篇貼文（搜尋、匯出仍用全文）
const wShow = (i) => (/Google收錄/.test(i.o || "") ? i.x.split("｜")[0] : i.x).replace(/^討論牆\s*[|｜]\s*/, "");   // LINE TODAY 標題前面會帶「討論牆 |」
const watchItem = (i, extra = "") => {
  const [name, color] = WATCH_SRC[i.s] || [i.s, "#fff"];
  return `<a class="witem${i._loc ? " local" : ""}" href="${esc(i.u)}" target="_blank" rel="noopener noreferrer">
    <span class="wmeta"><span class="wtime">${watchTime(i.t)}</span><span class="tag" style="background:${color}">${name}</span>${extra}${i._m ? `<span class="tag bad">重大</span>` : ""}${i._loc ? `<span class="tag sup">轄區</span>` : ""}${i._g === "unit" ? (i._unit === "ours" ? `<span class="tag bad">本大隊</span>` : `<span class="tag warn">北市消防</span>`) : ""}<span class="worigin">${esc(i.o)}</span></span>
    <span class="wtext">${esc(wShow(i))}</span>${i.h ? `<span class="whit">留言提到：${esc(i.h.slice(0, 120))}${i.h.length > 120 ? "…" : ""}</span>` : ""}</a>`;
};
// 事件卡：主卡＋同一件事的其他來源（收在下面，點開看）
const watchEvent = (e) => {
  const main = Object.assign({}, e.main, { _m: e.m, _loc: e.main._loc || e.area === "local" });
  const unv = e.unv ? `<span class="tag warn" title="還沒有新聞或官方來源佐證">未證實</span>` : "";
  if (!e.rel.length) return watchItem(main, unv);
  const by = {}; e.rel.forEach((i) => { by[i.s] = (by[i.s] || 0) + 1; });
  const sum = Object.entries(by).map(([k, n]) => `${WATCH_SRC[k][0]} ${n}`).join("・");
  return `<div class="wev">${watchItem(main, `<span class="tag">同一事件共 ${e.rel.length + 1} 則</span>${unv}`)}
    <details class="wrel"><summary>其他來源：${sum}</summary>${e.rel.map((i) => `<a href="${esc(i.u)}" target="_blank" rel="noopener noreferrer"><span class="wtime">${watchTime(i.t)}</span><span class="tag" style="background:${WATCH_SRC[i.s][1]}">${WATCH_SRC[i.s][0]}</span><span class="worigin">${esc(i.o)}</span> ${esc(wShow(i).slice(0, 70))}${wShow(i).length > 70 ? "…" : ""}</a>`).join("")}</details></div>`;
};

// 犀牛速報：轄區、臺北市、全台重大各幾件，列最重要的標題（不受來源、搜尋篩選影響，只看時間範圍）
function watchSummary(inRange) {
  const ev = wEvents(inRange.filter((i) => W_RANK[i._g] !== undefined));
  const local = ev.filter((e) => e.g === "local"), tpe = ev.filter((e) => e.g === "taipei"), major = ev.filter((e) => e.g === "taiwan" && e.m).sort((a, b) => (b.rel.length - a.rel.length) || (b.t - a.t));   // 全台重大：報導越多的排越前面
  const label = WATCH_RANGE.find(([d]) => String(d) === watchF.days)[1];
  const line = (e, tag) => `<li><a href="${esc(e.main.u)}" target="_blank" rel="noopener noreferrer"><span class="tag${tag === "轄區" ? " sup" : ""}">${tag}</span>${e.unv ? `<span class="tag warn">未證實</span>` : ""} ${esc(wShow(e.main).slice(0, 60))}${wShow(e.main).length > 60 ? "…" : ""}<span class="note">（${watchAgo(e.t)}${e.rel.length ? `，共 ${e.rel.length + 1} 則` : ""}）</span></a></li>`;
  // 在地碎碎唸也放進速報：指名本大隊的排前面
  const talk = inRange.filter((i) => i._g === "unit").sort((a, b) => ((b._unit === "ours") - (a._unit === "ours")) || (b.t - a.t));
  const tline = (i) => `<li><a href="${esc(i.u)}" target="_blank" rel="noopener noreferrer"><span class="tag ${i._unit === "ours" ? "bad" : "warn"}">${i._unit === "ours" ? "本大隊" : "北市消防"}</span> ${esc(wShow(i).slice(0, 60))}${wShow(i).length > 60 ? "…" : ""}<span class="note">（${esc(i.o)}，${watchAgo(i.t)}）</span></a></li>`;
  const top = local.slice(0, 2).map((e) => line(e, "轄區")).concat(talk.slice(0, 2).map(tline), tpe.slice(0, 2).map((e) => line(e, "臺北市")), major.slice(0, 2).map((e) => line(e, "全台重大")));
  return `<div class="wsum"><h2>🦏 犀牛速報｜${label}內</h2>
    <div class="wsumgrid"><div class="wsumc local" data-jump="local" role="button" tabindex="0"><span>轄區事件</span><b>${local.length}</b></div><div class="wsumc" data-jump="unit" role="button" tabindex="0"><span>在地碎碎唸</span><b>${talk.length}</b></div><div class="wsumc" data-jump="taipei" role="button" tabindex="0"><span>臺北市事件</span><b>${tpe.length}</b></div><div class="wsumc" data-jump="taiwan" role="button" tabindex="0"><span>全台重大</span><b>${major.length}</b></div></div>
    ${top.length ? `<ul class="wsumlist">${top.join("")}</ul>` : `<p class="note">${label}內轄區、臺北市沒有事件，沒有人在講我們，全台也沒有重大事件。</p>`}</div>`;
}

function drawWatch() {
  const box = $("#wBox");
  if (!box) return;
  if (!watch) {
    box.innerHTML = watchState === "error"
      ? `<div class="card empty"><p class="err">巡邏資料讀不到。</p><p class="note">可能是後端暫時沒有回應，或網路不通。</p><button id="wReload">再試一次</button></div>`
      : `<p class="note" style="text-align:center;padding:32px 16px;font-size:1.1rem">${watchTry ? `後端忙碌，自動重試中（第 ${watchTry} 次），不用重新整理…` : "巡邏資料載入中，請稍候…（後端忙的時候可能要等到一分鐘）"}</p>`;
    return;
  }
  const since = Date.now() - Number(watchF.days) * 86400000, inRange = watch.items.filter((i) => i.t >= since);
  const chip = (k, v, label) => `<button class="ghost chip${watchF[k] === v ? " on" : ""}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${watchF[k] === v}">${esc(label)}</button>`;
  const pins = watchPinned();
  box.innerHTML = `${watchSummary(inRange)}
    <div id="wUnit"></div>
    <div id="wLocal"></div>
    <div class="wpin${pins.length ? "" : " none"}"><h2>🚨 置頂｜${PIN_HOURS} 小時內的火警、災害</h2>
      ${pins.length ? pins.slice(0, watchShown.pin || PIN_MAX).map((p) => `<a class="witem pin${p.taipei ? " taipei" : ""}" href="${esc(p.i.u)}" target="_blank" rel="noopener noreferrer">
        <span class="wmeta"><span class="wtime">${watchAgo(p.i.t)}</span>${p.local ? `<span class="tag sup">轄區</span>` : p.taipei ? `<span class="tag bad">臺北市</span>` : ""}${p.unv ? `<span class="tag warn" title="還沒有新聞或官方來源佐證">未證實</span>` : ""}<span class="tag" style="background:${WATCH_SRC[p.i.s][1]}">${WATCH_SRC[p.i.s][0]}</span>${p.more ? `<span class="tag">另有 ${p.more} 則相同報導</span>` : ""}<span class="worigin">${esc(p.i.o)}</span></span>
        <span class="wtext">${esc(wShow(p.i))}</span></a>`).join("") + (pins.length > (watchShown.pin || PIN_MAX) ? `<p class="more"><button data-more="pin" class="ghost">再顯示（還有 ${pins.length - (watchShown.pin || PIN_MAX)} 則）</button></p>` : "") : `<p class="note">過去 ${PIN_HOURS} 小時，轄區和臺北市沒有事件，外縣市也沒有新聞報導的火警或災害。</p>`}</div>
    <div class="grid wstats">${Object.entries(WATCH_SRC).map(([k, [name, color]]) => `<div class="card stat${watchF.src === k ? " on" : ""}" style="border-top:10px solid ${color}" data-k="src" data-v="${k}" role="button" tabindex="0" title="只看${name}"><div class="sub">${name}</div><div class="num">${inRange.filter((i) => i.s === k).length}</div>
      <div class="note">${watch.lastFetch[k] ? "更新 " + watchTime(watch.lastFetch[k]) : "還沒有資料"}</div></div>`).join("")}
      <div class="card stat${watchF.loc ? " on" : ""}" style="border-top:10px solid var(--yellow)" data-k="loc" data-v="1" role="button" tabindex="0" title="只看有提到轄區的內容"><div class="sub">轄區相關</div><div class="num">${inRange.filter((i) => i._loc).length}</div><div class="note">${WATCH_RANGE.find(([d]) => String(d) === watchF.days)[1]}內</div></div></div>
    <div class="filters dfilters">
      <div class="chips" role="group" aria-label="時間範圍">${WATCH_RANGE.map(([d, n]) => chip("days", String(d), n)).join("")}</div>
      <div class="chips" role="group" aria-label="來源">${chip("src", "", "全部來源")}${Object.entries(WATCH_SRC).map(([k, [n]]) => chip("src", k, n)).join("")}</div>
      ${watchF.loc ? `<div class="chips"><button class="ghost chip on" data-k="loc" data-v="">只看轄區相關 ✕</button></div>` : ""}
    </div>
    <div class="filters"><input id="wQ" type="search" placeholder="搜尋內容、媒體、帳號" aria-label="搜尋" value="${esc(watchF.q)}"><span class="note" id="wNote"></span>
      <div class="actions"><button class="ghost" id="wReload"${watchState === "loading" ? " disabled" : ""}>${watchState === "loading" ? "更新中…" : "重新整理"}</button><button class="ghost" id="wCsv">匯出 CSV</button></div></div>
    ${watchState === "error" ? `<p class="err">剛才更新失敗，下面是上一次讀到的資料。</p>` : ""}
    <div id="wList"></div>`;
  drawWatchList();
}

function drawWatchList() {
  const el = $("#wList");
  if (!el) return;
  const list = watchFiltered();
  $("#wNote").textContent = `符合 ${list.length} 則`;
  const events = wEvents(list.filter((i) => W_RANK[i._g] !== undefined));
  const html = WATCH_SEC.map((s) => {
    const own = W_EVENT_SEC[s.key] ? events.filter((e) => e.g === s.key) : list.filter((i) => i._g === s.key);
    const n = watchShown[s.key] || WATCH_PAGE, draw = (x) => (x.main ? watchEvent(x) : watchItem(x));
    const body = (own.length ? own.slice(0, n).map(draw).join("")
      + (own.length > n ? `<p class="more"><button data-more="${s.key}" class="ghost">再顯示 ${Math.min(20, own.length - n)} 則（還有 ${own.length - n} 則）</button></p>` : "")
      : `<p class="note wnone">${s.empty || "這段時間沒有。"}</p>`);
    if (s.key === "taiwan") {   // 全台事件：有新聞報導的放上面；只有社群在講的外縣市事件收起來
      const news = own.filter((e) => e.news), social = own.filter((e) => !e.news), n2 = watchShown.taiwanSocial || WATCH_PAGE;
      const head = `<div class="banner wsec" id="wsec-${s.key}" style="background-image:url('img/${s.img}');background-position:${s.pos}"><div class="btitle">${s.name}</div><div class="bdue">${news.length} 件</div></div>`;
      return head + (news.length ? news.slice(0, n).map(draw).join("") + (news.length > n ? `<p class="more"><button data-more="taiwan" class="ghost">再顯示 ${Math.min(20, news.length - n)} 件（還有 ${news.length - n} 件）</button></p>` : "") : `<p class="note wnone">${s.empty}</p>`)
        + (social.length ? `<details class="wfold" data-fold="taiwanSocial"${watchOpen.taiwanSocial ? " open" : ""}><summary class="wsechead">只有社群在講的外縣市事件<span>${social.length} 件</span></summary><p class="note">沒有新聞報導、只在 FB／Threads 出現的事件，常是轉貼、回顧或宣導。</p>${social.slice(0, n2).map(draw).join("")}${social.length > n2 ? `<p class="more"><button data-more="taiwanSocial" class="ghost">再顯示 ${Math.min(20, social.length - n2)} 件（還有 ${social.length - n2} 件）</button></p>` : ""}</details>` : "");
    }
    if (s.fold) return `<details class="wfold" data-fold="${s.key}"${watchOpen[s.key] ? " open" : ""}><summary class="wsechead">${s.name}<span>${own.length} ${W_EVENT_SEC[s.key] ? "件" : "則"}</span></summary><p class="note">${s.note}</p>${body}</details>`;
    const unit = W_EVENT_SEC[s.key] ? "件" : "則";
    const head = s.img ? `<div class="banner wsec" id="wsec-${s.key}" style="background-image:url('img/${s.img}');background-position:${s.pos}"><div class="btitle">${s.name}</div><div class="bdue">${own.length} ${unit}</div></div>`
      : `<h2 class="wsechead" id="wsec-${s.key}">${s.name}<span>${own.length} ${unit}</span></h2>`;
    return head + (s.note ? `<p class="note wnone">${s.note}</p>` : "") + body;
  });
  // 轄區事件放在最上面（犀牛速報下面），其他區照順序排在篩選列下面
  // 在地碎碎唸、轄區事件放在最上面（犀牛速報下面），其他區照順序排在篩選列下面
  const top = { unit: "#wUnit", local: "#wLocal" };
  WATCH_SEC.forEach((s, k) => { if (top[s.key] && $(top[s.key])) $(top[s.key]).innerHTML = html[k]; });
  el.innerHTML = html.filter((_, k) => !top[WATCH_SEC[k].key]).join("");
}

// 匯出目前篩選結果（加 BOM，Excel 開中文才不會亂碼）
function watchCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const tier = Object.fromEntries(WATCH_SEC.map((s) => [s.key, s.name]));
  const rows = [["時間", "來源", "媒體／帳號", "分級", "重大", "轄區", "分類", "內容", "留言提到", "連結"]].concat(watchFiltered().map((i) => [watchTime(i.t), (WATCH_SRC[i.s] || [i.s])[0], i.o, tier[i._g], i._m ? "是" : "", i._loc ? "是" : "", i.c, i.x, i.h || "", i.u]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }));
  a.download = `犀牛巡邏隊_${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "")}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

// 開著這一頁時定時更新；沒有新資料也每分鐘重畫一次，置頂的「幾分鐘前」和 4 小時範圍才會跟著時間走
setInterval(() => {
  if (!$("#wBox") || !watch || watchState === "loading" || document.hidden) return;
  if (Date.now() - watch.at >= WATCH_REFRESH) loadWatch(Math.max(7, Number(watchF.days)));
  else if (document.activeElement && document.activeElement.id !== "wQ") drawWatch();
}, 60000);
