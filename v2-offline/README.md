# PokéCatch 孵蛋色違預測 v2.0（完全離線獨立網頁版）

零依賴、零網路請求、免編譯的純前端離線預測工具，支援手機與電腦瀏覽器 RWD 排版，可直接雙擊開啟或部署至 GitHub Pages。

## 檔案結構

- `index.html`：主頁面（深色質感 + 手機優先 RWD 介面）
- `styles.css`：純原生 CSS 樣式（含閃金色系標籤與 2×2 摘要卡）
- `predictor.js`：核心孵蛋雜湊運算、色違檔位判定與親代欄位抽籤純函式模組
- `app.js`：互動邏輯與本機 `localStorage` 自動持久化
- `verify.test.js`：基準資料自動化驗證測試腳本

## 本機直接使用

1. 直接雙擊開啟 `v2-offline/index.html`（使用 `file://` 協定即可正常運作，無需啟動任何本機伺服器）。
2. 輸入你的訓練家 `Seed`（格式 `since:id`）並點擊「儲存」鎖定。
3. 設定目前的孵蛋數 `k`、靛莓果狀態與培育屋 1～3 隻親代，產蛋時按 `+1 產蛋` 即可即時追蹤。

## 部署至 GitHub Pages

1. 將專案推送至 GitHub 倉庫。
2. 進入倉庫 **Settings → Pages**。
3. **Source** 選擇 **Deploy from a branch**，分支選擇目標分支（如 `main` 或 `v2-offline`），目錄選擇 `/ (root)` 後點擊 **Save**。
4. 部署完成後，直接造訪：
   `https://<你的帳號>.github.io/<倉庫名稱>/v2-offline/`

## 執行核心演算法驗證（需 Node.js）

```bash
node v2-offline/verify.test.js
```

## 安全與隱私邊界

- 不含 `manifest.json`、Content Script、Shadow DOM 或 `MutationObserver`。
- 不發送任何 `fetch` / `XMLHttpRequest` / `WebSocket` 網路請求，不連線遊戲伺服器。
- 所有設定（Seed、k 值、親代配置）僅儲存於本離線網頁自己的 `localStorage`（key: `pokecatch_v2_offline_state_v1`）。
