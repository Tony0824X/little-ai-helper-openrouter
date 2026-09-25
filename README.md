# Little AI Helper — OpenRouter Free

這是 [ritsth/job-autofill-extension](https://github.com/ritsth/job-autofill-extension) 的本機修改版本，保留 MIT 授權。
上游基準 commit：`b0836ef4c6b24dfc398cecb5ee13f9334a56391d`。版本：1.4.0。

1.4.0：整份已載入表格的清理 HTML＋所有欄位定義＋CV／個人資料一起送給 LLM，再用回傳 JSON 由本機 JavaScript 填入。包含分組、表格列及其他已載入步驟；修正 HKID 提示誤擋姓名、中文表格標籤與獨立電話國碼。填後重新核對值及格式，對漏答／選單問題最多補填一次。

1.3.1：修正履歷匯入漏掉 Preferences，加入工作資格、簽證贊助及期望薪金抽取；缺少資料不會清空既有偏好，等待 AI 期間的新偏好輸入會保留。匯入結果顯示找到的偏好數量。

1.3.0：加入整份表格 AI 填寫、跨網站欄位抽取、選單／單選／多選支援，以及 Loading、停止和 Debug 訊息。

1.2.4：移除浮動資格提示、資格掃描、求職信／客製履歷產生器及相關設定。

1.2.3：修正側邊欄連線／切換分頁後 Fill this page 停用的問題，加入重試、重新載入提示及大家樂基本欄位支援。1.2.2 已移除 Base cover letter 範本編輯區塊。

## 安裝已建置版本

1. 將 `little-ai-helper-openrouter` 資料夾放在固定位置；載入後不要刪除或移動。
2. Chrome 網址列輸入 `chrome://extensions/`，開啟右上方「開發人員模式」。
3. 選擇「載入未封裝項目 / Load unpacked」，選取含有 `manifest.json` 的 `little-ai-helper-openrouter` 資料夾。
4. 設定頁會開啟。在 **OpenRouter API key** 填入自己的 Key，可於 https://openrouter.ai/settings/keys 建立。
5. 保留預設 **Dots3-Note Preview — free · recommended**，按 **Test OpenRouter connection**。這會用一個免費模型請求，只傳送測試文字，不傳送履歷。
6. 等候「Saved」，上載 PDF / DOCX 履歷。插件會先在本機抽取文字，再交由所選 OpenRouter 模型整理個人資料。檢查並修正匯入結果；CV 有明確寫出的 Preferences 亦會匯入。從舊版更新後可按 Auto-fill profile & preferences from CV 重新解析，不必重新選檔。
7. 開啟 Greenhouse、Lever、Workday、Ashby 或大家樂求職表格，按擴充功能圖示打開側邊欄，選 **Fill this page with AI**。插件讀取完整已載入表格結構、所有欄位定義、選項及職位文字，與 CV／個人資料一起交給 OpenRouter；收到 JSON 答案後由插件 JavaScript 逐欄填入，再核對網站是否保留及接受格式。可展開 Debug messages 檢查結果。提交前自行檢查。

## Fill this page 的連線與支援

- 更新插件後，已開啟的求職分頁也要重新載入。若側邊欄未能連接，會顯示 **Reload job page**；原本把連線失敗當成不支援網站的提示已修正。
- 側邊欄會短暫重試頁面辨識，頁面程式就緒時重新辨識，並忽略舊分頁的延遲回覆。
- AI 可處理文字、數字、原生下拉選單、單選、多選及部分自訂 combobox；先讀取選項再配對，連動選單會於填寫時再次確認。
- 支援常見 ATS 及可辨識的通用表格；自訂 widgets、跨來源 iframe、封閉 Shadow DOM 或多步流程未必全部可處理。讀取當前文件中已載入的所有步驟作上下文，只填目前顯示的步驟。下一步按 Next 後再按 Fill；不會自動翻頁，也不能讀取尚未載入的步驟。
- 既有文字／選項會盡量保留，AI 等候期間的新輸入也會保留。原生選單的初始預設選項可依 CV 更改。
- 未知事實會留空；身份證、檔案上載、CAPTCHA 和同意聲明保留手動處理，不會自動送出申請。
- Debug 區分當前步驟、送出上下文及其他步驟的欄位數；「已檢查」只指值保留及格式，不等於事實審核。顯示每個欄位成功或略過的原因，不顯示 API Key 或完整答案。免費端點超時／限流會直接顯示錯誤，不會靜默改用付費模型。

## 模型與 API

已在 2026-09-25 核對官方 Models API 與各模型 Endpoints API：

| 用途 | 模型 ID | Input / Output token 價格 | Context | JSON 輸出 |
|---|---|---|---|---|
| 預設（實測成功） | `dots-studio/dots-3-note-preview:free` | 0 / 0 | 512,000 tokens | `response_format: {"type":"json_object"}` |
| 替代 | `google/gemma-4-31b-it:free` | 0 / 0 | 262,144 tokens | `response_format: {"type":"json_object"}` |
| 較輕量替代 | `google/gemma-4-26b-a4b-it:free` | 0 / 0 | 262,144 tokens | 同上 |

1.2.1 改以 Dots3-Note Preview 為預設：已用真實 OpenRouter Key 成功測試一般連線與包含繁體中文的合成履歷 JSON 抽取，兩次 HTTP 200、usage.cost 均為 0。Gemma 兩個免費路線當時均回報 Google AI Studio 的共享供應池限流（HTTP 429），而帳戶仍有免費額度。這是當下可用性與簡單格式測試，並非全面回答品質評測；免費端點未來仍可能限流或下架。

**從 1.2.0 更新：** 在 `chrome://extensions/` 按此插件的重新載入，再刷新設定頁，將 Free model 手動改為 **Dots3-Note Preview**。舊模型選擇與已儲存履歷會保留。

- Endpoint：`POST https://openrouter.ai/api/v1/chat/completions`
- 驗證：`Authorization: Bearer <你的 OpenRouter Key>`
- 格式：`model`、`messages`（system/user）、`max_tokens`；以 SSE streaming 接收 `choices[].delta.content`。
- 履歷解析及整份表格填寫會開啟 JSON mode；一般問答使用文字輸出。預設關閉 reasoning，將輸出額度留給答案。
- 所有 AI 功能都使用設定頁所選模型，包括履歷解析、整份表格填寫及 AI answer。
- 僅允許上述免費 model ID，並送出 `provider.max_price = {prompt:0, completion:0, request:0}`。不自動改用付費模型，也沒有啟用付費 PDF 或搜尋插件。
- 免費額度、供應情況及模型存續由 OpenRouter 決定。429 會分辨已知的共享供應池限流及每日帳戶額度；只有供應池忙碌時，切換模型才可能有幫助。這不是無限量服務。
- 不需要自架後端或 Google 登入；原作者的 OAuth client、extension key 與 Cloud Run 預設服務已從此版本移除。

官方來源：
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/api/v1/models/dots-studio/dots-3-note-preview:free/endpoints
- https://openrouter.ai/dots-studio/dots-3-note-preview:free
- https://openrouter.ai/api/v1/models/google/gemma-4-31b-it:free/endpoints
- https://openrouter.ai/api/v1/models/google/gemma-4-26b-a4b-it:free/endpoints
- https://openrouter.ai/google/gemma-4-31b-it:free
- https://openrouter.ai/docs/api/reference/overview
- https://openrouter.ai/docs/guides/routing/provider-selection#max-price
- https://openrouter.ai/docs/api/reference/limits

## 使用範圍與資料

- 支援能選取文字的 PDF；掃描圖片 PDF 沒有 OCR，請先轉成文字 PDF。
- 「Fill this page with AI」傳送完整表格的清理 HTML（保留文字／分組／表格，移除 script、執行屬性、隱藏 token 及已有輸入值）和全部欄位定義。每 60 個待填欄位一個 AI 請求，每次仍帶完整表格；漏答或選單問題最多再一輪補填。模型回傳 JSON 欄位 ID 和答案，不回傳或執行 AI JavaScript。最多 400 欄位群組、100,000 字元清理 HTML；超限會明確停止，不靜默截斷。AI answer 仍可逐題使用。
- 已移除浮動資格提示、背景資格掃描、求職信及客製履歷產生器；不會因舊版設定而重新開啟。
- 個人資料與 API Key 保存在 `chrome.storage.local`。使用 AI 時，相關履歷、額外文件與問題文字會傳到 OpenRouter 及其選用的模型供應商；這並非完全離線。
- API Key 不會寫入部署檔案，也不會放在 URL 中。上游 Google / proxy 的舊 Key 不會自動轉送到 OpenRouter。
- 複雜的求職網站控件仍可能需要手動修正；不會自動按最終 Submit。

## 從原始碼建置

使用 Node.js 22.13 以上（本次使用 22.20.0）。

```sh
npm ci
npm run lint
npm test
npm run build
```

在 Chrome 載入 `dist/` 即可。正式版本不需要開發伺服器。`server/` 和舊供應商模組保留作上游參考，沒有接入這個版本的介面或正式 bundle。

上游原始文件保留於 `README.upstream.md`、`PRIVACY.upstream.md`。本版本資料處理方式以 `PRIVACY.md` 為準。
