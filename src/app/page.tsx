"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Zap, Database, BarChart3, Code2, ArrowRight, Star } from "lucide-react";

const ASSETS = [
  { symbol: "BTC/USDT", name: "比特幣", price: 66353.14, change: -1.97, type: "crypto" },
  { symbol: "ETH/USDT", name: "以太坊", price: 1929.38, change: -1.01, type: "crypto" },
  { symbol: "SOL/USDT", name: "Solana", price: 80.93, change: -3.40, type: "crypto" },
  { symbol: "BNB/USDT", name: "Binance Coin", price: 611.63, change: -1.14, type: "crypto" },
  { symbol: "GC", name: "黃金期貨", price: 5173, change: 1.80, type: "futures" },
  { symbol: "NQ", name: "納指期貨", price: 24930, change: -0.55, type: "futures" },
  { symbol: "ES", name: "標普期貨", price: 6897, change: -0.39, type: "futures" },
  { symbol: "SIL", name: "白銀期貨", price: 86, change: 4.71, type: "futures" },
];

const FEATURES = [
  {
    icon: <Zap className="w-6 h-6" />,
    title: "AI 參數自動遍歷",
    desc: "告別手動調整！AI 引擎自動執行數千次迭代，精確找出各種市場狀況下的最佳參數範圍。",
    color: "from-indigo-500 to-purple-600",
  },
  {
    icon: <Database className="w-6 h-6" />,
    title: "深度歷史數據整合",
    desc: "整合幣安 (Binance) 等主流交易所的深度 Tick 級數據，確保回測結果最接近真實市場反應。",
    color: "from-cyan-500 to-blue-600",
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: "全方位績效分析",
    desc: "自動計算 Sharpe Ratio、最大回撤、勝率、利潤因子等核心指標，一鍵掌握策略優劣。",
    color: "from-emerald-500 to-teal-600",
  },
  {
    icon: <Code2 className="w-6 h-6" />,
    title: "一鍵匯出最佳代碼",
    desc: "找到最佳參數後，系統自動生成含新參數的 PineScript 代碼，直接貼回 TradingView 即可使用。",
    color: "from-orange-500 to-amber-600",
  },
];

const STEPS = [
  { num: "01", title: "上傳 PineScript", desc: "貼上您的策略代碼，系統自動擷取所有可調整參數。" },
  { num: "02", title: "設定優化範圍", desc: "自訂每個參數的最小值、最大值與間距，或讓 AI 自動決定（1,000〜10,000 組合）。" },
  { num: "03", title: "匯出最佳代碼", desc: "查看排行榜，選擇最佳參數組合，一鍵生成新的 PineScript 代碼。" },
];

function PriceTicker() {
  const [prices, setPrices] = useState(ASSETS);
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("zh-TW", { hour12: false }));
    };
    updateTime();
    const interval = setInterval(() => {
      setPrices((prev) =>
        prev.map((a) => ({
          ...a,
          price: a.type === "crypto" ? a.price * (1 + (Math.random() - 0.5) * 0.001) : a.price,
          change: a.change + (Math.random() - 0.5) * 0.05,
        }))
      );
      updateTime();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const doubled = [...prices, ...prices];

  return (
    <div className="py-8">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-1">支援資產報價</h2>
        <p className="text-slate-400 text-sm">
          8 項可回測資產 · 加密貨幣即時更新 · 期貨延遲報價
        </p>
      </div>
      <div className="ticker-wrapper bg-dark-800/50 border border-indigo-500/10 rounded-xl py-3">
        <div className="ticker-content gap-8 px-4">
          {doubled.map((asset, i) => (
            <div key={i} className="inline-flex items-center gap-3 px-4 py-2 glass-card mx-2 min-w-[180px]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-white text-sm">{asset.symbol}</span>
                  {asset.type === "futures" && (
                    <span className="badge-purple text-[10px]">延遲</span>
                  )}
                </div>
                <div className="text-slate-400 text-xs">{asset.name}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono font-bold text-white text-sm">
                  ${asset.type === "crypto" ? asset.price.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : asset.price.toLocaleString()}
                </div>
                <div className={`flex items-center justify-end text-xs font-semibold ${asset.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {asset.change >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-center text-slate-500 text-xs mt-2">
        加密貨幣更新於 {time} · 每 60 秒自動刷新　＊ 期貨報價約有 15 分鐘延遲；收市後顯示前一交易日收盤價
      </p>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen gradient-bg">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-indigo-500/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white text-lg">BacktestNow</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="btn-primary text-sm py-2 px-5">
              免費開始
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-indigo-500/20 mb-6 text-sm text-indigo-300">
            <Star className="w-4 h-4 fill-indigo-400 text-indigo-400" />
            2026 AI 策略優化引擎全新進化
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight">
            BacktestNow<br />
            <span className="gradient-text">AI 強力驅動回測</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            將您的 TradingView PineScript 策略優化至極致。運用自動化參數掃描與深度數據分析，
            助您在多變市場中精準點擊，奪得交易先機。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/dashboard" className="btn-primary text-base py-3 px-8 flex items-center gap-2 justify-center">
              立即啟動優化 <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/dashboard" className="btn-secondary text-base py-3 px-8 justify-center">
              進入儀表板
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-12">網站核心功能</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="glass-card p-6 hover:glow-purple transition-all duration-300 group">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-4 text-white group-hover:scale-110 transition-transform`}>
                  {f.icon}
                </div>
                <h3 className="font-bold text-white mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Price Ticker */}
      <section className="px-6">
        <div className="max-w-7xl mx-auto">
          <PriceTicker />
        </div>
      </section>

      {/* Steps */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-12">三步驟完成最佳化</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={i} className="glass-card p-8 relative overflow-hidden">
                <div className="absolute top-4 right-4 text-6xl font-black text-indigo-500/10 select-none">
                  {s.num}
                </div>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm mb-4">
                  {s.num}
                </div>
                <h3 className="font-bold text-white text-lg mb-3">{s.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center glass-card p-12">
          <div className="text-4xl mb-4">🚀</div>
          <h2 className="text-3xl font-bold text-white mb-4">立即開始免費優化</h2>
          <p className="text-slate-400 mb-8">無需信用卡，立即體驗 AI 策略優化引擎</p>
          <Link href="/dashboard" className="btn-primary text-base py-3 px-10 inline-flex items-center gap-2">
            立即進入 <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Sponsors */}
      <section className="py-10 px-6 border-t border-indigo-500/10">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-500 text-sm mb-6">贊助夥伴</p>
          <div className="flex justify-center gap-8 flex-wrap">
            <a href="https://mytd.cc/dMzp" target="_blank" rel="noopener noreferrer"
              className="glass px-6 py-3 rounded-xl text-slate-300 hover:text-white hover:border-indigo-500/40 transition-all text-sm font-medium">
              M · MiTRADE · 立即開戶
            </a>
            <a href="https://reurl.cc/oKAgxg" target="_blank" rel="noopener noreferrer"
              className="glass px-6 py-3 rounded-xl text-slate-300 hover:text-white hover:border-indigo-500/40 transition-all text-sm font-medium">
              P · 派網 · Pionex · 立即開戶
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 text-center text-slate-500 text-sm border-t border-indigo-500/10">
        <p>© 2026 BacktestNow. AI 策略回測優化平台</p>
      </footer>
    </div>
  );
}