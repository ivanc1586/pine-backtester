# FIXES.md — 回歸防護基準
> 每次修改任何 page 前，必須核對本文件。
> 每次新增修復後，必須更新本文件。

---

## 修改原則

1. **外科手術式修改 (Surgical Edit)**：優先用 `str_replace` 修改單一片段，禁止整檔重寫。
2. **推送後必須驗證**：Push 之後立刻 GET 目標檔案，核對關鍵字清單（見各 file 的 MUST / MUST NOT）。
3. **修改前先 grep 影響範圍**：改動前先搜尋相關 function / state / JSX，確認只改目標區塊。

---

## MarketsPage.tsx — 目前版本 v3.0.0 (2026-03-03)

### 已修復問題

| # | 問題描述 | 根因 | 修復方式 |
|---|----------|------|----------|
| M1 | 期貨卡片（ES/NQ/CL/GC）出現在幣對列表 | `FUTURES_SYMBOLS` 陣列 + 期貨 state + 期貨 JSX 被重新加入 | 完全移除，不得存在 |
| M2 | 主流幣對卡片只顯示 4 個 | `cryptoTickers.slice(0, 4)` 截斷 | 移除 slice，顯示全部 16 個 |
| M3 | 貴金屬（XAU/XAG）價格/K線異常 | REST 和 WS 使用 spot endpoint，但 XAU/XAG 只在 fapi | 判斷 symbol 後走 fapi.binance.com |
| M4 | 點幣對卡片沒切換到對應 K線 | 跳轉只寫 `chart_symbol`，漏寫 `chart_market` | 卡片和表格按鈕都同時寫兩個 localStorage key |

### MUST NOT 包含（每次推送後驗證）

```
FUTURES_SYMBOLS
futuresTickers
ES=F
NQ=F
CL=F
GC=F
slice(0, 4)
height: 44       ← SparkLine 高度必須是 72，不是 44
```

### MUST 包含（每次推送後驗證）

```
fapi.binance.com     ← 貴金屬 REST endpoint
fapi-stream          ← 貴金屬 WS endpoint (或等效 fapi ws)
chart_market         ← localStorage key，卡片跳轉時必須寫入
v3.0.0               ← 版本號，確認是最新版
```

### 關鍵程式碼區塊（不能動）

```typescript
// 貴金屬判斷 — 決定用 spot 或 fapi
const isMetal = (s: string) => s === 'XAUUSDT' || s === 'XAGUSDT'
const baseUrl = (s: string) =>
  isMetal(s)
    ? 'https://fapi.binance.com/fapi/v1'
    : 'https://api.binance.com/api/v3'

// 卡片點擊跳轉 — 必須同時寫兩個 key
localStorage.setItem('chart_symbol', symbol)
localStorage.setItem('chart_market', isMetal(symbol) ? 'futures' : 'spot')
navigate('/chart')
```

---

## ChartPage.tsx — 目前版本 v10

### 已修復問題

| # | 問題描述 | 根因 | 修復方式 |
|---|----------|------|----------|
| C1 | 搜尋找不到貴金屬 | `POPULAR_SYMBOLS` 沒有 XAUUSDT/XAGUSDT | 補入兩個貴金屬 |
| C2 | 從 MarketsPage 跳來時沒切換 market type | 只讀 `chart_symbol`，沒讀 `chart_market` | mount 時同時讀兩個 key，呼叫 `switchPair` |

### MUST 包含

```
XAUUSDT              ← POPULAR_SYMBOLS 內
XAGUSDT              ← POPULAR_SYMBOLS 內
chart_market         ← mount 時讀取的 localStorage key
switchPair           ← 搜尋選中貴金屬時，自動切換為 futures
```

### MUST NOT 包含

```
// 無特別限制，但不能移除 POPULAR_SYMBOLS 中的 XAUUSDT/XAGUSDT
```

---

## HomePage.tsx — 目前版本 v2.0.0 (2026-03-01)

### 已修復問題

| # | 問題描述 | 根因 | 修復方式 |
|---|----------|------|----------|
| H1 | 策略存檔後 goToReport 失效 | 使用 props 傳遞，改用 sessionStorage (30min TTL) | sessionStorage key: `report_strategy_id` |
| H2 | 貴金屬 mini chart 異常 | 同 M3，spot endpoint | 判斷 symbol 走 fapi |
| H3 | 幣對卡片點擊沒切換 K線 market | 同 M4 | 寫 `chart_symbol` + `chart_market` |

### MUST 包含

```
chart_market         ← localStorage key，首頁幣對卡片跳轉時寫入
fapi.binance.com     ← 貴金屬 REST endpoint
sessionStorage       ← goToReport 使用 sessionStorage
```

---

## 推送驗證 SOP

每次推送任何 page 後，執行以下確認：

```
1. GET frontend/src/pages/<FileName>.tsx from GitHub
2. 核對版本號（file header 的 vX.X.X）
3. 逐一比對該檔案的 MUST NOT 列表（確認不存在）
4. 逐一比對該檔案的 MUST 列表（確認存在）
5. 比對檔案大小是否合理（不應比上一版小太多）
```

---

## 變更記錄

| 日期 | 檔案 | 版本 | 變更摘要 |
|------|------|------|----------|
| 2026-03-03 | MarketsPage.tsx | v3.0.0 | 移除期貨區塊；顯示全 16 幣對；貴金屬走 fapi；卡片寫入 chart_market |
| 2026-03-03 | ChartPage.tsx | v10 | POPULAR_SYMBOLS 加入 XAUUSDT/XAGUSDT；mount 讀 chart_market |
| 2026-03-01 | HomePage.tsx | v2.0.0 | goToReport 改 sessionStorage；貴金屬 fapi；卡片寫 chart_market |
