# 驗證結果 — 2026-09-25

- 上游：ritsth/job-autofill-extension，commit b0836ef4c6b24dfc398cecb5ee13f9334a56391d。
- 版本：1.4.0；Node.js 22.20.0。
- 官方 OpenRouter Models API 及三個免費模型 Endpoints API 已查詢，prompt/completion 價格均為 0，且支援 response_format、reasoning 與 max_tokens。
- npm ci：成功，安裝時報告 0 vulnerabilities。
- npm run lint：通過。
- npm test：46 個測試檔、532 項測試通過；另有 3 項需啟用的實際 API／網站 fixture 測試，預設略過。
- npm run build：TypeScript 檢查及正式建置通過。
- git diff --check：通過。
- 1.2.2 回歸紀錄：以獨立 Chrome for Testing 設定檔載入正式 bundle：成功。
- 1.2.2 回歸紀錄：設定頁、模型選擇儲存、連線測試按鈕通過。
- 1.2.2 移除設定頁 Base cover letter 範本卡片。
- 1.2.2 回歸紀錄：實際建立並上載合成的文字 PDF，透過打包的 PDF worker 抽取文字，經背景 AI 流程匯入個人資料：通過。
- 1.2.2 回歸紀錄：快速更改 Key 後立即上載 PDF 的回歸情境：通過。
- 1.2.2 回歸紀錄：Greenhouse 模擬頁的姓名／Email 自動填寫與 AI answer 填入：通過。
- 1.2.2 回歸紀錄：所有測試 AI 請求均使用所選免費模型與 max_price=0；預設沒有背景資格掃描請求。
- 1.2.2 回歸紀錄：Chrome 介面未出現 page errors；正式 manifest 沒有上游 OAuth、identity 權限或 publisher key。

## 1.4.0 完整表格結構 → LLM JSON → 本機 JavaScript

- 每個 AI 請求都帶完整已載入表格的清理 HTML、全部欄位定義、CV／個人資料及職位文字。保留問題、表格列、段落、分組、選項及已載入的隱藏步驟；移除 script、事件屬性、隱藏 token 和欄位已有輸入值。單次待答欄位最多 60 個，超過則分批，但每批仍有整份表格上下文。
- LLM 只回傳 JSON 欄位 ID／答案／理由。本機 JavaScript 僅對本機已捕捉的欄位寫入，不執行 AI 程式碼、不接收 AI selector。最後重新讀取值和格式；漏答、選項及網站重設值的問題最多一輪補填。
- 修正 NTK 的「As shown on HKID/Passport」提示誤擋姓名和 Email。新增中文表格的欄名、工作／學歷行列及日期方向抽取，以及 ASP.NET 更新後重綁已替換的欄位。
- 國碼元件先處理，再核對完整國際電話前綴後輸入本地號碼；若國碼不符或未能驗證則略過。涵蓋獨立下拉國碼、8 位長度限制和填後國碼被改動的回歸測試。
- 無明確資料時，稱謂／性別、國籍和離職原因會留空；模型編出的中文名會被拒絕。這些檢查不能取代完整答案的人工事實核對。
- 完整流程測試確認 61 個待填欄位分兩個請求、每次仍傳 64 個欄位及完整結構，保留已有值，略過聲明與隱藏步驟，不提交表格。
- lint、TypeScript、build 和 diff 格式檢查通過；532 項一般測試通過。

### 真實 OpenRouter ＋公開表格 HTML 測試

使用虛構 Demo CV 和實際免費 OpenRouter 回覆，把網站公開 HTML 載入 jsdom 測試環境後抽取、回填及讀回。**這不是在使用者 Chrome 的動態網站上完整重跑。** ASP.NET 伺服器更新、真實國碼 widget 和網站第三方驗證仍需在 Chrome 測試；其部分行為另有本機元件測試。

| 網站 | 抽取範圍 | 本次結果 |
|---|---|---|
| 新華旅遊 | 70 個欄位群組，完整中文表格 | 28 個欄位成功寫入並讀回；包含英文全名、聯絡資料、出生年、薪酬期間、兩筆工作、學歷及語言。缺少的中文名、性別、完整出生日期及離職原因留白；2027 畢業年不在網站選項，未填入。 |
| NTK | 114 個已載入欄位群組，13 個在第一步可見 | 第一頁 7 個欄位成功寫入並讀回，包含 Chan、Alex Chun Hei、Alex、手機、Email、地址和職位選項。101 個隱藏步驟欄位只作上下文。稱謂、國籍、中文名和完整出生日期沒有足夠事實，留白。 |
| Lee & Poon | 驗證頁阻擋 | HTTP 403／瀏覽器安全驗證頁；本輪沒有取得可測試表格，未宣稱通過。 |

上述數字只代表成功寫入／讀回，不是答案正確率；新華旅遊的多筆工作排序、NTK 的職位意向、薪酬等仍要核對。本輪實際 API 測試 2 項通過，Lee & Poon 1 項略過。新版部署資料夾已更新，但本輪沒有操作使用者 Chrome 重新載入插件或提交申請。

## 1.3.1 Preferences 匯入修正

- 根因：舊 RESUME_PARSE_SYSTEM 沒有 preferences 欄位；ParsedResume 和 Options 匯入流程也未接收／儲存該區塊。
- 新增 workAuthorization、requiresSponsorship、salaryExpectation 三項。只從 CV 明確陳述抽取，不依居住地推論工作權或簽證；期望薪金保留幣別、月薪／時薪和全職／兼職條件。
- 缺少欄位或空白不會清除既有偏好。簽證 unknown 留空；明確 false 正規化為 No。忽略模型額外輸出的性別等非本次偏好欄位；匯入等候期間手動更改的偏好優先。
- 設定頁按鈕改為 Auto-fill profile & preferences from CV；結果顯示找到的偏好數量。移除解析失敗時輸出原始履歷回應的 console 記錄。
- 新增 6 項回歸測試；44 個測試檔、522 項測試、lint 及正式 build 全部通過。
- 在使用者 Chrome 載入 1.3.1 並上載最新一頁 Demo PDF，使用真實 OpenRouter 回覆：Found 3 preference(s)。工作資格為 Hong Kong permanent resident；Requires sponsorship 為 No；Expected salary 保留 HKD 20,000/month full-time 與 HKD 80/hour part-time or internship。設定頁重新整理後三項資料仍存在。沒有手動代填這三項結果。

## 1.3.0 整份表格 AI 填寫

- Fill this page with AI：在本機抽取欄位 ID、標籤、類型、選項及提示，與 CV／個人資料及目前職位文字一起送到 OpenRouter；不傳整份 HTML，不執行模型產生的 JavaScript。
- 背景服務只接受受控的 JSON 欄位／答案。未知 ID、重複 ID、錯誤 JSON、無效型別及被保護欄位均會被拒絕；不接受 AI 提供的 selector 或程式碼。
- 支援文字、數字、日期、原生 select、radio、checkbox、React-select 與 Select2；以本機捕捉的欄位逐項填入並檢查值有沒有保留。依賴選單於填寫時重新讀取選項。
- 側邊欄有 Loading、階段進度、Stop 及逐項 Debug messages；既有值及等待 AI 期間使用者的新輸入會保留。
- 不送出求職申請，不按下一頁，不勾選同意聲明、不填身份證、不處理 CAPTCHA 或自動上載附件。未知過往申請及員工親友資料會留白。
- 44 個測試檔／516 項測試、lint、TypeScript 及正式 build 全部通過；涵蓋 React 自訂選項、隱藏驗證欄位、連動地區、多選格式、包裝後勾選框、使用者編輯、取消、格式拒絕及無程式碼執行。
- 新製作兩頁 Demo-HK-Student-CV.pdf，以 Alex Chun Hei Chan 為虛構香港大學生；已 render 兩頁及目視檢查。第二頁提供語言、畢業年份、工作類型、availability 等明確測試事實。
- 已在使用者 Chrome 上載該 PDF，實際經本機 PDF worker 抽取文字。以下表格測試使用已設定的 Dots3-Note Preview 免費模型及真實 OpenRouter 回覆。

填寫數為本次成功寫入且頁面保留的欄位群組數；radio／checkbox 群組各算一項。分母包含附件、聲明及 CV 未提供資料的欄位。AI 答案仍須逐項人工核對，成功寫入不等於內容已通過事實審核。

| 實際網站 | 成功填入 / 偵測欄位群組 | 留待人工處理 |
|---|---:|---|
| Lalamove / Lever — Global Trainee Program 2027 | 11 / 19 | 5 個未提供的社交連結、CV 附件、2 個聲明 |
| CASETiFY / Greenhouse — Marketing Intern | 20 / 32 | 2 個未配對的自訂選單（Location City、職位來源）、2 個附件、同意聲明；其餘為未提供的社交／過往申請／員工親友資料及不適用的 Others |
| 大家樂 — 二廚 | 16 / 18 | HKID、CV 附件 |

- Lever 包含完整姓名、聯絡資料、現職公司、畢業年、語言、遷移、入職及期望薪金。
- Greenhouse 包含香港電話區號與格式化電話、學校、學位、學科、教育年份、全職／兼職意向、語言、香港居住及簽證選項。首次不匹配的自訂選單會讀取最新選項，最多追加一次 AI 請求；本次兩個選單補填後仍需手動選擇。
- 大家樂包含 Kowloon → Sham Shui Po 連動地區、全職及兼職多選、工作經驗、薪酬、可上班日期、其他品牌意向與求職來源。沒有按 Submit。
- 內容覆核仍有必要：Greenhouse 的 First Name 實測回填 Alex，未完整保留 CV 的其他 given names；開始日期也需按全職／兼職意向核對。大家樂沒有標示薪酬週期的欄位，AI 使用了 CV 的時薪值，應自行確認網站要時薪還是月薪。
- 已修正電話顯示自動加空格時被誤判失敗、React 下拉選單首次非同步載入，以及大家樂包裝後 checkbox 無法識別選項的問題。
- 這三輪測試皆在使用者 Chrome 的獨立測試分頁中執行，使用虛構 CV；沒有提交申請。最新版 1.3.0 已在 Chrome 重新載入。原本三個求職分頁沒有重新整理或清除資料。

## 1.2.4 介面精簡

- lint、42 個測試檔／500 項測試及正式 build 全部通過。
- 正式 JavaScript bundle 已確認沒有浮動 badge、資格掃描或文件產生入口。
- 已在使用者 Chrome 載入 1.2.4，以獨立 Lever 求職分頁確認沒有浮動提示、文件產生器及相關開關；Fill this page 可按，欄位旁的 AI answer 保留。
- 測試分頁已關閉，已返回原本求職分頁；既有姓名、Email、電話及公司欄位保留，舊浮動提示已消失。原本表格沒有重新載入，沒有送出申請。
- 移除側邊欄求職信／客製履歷產生器、公司／職位輸入欄及三個相關開關。
- 移除頁面浮動資格提示的啟動流程，舊 scanEnabled=true 設定也不會再啟動。
- 背景服務只接受履歷匯入及 AI answer，不再處理資格掃描或文件產生請求。
- 移除設定頁的 badge 網站名單；保留 PDF 匯入、Fill this page、AI answer 及 Save this job。

## 1.2.3 Fill this page 修正

- 在使用者 Chrome 中看到 Lever 恢復可按、Greenhouse 起初停用；直接查詢兩個分頁的 PAGE_INFO 後，均回報 supported=true。
- 舊側邊欄把連線失敗與不支援網站都設為 supported=false；已分開處理，加入有界重試、PAGE_READY 通知、舊分頁回覆失效檢查及 Reload job page 按鈕。
- 加入 5 個連線測試：尚未載入、空回覆、真正不支援、更新後無接收者、無限等待。
- 大家樂表格依實際公開 HTML 欄位名稱加入專用填寫；新增路徑／主機限制及資料填寫測試，涵蓋保留既有值、香港電話前綴及不推測出生年份／身份證／過往薪金。
- 本輪没有使用真實履歷進行外部填寫，也沒有送出求職申請。
- 已在使用者 Chrome 重新載入 1.2.3；Lever、Greenhouse、大家樂三個實際分頁的 Fill this page 按鈕均顯示為可按。
- 已驗證更新後舊分頁顯示 Reload job page，按下後頁面重新連接，Fill 按鈕恢復。
- 本輪真實瀏覽器驗證涵蓋辨識、連線恢復及按鈕啟用；未按 Fill 將使用者檔案寫入真實網站，填寫行為以自動化測試驗證。

## 2026-09-25 真實 OpenRouter API 實測

使用使用者提供的 Key，只傳送測試文字／虛構履歷；沒有傳送真實履歷。Key 沒有寫入原始碼、部署資料夾或報告。

| 項目 | 結果 |
|---|---|
| Key 驗證 | HTTP 200，有效；is_free_tier=true |
| 測試開始時額度 | 0 / 50 次已用，50 次剩餘，usage=0 |
| Gemma 4 31B :free | HTTP 429；Google AI Studio 上游共享供應池限流 |
| Gemma 4 26B A4B :free | HTTP 429；Google AI Studio 上游共享供應池限流 |
| Qwen 3.8 27B :free（候選） | HTTP 429；ModelRun 上游共享供應池限流，未加入插件 |
| Dots3-Note Preview :free — 連線 | HTTP 200，回覆 OK，27 tokens，usage.cost=0 |
| Dots3-Note Preview :free — 合成履歷 JSON | HTTP 200，正確抽取中文姓名、Email、香港及 3 個技能，116 tokens，usage.cost=0 |
| 測試後費用 | key API 的 usage / usage_daily 均為 0 |

實測日期當天，Dots3 兩個請求均成功。1.2.1 將它加入允許清單並作新安裝預設，既有設定仍保留。已修正 429 提示，分辨供應池容量與帳戶每日額度，未知原因不再斷言額度用完。推論請求全部加上 prompt/completion/request 價格上限 0；沒有嘗試付費路線。

## 驗證界線

早期 1.2.2 的介面回歸使用受控 AI 回應；1.3.0 上表則使用真實求職網站、正式擴充功能 bundle、使用者已設定的 OpenRouter Key 及 Dots3 免費模型，涵蓋本機 PDF 抽取至整份表格填寫。沒有提交求職申請。

這是單次具體頁面與虛構 CV 的相容性驗證，不是所有網站／所有履歷的保證。免費模型輸出和網站選項可變；答案正確性、全名分拆、日期及薪酬單位仍需要人工覆核。自訂元件、跨來源 iframe、封閉 Shadow DOM、多步表格和掃描圖片 PDF 仍有限制。1.4.0 最多讀取 400 個欄位群組、100,000 字元清理表格 HTML，超限明確停止。

OpenRouter 早期兩個獨立成功測試請求均回傳 usage.cost=0；本次表格請求同樣使用 :free ID 和 prompt/completion/request 價格上限 0，沒有付費 fallback。免費服務日後可能限流或下架。Debug 訊息只保留在目前頁面記憶體中；重新整理頁面會清除該頁測試記錄。
