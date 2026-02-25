"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart3, ArrowLeft, TrendingUp, TrendingDown,
  Target, Activity, DollarSign, Calendar, Clock,
  ChevronRight, AlertCircle, Loader2
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell
} from "recharts";

interface Trade {
  id: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: string;
  pnl: number;
  pnlPct: number;
  bars: number;
}

interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

interface BacktestResult {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgTradeDuration: number;
  bestTrade: number;
  worstTrade: number;
  expectancy: number;
  equityCurve: EquityPoint[];
  trades: Trade[];
  monthlyReturns: { month: string; return: number }[];
  params: Record<string, number>;
  strategyDescription?: string;
  totalBars: number;
}

function fmt(n: number, d = 2) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function MetricCard({ label, value, sub, color, positive }: {
  label: string; value: string; sub?: string; color?: string; positive?: boolean;
}) {
  const c = color ?? (positive === true ? "text-green-400" : positive === false ? "text-red-400" : "text-white");
  return (
    <div className="bg-[#0f0f1a] border border-white/10 rounded-xl p-4">
      <p className="text-gray-500 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${c}`}>{value}</p>
      {sub && <p className="text-gray-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "trades" | "monthly" | "drawdown" | "params">("overview");

  useEffect(() => {
    if (!id) { setLoading(false); setError("未指定回測 ID"); return; }
    fetch(`/api/strategies?type=result&id=${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.result?.fullResult) setResult(d.result.fullResult as BacktestResult);
        else if (d.result) setResult(d.result as BacktestResult);
        else setError("找不到此回測記錄");
      })
      .catch(() => setError("載入失敗，請重試"))
      .finally(() => setLoading(false));
  }, [id]);

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-400" />
        <p className="text-gray-400">載入回測報告中...</p>
      </div>
    </div>
  );

  if (error || !result) return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center gap-4">
      <AlertCircle className="w-12 h-12 text-red-400" />
      <p className="text-gray-400">{error || "找不到回測記錄"}</p>
      <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> 返回儀表板
      </Link>
    </div>
  );

  const equityData = result.equityCurve?.filter(
    (_, i) => i % Math.max(1, Math.floor((result.equityCurve?.length ?? 0) / 200)) === 0
  ) ?? [];

  const drawdownData = result.equityCurve?.filter(
    (_, i) => i % Math.max(1, Math.floor((result.equityCurve?.length ?? 0) / 200)) === 0
  ).map(p => ({ ...p, drawdown: -p.drawdown })) ?? [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> 儀表板
          </Link>
          <ChevronRight className="w-4 h-4 text-gray-600" />
          <span className="text-sm text-gray-400">回測報告</span>
          <ChevronRight className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-semibold">{result.strategyName}</span>
        </div>
        <Link href="/dashboard/backtest"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors">
          <BarChart3 className="w-4 h-4" /> 新增回測
        </Link>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Strategy Info Banner */}
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/20 rounded-xl p-5 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">{result.strategyName}</h1>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" />{result.symbol}</span>
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{result.timeframe}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{result.startDate} ~ {result.endDate}</span>
              <span className="text-gray-600">{result.totalBars ?? "—"} 根K線</span>
            </div>
            {result.strategyDescription && (
              <p className="text-xs text-gray-500 mt-2">{result.strategyDescription}</p>
            )}
          </div>
          <div className="text-right">
            <p className={`text-3xl font-bold ${result.totalReturn >= 0 ? "text-green-400" : "text-red-400"}`}>
              {result.totalReturn >= 0 ? "+" : ""}{fmt(result.totalReturn)}%
            </p>
            <p className="text-gray-500 text-sm">總報酬率</p>
            <p className="text-gray-400 text-xs mt-1">
              ${result.initialCapital?.toLocaleString()} → ${result.finalEquity?.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Key Metrics Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard label="年化報酬率" value={`${result.annualizedReturn >= 0 ? "+" : ""}${fmt(result.annualizedReturn)}%`} positive={result.annualizedReturn >= 0} />
          <MetricCard label="Sharpe 比率" value={fmt(result.sharpeRatio)}
            color={result.sharpeRatio >= 1.5 ? "text-green-400" : result.sharpeRatio >= 0.5 ? "text-yellow-400" : "text-red-400"} />
          <MetricCard label="Sortino 比率" value={fmt(result.sortinoRatio)}
            color={result.sortinoRatio >= 1.5 ? "text-green-400" : result.sortinoRatio >= 0.5 ? "text-yellow-400" : "text-red-400"} />
          <MetricCard label="最大回撤" value={`-${fmt(result.maxDrawdown)}%`} positive={false}
            sub={result.maxDrawdownDuration ? `持續 ${result.maxDrawdownDuration} 根K線` : undefined} />
          <MetricCard label="獲利因子" value={fmt(result.profitFactor)}
            color={result.profitFactor >= 1.5 ? "text-green-400" : result.profitFactor >= 1 ? "text-yellow-400" : "text-red-400"} />
          <MetricCard label="期望值" value={`${result.expectancy >= 0 ? "+" : ""}${fmt(result.expectancy)}%`}
            positive={result.expectancy >= 0} />
        </div>

        {/* Key Metrics Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="勝率" value={`${fmt(result.winRate, 1)}%`} positive={result.winRate >= 50}
            sub={`${result.winningTrades}W / ${result.losingTrades}L / ${result.totalTrades}總`} />
          <MetricCard label="平均獲利" value={`+${fmt(result.avgWin)}%`} positive={true} />
          <MetricCard label="平均虧損" value={`${fmt(result.avgLoss)}%`} positive={false} />
          <MetricCard label="平均持倉時間" value={`${fmt(result.avgTradeDuration, 1)} 根`}
            sub={`最佳 +${fmt(result.bestTrade)}% / 最差 ${fmt(result.worstTrade)}%`} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10">
          {[
            ["overview", "權益曲線"],
            ["drawdown", "回撤分析"],
            ["trades", "交易記錄"],
            ["monthly", "月度績效"],
            ["params", "參數優化"],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
              className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === key ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Equity Curve */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#0f0f1a] border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-4 text-gray-300 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" /> 權益曲線
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={equityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis dataKey="time" tickFormatter={fmtDate} tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a2e", border: "1px solid #ffffff20", borderRadius: 8 }}
                    labelFormatter={v => new Date(v as number).toLocaleDateString("zh-TW")}
                    formatter={(v: number) => [`$${v.toLocaleString()}`, "權益"]}
                  />
                  <ReferenceLine y={result.initialCapital} stroke="#ffffff30" strokeDasharray="4 4" label={{ value: "初始", fill: "#6b7280", fontSize: 10 }} />
                  <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Win/Loss breakdown */}
            <div className="bg-[#0f0f1a] border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-4 text-gray-300">損益分佈</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-green-400">獲利交易</span>
                    <span>{result.winningTrades} 筆 ({fmt(result.winRate, 1)}%)</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${result.winRate}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-red-400">虧損交易</span>
                    <span>{result.losingTrades} 筆 ({fmt(100 - result.winRate, 1)}%)</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${100 - result.winRate}%` }} />
                  </div>
                </div>
                <div className="pt-3 border-t border-white/10 space-y-2">
                  {[
                    { label: "最佳單筆", value: `+${fmt(result.bestTrade)}%`, c: "text-green-400" },
                    { label: "最差單筆", value: `${fmt(result.worstTrade)}%`, c: "text-red-400" },
                    { label: "平均獲利", value: `+${fmt(result.avgWin)}%`, c: "text-green-400" },
                    { label: "平均虧損", value: `${fmt(result.avgLoss)}%`, c: "text-red-400" },
                    { label: "獲利因子", value: fmt(result.profitFactor), c: result.profitFactor >= 1.5 ? "text-green-400" : "text-yellow-400" },
                  ].map(({ label, value, c }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-gray-500">{label}</span>
                      <span className={`font-mono font-bold ${c}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Drawdown */}
        {activeTab === "drawdown" && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-4 text-gray-300 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" /> 回撤曲線
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={drawdownData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="time" tickFormatter={fmtDate} tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "#1a1a2e", border: "1px solid #ffffff20", borderRadius: 8 }}
                  labelFormatter={v => new Date(v as number).toLocaleDateString("zh-TW")}
                  formatter={(v: number) => [`${v.toFixed(2)}%`, "回撤"]}
                />
                <Bar dataKey="drawdown" fill="#ef4444" opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">最大回撤</p>
                <p className="text-lg font-bold text-red-400">-{fmt(result.maxDrawdown)}%</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">最大回撤持續</p>
                <p className="text-lg font-bold">{result.maxDrawdownDuration ?? "—"} 根</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Calmar 比率</p>
                <p className={`text-lg font-bold ${result.maxDrawdown > 0 ? (result.annualizedReturn / result.maxDrawdown >= 1 ? "text-green-400" : "text-yellow-400") : "text-gray-400"}`}>
                  {result.maxDrawdown > 0 ? fmt(result.annualizedReturn / result.maxDrawdown) : "—"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Trades */}
        {activeTab === "trades" && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-300">交易記錄</h3>
              <span className="text-xs text-gray-500">共 {result.trades?.length ?? 0} 筆</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 text-xs">
                    <th className="text-left px-5 py-3">#</th>
                    <th className="text-left px-4 py-3">方向</th>
                    <th className="text-left px-4 py-3">進場日期</th>
                    <th className="text-left px-4 py-3">出場日期</th>
                    <th className="text-right px-4 py-3">進場價</th>
                    <th className="text-right px-4 py-3">出場價</th>
                    <th className="text-right px-4 py-3">持倉(根)</th>
                    <th className="text-right px-4 py-3">損益金額</th>
                    <th className="text-right px-4 py-3">損益%</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.trades ?? []).slice(0, 100).map(t => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-5 py-3 text-gray-500 text-xs">{t.id}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          t.direction === "long" ? "bg-green-900/40 text-green-400 border border-green-500/20" : "bg-red-900/40 text-red-400 border border-red-500/20"
                        }`}>
                          {t.direction === "long" ? "做多" : "做空"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.entryTime).toLocaleDateString("zh-TW")}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.exitTime).toLocaleDateString("zh-TW")}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{t.entryPrice.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{t.exitPrice.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{t.bars}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {t.pnl >= 0 ? "+" : ""}${fmt(t.pnl)}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-bold ${t.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {t.pnlPct >= 0 ? "+" : ""}{fmt(t.pnlPct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(result.trades?.length ?? 0) > 100 && (
                <p className="text-center text-gray-600 text-xs py-3">顯示前 100 筆，共 {result.trades.length} 筆</p>
              )}
            </div>
          </div>
        )}

        {/* Monthly Returns */}
        {activeTab === "monthly" && (
          <div className="space-y-4">
            <div className="bg-[#0f0f1a] border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-4 text-gray-300">月度報酬率圖</h3>
              {result.monthlyReturns?.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={result.monthlyReturns}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #ffffff20", borderRadius: 8 }}
                      formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, "月報酬"]}
                    />
                    <ReferenceLine y={0} stroke="#ffffff30" />
                    <Bar dataKey="return" radius={[3, 3, 0, 0]}>
                      {result.monthlyReturns.map((m, i) => (
                        <Cell key={i} fill={m.return >= 0 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-600 text-sm text-center py-8">交易次數不足，無月度數據</p>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {(result.monthlyReturns ?? []).map(m => (
                <div key={m.month} className={`rounded-lg p-3 text-center border ${
                  m.return >= 0 ? "bg-green-900/20 border-green-500/20" : "bg-red-900/20 border-red-500/20"
                }`}>
                  <p className="text-xs text-gray-500 mb-1">{m.month}</p>
                  <p className={`font-bold text-sm ${m.return >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {m.return >= 0 ? "+" : ""}{fmt(m.return)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Params */}
        {activeTab === "params" && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-4 text-gray-300 flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-400" /> 策略參數
            </h3>
            {Object.keys(result.params ?? {}).length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-white/10">
                    <th className="text-left py-2 px-4">參數名稱</th>
                    <th className="text-right py-2 px-4">使用值</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.params ?? {}).map(([k, v]) => (
                    <tr key={k} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4 text-gray-300 text-sm">{k}</td>
                      <td className="py-3 px-4 text-right font-mono text-blue-400 text-sm">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-600">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">此策略未使用自訂參數</p>
              </div>
            )}
            <div className="mt-6 p-4 bg-blue-900/20 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-400 font-semibold mb-2">參數優化提示</p>
              <p className="text-xs text-gray-400">
                返回回測頁面，在左側「優化設定」中調整各參數的最小值、最大值與步長，
                可對不同參數組合進行系統性測試，找出最優參數。
              </p>
              <Link href="/dashboard/backtest"
                className="inline-block mt-3 text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg transition-colors">
                前往調整參數 →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    }>
      <HistoryContent />
    </Suspense>
  );
}
