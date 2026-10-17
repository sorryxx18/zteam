# 跨年勤務獨立測試頁

公開測試網址：https://sorryxx18.github.io/zteam/newyear/

僅以隱藏路徑提供預覽，不在 Z-TEAM 首頁或活動看板增加入口，也不改原看板。

## 已接入
- 桌機勤務主圖＋側欄／手機底部資訊面板。
- 官方路口 HLS 串流；搜尋外框內全部可取得鏡頭，選取後可看即時影像、放大及重連。
- 真實車輛定位唯讀，沿用既有取樣／斷線／品質／過期與讀取失敗規則。
- 地圖選取標示；勤務更新時間明確以臺北時區解析。

## 本測試版尚未啟用／尚缺
- `data.js` 的 `preview:true`：勤務預設待命展示，尚未啟用幕僚寫入或多人儲存；不呼叫尚未部署的勤務 API。更正按鈕停用。
- 正式管制及進駐名冊待提供，空陣列不代表無管制／無部署，不放假單位或假人力。
- 監視器搜尋外框 [[25.028,121.555],[25.046,121.576]] 待核對，非正式管制邊界。
- 本年度101官方煙火直播尚未接入，不以舊影片取代。
- 原車輛3D僅提供輔助預覽連結，不宣稱勤務圖層都已整合。
- 後端本機 Ops.gs 尚未隨本次測試頁部署；不動登入、Properties、triggers 或既有業務。

## 驗證
`node --test newyear/tests/ops-core.test.cjs`
`node newyear/tests/ops-browser.mjs`：隔離合成資料驗證，不寫正式後端；測試時才暫關 preview 以驗證未來權限流程。
`node newyear/tests/ops-live.mjs`：唯讀真實定位與三處官方影像播放檢查。
`OPS_TEST_URL=https://sorryxx18.github.io/zteam/newyear/ node newyear/tests/ops-browser.mjs`：公開資產跑同一套隔離測試。
