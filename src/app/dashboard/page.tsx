"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BarChart3, Zap, History, Settings, PlusCircle,
  TrendingUp, TrendingDown, Activity, LayoutDashboard,
  RefreshCw, ChevronRight
} from "lucide-react";
import OptimizePanel from "@/components/OptimizePanel";
import ResultsPanel from "@/components/ResultsPanel";

const NAV_ITEMS = [
  { icon: <LayoutDashboard className="w-5 h-5" />, label: "市場總覽", id: "market" },
  { icon: <Zap className="w-5 h-5" />, label: "新增優化", id: "optimize" },
  { icon: <History className="w-5 h-5" />, label: "歷史記錄", id: "history" },
  { icon: <BarChart3 className="w-5 h-5" />, label: "績效分析", id: "analytics" },
  { icon: <Settings className="w-5 h-5" />, label: "設定", id: "settings" },
];

const MOCK_HISTORY = [
  { id: 1, name: "BTC RSI 策略", symbol: "BTC/USDT", timeframe: "4h", status: "completed", sharpe: 2.34, winrate: 67.3, profit: 142.5, date: "2026-02-20" },
  { id: 2, name: "ETH 布林通道", symbol: "ETH/USDT", timeframe: "1h", status: "completed", sharpe: 1.87, winrate: 61.2, profit: 89.3, date: "2026-02-18" },
  { id: 3, name: "SOL 突破策略", symbol: "SOL/USDT", timeframe: "15m", status: "running", sharpe: null, winrate: null, profit: null, date: "2026-02-23" },
];

type Asset = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  type: string;
};

const ASSETS_DEFAULT: Asset[] = [
  { symbol: "BTC/USDT", name: "比特幣", price: 66353.14, change: -1.97, type: "crypto" },
  { symbol: "ETH/USDT", name: "以太坊", price: 1929.38, change: -1.01, type: "crypto" },
  { symbol: "SOL/USDT", name: "Solana", price: 80.93, change: -3.40, type: "crypto" },
  { symbol: "BNB/USDT", name: "Binance Coin", price: 611.63, change: -1.14, type: "crypto" },
  { symbol: "GC", name: "黃金期貨", price: 5173, change: 1.80, type: "futures" },
  { symbol: "NQ", name: "納指期貨", price: 24930, change: -0.55, type: "futures" },
  { symbol: "ES", name: "標普期貨", price: 6897, change: -0.39, type: "futures" },
  { symbol: "SIL", name: "白銀期貨", price: 86, change: 4.71, type: "futures" },
];

function MarketOverview() {
  const [assets, setAssets] = useState<Asset[]>(ASSETS_DEFAULT);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prices");
      if (res.ok) {
        const data = await res.json();
        if (data.prices) setAssets(data.prices);
        setUpdatedAt(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, []);

  const cryptos = assets.filter((a) => a.type === "crypto");
  const futures = assets.filter((a) => a.type === "futures");

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">市場即時報價</h1>
          <p className="text-slate-400 mt-1">
            加密貨幣即時更新 · 期貨延遲約 15 分鐘
            {updatedAt && <span className="ml-2 text-slate-500">· 更新於 {updatedAt}</span>}
          </p>
        </div>
        <button
          onClick={fetchPrices}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 glass-card text-slate-300 hover:text-white text-sm transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* Crypto Section */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">加密貨幣</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cryptos.map((asset) => (
            <Link
              key={asset.symbol}
              href={`/dashboard/backtest?symbol=${encodeURIComponent(asset.symbol)}`}
              className="glass-card p-5 hover:border-indigo-500/40 hover:glow-purple transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono font-bold text-white">{asset.symbol}</div>
                  <div className="text-slate-400 text-xs mt-0.5">{asset.name}</div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${asset.change >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%
                </span>
              </div>
              <div className="font-mono font-bold text-white text-xl">
                ${asset.price.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`flex items-center gap-1 mt-2 text-xs ${asset.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {asset.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                24h 變動
              </div>
              <div className="mt-3 flex items-center gap-1 text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                <Zap className="w-3 h-3" /> 點擊開始回測
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Futures Section */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          期貨市場 <span className="text-slate-600 normal-case tracking-normal font-normal">（延遲報價）</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {futures.map((asset) => (
            <div key={asset.symbol} className="glass-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono font-bold text-white">{asset.symbol}</div>
                  <div className="text-slate-400 text-xs mt-0.5">{asset.name}</div>
                </div>
                <span className="text-[10px] badge-purple">延遲</span>
              </div>
              <div className="font-mono font-bold text-white text-xl">
                ${asset.price.toLocaleString()}
              </div>
              <div className={`flex items-center gap-1 mt-2 text-xs ${asset.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {asset.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-10 glass-card p-6">
        <h2 className="text-white font-bold mb-4">快速操作</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/dashboard/backtest" className="flex items-center gap-3 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:border-indigo-500/40 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="flex-1">
              <div className="text-white font-medium text-sm">開始回測</div>
              <div className="text-slate-400 text-xs">設定標的與策略參數</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
          </Link>
          <button
            onClick={() => {}}
            className="flex items-center gap-3 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-all group text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <div className="text-white font-medium text-sm">績效分析</div>
              <div className="text-slate-400 text-xs">查看回測結果排行</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
          </button>
          <button
            onClick={() => {}}
            className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/40 transition-all group text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <History className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="text-white font-medium text-sm">歷史記錄</div>
              <div className="text-slate-400 text-xs">查看過往回測紀錄</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("market");
  const [selectedResult, setSelectedResult] = useState<number | null>(null);

  return (
    <div className="flex h-screen gradient-bg overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 glass border-r border-indigo-500/10 flex flex-col">
        <div className="p-6 border-b border-indigo-500/10">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white text-lg">BacktestNow</span>
          </Link>
          <p className="text-slate-500 text-xs mt-1">AI 策略回測優化平台</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <Link
            href="/dashboard/backtest"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <Zap className="w-5 h-5" />
            回測設定
          </Link>
        </nav>

        <div className="p-4 border-t border-indigo-500/10">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              U
            </div>
            <div className="text-sm">
              <p className="text-white font-medium">我的帳號</p>
              <p className="text-slate-500 text-xs">免費方案</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {activeTab === "market" && <MarketOverview />}

        {activeTab === "optimize" && (
          <div className="p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">新增策略優化</h1>
              <p className="text-slate-400 mt-1">貼上您的 PineScript 代碼，AI 將自動分析並優化參數</p>
            </div>
            <OptimizePanel />
          </div>
        )}

        {activeTab === "history" && (
          <div className="p-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white">優化歷史記錄</h1>
                <p className="text-slate-400 mt-1">查看過去的回測與優化結果</p>
              </div>
              <button onClick={() => setActiveTab("optimize")} className="btn-primary flex items-center gap-2 text-sm py-2">
                <PlusCircle className="w-4 h-4" /> 新增優化
              </button>
            </div>
            <div className="glass-card overflow-hidden">
              <table className="w-full data-table">
                <thead>
                  <tr>
                    <th className="text-left">策略名稱</th>
                    <th className="text-left">交易對</th>
                    <th className="text-left">時間框架</th>
                    <th className="text-left">狀態</th>
                    <th className="text-right">Sharpe Ratio</th>
                    <th className="text-right">勝率</th>
                    <th className="text-right">總獲利 %</th>
                    <th className="text-left">日期</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_HISTORY.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium text-white">{row.name}</td>
                      <td className="font-mono text-slate-300">{row.symbol}</td>
                      <td className="text-slate-400">{row.timeframe}</td>
                      <td>
                        {row.status === "completed" ? (
                          <span className="badge-green">完成</span>
                        ) : (
                          <span className="badge-purple flex items-center gap-1 w-fit">
                            <Activity className="w-3 h-3 animate-pulse" /> 執行中
                          </span>
                        )}
                      </td>
                      <td className="text-right font-mono text-white">
                        {row.sharpe ?? <span className="text-slate-500">-</span>}
                      </td>
                      <td className="text-right">
                        {row.winrate ? (
                          <span className="text-emerald-400 font-mono">{row.winrate}%</span>
                        ) : <span className="text-slate-500">-</span>}
                      </td>
                      <td className="text-right">
                        {row.profit ? (
                          <span className={`font-mono font-bold ${row.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {row.profit >= 0 ? "+" : ""}{row.profit}%
                          </span>
                        ) : <span className="text-slate-500">-</span>}
                      </td>
                      <td className="text-slate-500 text-xs">{row.date}</td>
                      <td>
                        {row.status === "completed" && (
                          <button
                            onClick={() => { setSelectedResult(row.id); setActiveTab("analytics"); }}
                            className="text-indigo-400 hover:text-indigo-300 text-xs font-medium"
                          >
                            查看詳情
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">績效分析</h1>
              <p className="text-slate-400 mt-1">深度分析回測結果與最佳參數組合</p>
            </div>
            <ResultsPanel resultId={selectedResult} />
          </div>
        )}

        {activeTab === "settings" && (
          <div className="p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">設定</h1>
              <p className="text-slate-400 mt-1">管理您的帳號與 API 設定</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="glass-card p-6">
                <h3 className="font-bold text-white mb-4">API 金鑰設定</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Binance API Key</label>
                    <input type="password" className="input-dark" placeholder="輸入您的 Binance API Key" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Binance Secret Key</label>
                    <input type="password" className="input-dark" placeholder="輸入您的 Secret Key" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">OpenAI API Key</label>
                    <input type="password" className="input-dark" placeholder="輸入您的 OpenAI API Key" />
                  </div>
                  <button className="btn-primary w-full">儲存設定</button>
                </div>
              </div>
              <div className="glass-card p-6">
                <h3 className="font-bold text-white mb-4">使用量統計</h3>
                <div className="space-y-4">
                  {[
                    { label: "本月回測次數", value: "3 / 10", pct: 30 },
                    { label: "API 呼叫次數", value: "127 / 500", pct: 25 },
                    { label: "儲存空間", value: "2.3 MB / 100 MB", pct: 2 },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">{stat.label}</span>
                        <span className="text-white font-mono">{stat.value}</span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${stat.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
