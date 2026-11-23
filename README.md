# PokéCatch 本地孵蛋色違預測（Chrome / Edge MV3）

零依賴、免編譯、純本地端運行的 Manifest V3 擴充功能，專用於 PokéCatch 的孵蛋色違序列預測與色違蛋金框提示。

## 載入步驟（Chrome / Edge）

1. 開啟瀏覽器擴充功能管理頁面：
   - **Chrome**：網址列輸入 `chrome://extensions/`
   - **Edge**：網址列輸入 `edge://extensions/`
2. 開啟右上角（或左側）的 **開發人員模式（Developer mode）**。
3. 點擊 **載入未封裝項目（Load unpacked）**。
4. 選擇本專案資料夾（包含 `manifest.json` 與 `content.js` 的目錄）。
5. 重新整理 PokéCatch 遊戲頁面即可在右下角看到浮動面板：
   - `https://pokecatch-online.netlify.app/*`
   - `https://pokecatch-online.pages.dev/*`

## 功能摘要

- **四層色違序列預測**：即時掃描後續 `k` 序列在「一般（1/512）」、「一般+果（1/256）」、「色違親代（1/16）」、「親代+果（1/8）」條件下的命中位置與 `roll` 值。
- **持有蛋鑑定與 DOM 金框提示**：對目前存檔中的每顆蛋執行本地判定，色違蛋會在面板與遊戲畫面的蛋卡片上自動加上動態金色邊框與標籤。
- **培育屋親代檢查**：自動偵測 `NO_EGG_IDS` 不可生蛋品種、雙百變怪（`#132`）及色違親代／果實狀態。
- **可收合與拖曳面板**：透過 `chrome.storage.local` 記住收合狀態、位置與篩選偏好。

## 安全邊界

- 僅宣告 `"storage"` 權限，運行於預設 Isolated World。
- 僅唯讀 `localStorage.getItem('gachamon-save-v1')`，不寫入存檔、不模擬點擊、不發送任何網路請求。
