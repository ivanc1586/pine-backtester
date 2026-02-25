# Pine Backtester 部署教學

## 架構概覽

```
前端 (React)  →  Vercel  (免費)
後端 (FastAPI) →  Render  (免費，含 1GB 持久化磁碟)
```

---

## 第一步：上傳到 GitHub

1. 在 GitHub 建立新 repository（例如 `pine-backtester`）
2. 在本機執行：

```bash
cd pine-backtester
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/你的帳號/pine-backtester.git
git push -u origin main
```

---

## 第二步：部署後端到 Render

1. 前往 [https://render.com](https://render.com) 並登入（可用 GitHub 登入）
2. 點擊 **New +** → **Web Service**
3. 選擇你的 GitHub repository `pine-backtester`
4. 填入以下設定：

| 欄位 | 值 |
|------|-----|
| Name | `pine-backtester-api` |
| Root Directory | `backend` |
| Runtime | `Python 3` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Instance Type | `Free` |

5. 點擊 **Advanced** → **Add Disk**：
   - Name: `strategies-data`
   - Mount Path: `/opt/render/project/src/data`
   - Size: `1 GB`

6. 點擊 **Create Web Service**
7. 等待部署完成（約 3-5 分鐘），記下你的後端網址，格式為：
   ```
   https://pine-backtester-api.onrender.com
   ```

8. 在 Render Dashboard → **Environment** 加入環境變數：
   - Key: `ALLOWED_ORIGINS`
   - Value: `https://pine-backtester.vercel.app`（先填這個，等 Vercel 部署完再確認）

---

## 第三步：部署前端到 Vercel

1. 用文字編輯器開啟 `frontend/.env.production`，把後端網址填入：
   ```
   VITE_API_URL=https://pine-backtester-api.onrender.com
   ```
   （替換成你第二步拿到的真實網址）

2. Commit 並 push 這個變更：
   ```bash
   git add frontend/.env.production
   git commit -m "Set production API URL"
   git push
   ```

3. 前往 [https://vercel.com](https://vercel.com) 並登入（可用 GitHub 登入）
4. 點擊 **Add New Project**
5. 選擇你的 GitHub repository `pine-backtester`
6. 填入以下設定：

| 欄位 | 值 |
|------|-----|
| Framework Preset | `Vite` |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

7. 點擊 **Deploy**
8. 等待部署完成，記下你的前端網址，格式為：
   ```
   https://pine-backtester.vercel.app
   ```

---

## 第四步：更新 Render CORS 設定

1. 回到 Render Dashboard → 你的 Service → **Environment**
2. 更新 `ALLOWED_ORIGINS` 的值為你的真實 Vercel 網址：
   ```
   https://pine-backtester-xxx.vercel.app
   ```
3. Render 會自動重新部署

---

## 完成！

打開你的 Vercel 網址即可使用：
```
https://pine-backtester.vercel.app
```

---

## 注意事項

- **Render 免費方案**：閒置 15 分鐘後會休眠，第一次請求需要等待約 30-60 秒喚醒
- **持久化磁碟**：策略資料存在 `/opt/render/project/src/data/strategies.json`，重新部署不會遺失
- **自動部署**：每次 `git push` 到 `main` 分支，Vercel 和 Render 都會自動重新部署

---

## 本機開發

```bash
# 後端
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 前端（另開終端機）
cd frontend
npm install
npm run dev
# 開啟 http://localhost:5173
```
