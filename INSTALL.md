# Little AI Helper — OpenRouter Free 1.4.0

1. 在 Chrome 網址列輸入 chrome://extensions/。
2. 開啟「開發人員模式」，按「載入未封裝項目 / Load unpacked」。
3. 選擇這個包含 manifest.json 的資料夾，請保留在固定位置。
4. 在設定頁輸入自己的 OpenRouter API Key：https://openrouter.ai/settings/keys
5. 保留預設 Dots3-Note Preview（free），按 Test OpenRouter connection。
6. 上載文字 PDF / DOCX 履歷，確認解析後的資料。CV 中明確寫出的 Preferences 會一起匯入。舊版已上載的履歷可按 Auto-fill profile & preferences from CV 重新解析。
7. 到 Greenhouse、Lever、Workday、Ashby、大家樂或其他可辨識的求職表格頁打開側邊欄，按 Fill this page with AI；等候進度完成，展開 Debug messages 查看結果。開放式問題仍可單獨按 AI answer。

從舊版本更新：在 chrome://extensions/ 按重新載入，再刷新設定頁，手動改選 Dots3-Note Preview。已儲存履歷、Key 和模型選擇會保留。

更新插件後，求職分頁也要重新載入；側邊欄的 Reload job page 按鈕可協助恢復連線。

此資料夾已完成建置，不需要 Node.js、npm 或開發伺服器。
只會請求免費模型，但 OpenRouter 的分鐘／每日限額與供應情況仍適用。
API Key 未預置，請在設定頁自行輸入。使用 AI 時相關文件內容會傳到 OpenRouter 及模型供應商。
掃描 PDF 不支援 OCR；填寫結果請自行檢查後再提交。
完整已載入表格結構和 CV／個人資料交給 LLM，回傳 JSON 後由本機 JavaScript 填入及檢查。每 60 個待填欄位一個免費請求，每次仍帶完整表格；漏答或選單問題最多再一輪補填。附件、身份證、同意聲明及未知資料保留手動處理。
本版提供 Loading、Stop 與 Debug messages；不會自動提交表格。多步表格會包含已載入的其他步驟作上下文，但只填目前步驟；按 Next 後再按 Fill。

原始專案：https://github.com/ritsth/job-autofill-extension（MIT）
上游 commit：b0836ef4c6b24dfc398cecb5ee13f9334a56391d
模型與 API 核實日期：2026-09-25
