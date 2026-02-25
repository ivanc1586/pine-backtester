"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import {
  BarChart3, ArrowLeft, Play, Code2, Settings2,
  AlertCircle, Loader2, Target, Save, Trash2,
  CheckCircle2, Info, ChevronDown, ChevronUp
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const SYMBOLS = [
  { value: "BTCUSDT", label: "BTC/USDT" },
  { value: "ETHUSDT", label: "ETH/USDT" },
  { value: "SOLUSDT", label: "SOL/USDT" },
  { value: "BNBUSDT", label: "BNB/USDT" },
  { value: "XRPUSDT", label: "XRP/USDT" },
  { value: "ADAUSDT", label: "ADA/USDT" },
  { value: "AVAXUSDT", label: "AVAX/USDT" },
  { value: "LINKUSDT", label: "LINK/USDT" },
];

const TIMEFRAMES = [
  { value: "1h", label: "1小時" },
  { value: "4h", label: "4小時" },
  { value: "1d", label: "日線" },
  { value: "1w", label: "週線" },
];

interface PineInput {
  name: string;
  type: string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  step?: number;
  title?: string;
}

interface OptimizeRange {
  enabled: boolean;
  min: number;
  max: number;
  step: number;
}

interface Trade {
  id: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: string;
  pnl: number;
  pnlPct: number;
}

interface BacktestResult {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  expectancy: number;
  initialCapital: number;
  finalEquity: number;
  equityCurve: { time: number; equity: number; drawdown: number }[];
  trades: Trade[];
  monthlyReturns: { month: string; return: number }[];
  parsedInputs: PineInput[];
  strategyDescription: string;
  params: Record<string, number>;
  totalBars: number;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${color ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function BacktestPage() {
  const [pineScript, setPineScript] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [commission, setCommission] = useState(0.1);

  const [parsedInputs, setParsedInputs] = useState<PineInput[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [optimizeRanges, setOptimizeRanges] = useState<Record<string, OptimizeRange>>({});
  const [showOptimize, setShowOptimize] = useState(false);
  const [scriptParsed, setScriptParsed] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"equity" | "trades" | "monthly" | "params">("equity");

  const handleScriptChange = useCallback((code: string) => {
    setPineScript(code);
    setScriptParsed(false);
    setResult(null);
    setError("");
    if (code.trim().length < 20) { setParsedInputs([]); return; }

    const inputs: PineInput[] = [];
    const addInput = (name: string, def: number, title: string | undefined, min: string | undefined, max: string | undefined, type: "int" | "float") => {
      if (inputs.find(i => i.name === name)) return;
      const d = Number(def);
      inputs.push({
        name, type, title: title ?? name,
        defaultValue: d,
        minValue: min !== undefined ? Number(min) : Math.max(type === "int" ? 1 : 0.01, Math.floor(d * 0.2)),
        maxValue: max !== undefined ? Number(max) : Math.ceil(d * 3),
        step: type === "int" ? Math.max(1, Math.floor(d * 0.1)) : Math.max(0.01, d * 0.1),
      });
    };

    const intRe = /(\w+)\s*=\s*input\.int\(\s*(-?[\d.]+)(?:[^,)]*,\s*title\s*=\s*["']([^"']+)["'])?(?:[^)]*,\s*minval\s*=\s*(-?[\d.]+))?(?:[^)]*,\s*maxval\s*=\s*(-?[\d.]+))?/g;
    const floatRe = /(\w+)\s*=\s*input\.float\(\s*(-?[\d.]+)(?:[^,)]*,\s*title\s*=\s*["']([^"']+)["'])?(?:[^)]*,\s*minval\s*=\s*(-?[\d.]+))?(?:[^)]*,\s*maxval\s*=\s*(-?[\d.]+))?/g;
    const legacyRe = /(\w+)\s*=\s*input\(\s*(-?[\d.]+)(?:[^,)]*,\s*title\s*=\s*["']([^"']+)["'])?(?:[^)]*,\s*minval\s*=\s*(-?[\d.]+))?(?:[^)]*,\s*maxval\s*=\s*(-?[\d.]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = intRe.exec(code)) !== null) addInput(m[1], Number(m[2]), m[3], m[4], m[5], "int");
    while ((m = floatRe.exec(code)) !== null) addInput(m[1], Number(m[2]), m[3], m[4], m[5], "float");
    while ((m = legacyRe.exec(code)) !== null) addInput(m[1], Number(m[2]), m[3], m[4], m[5], Number.isInteger(Number(m[2])) ? "int" : "float");

    setParsedInputs(inputs);
    const vals: Record<string, number> = {};
    const ranges: Record<string, OptimizeRange> = {};
    for (const inp of inputs) {
      vals[inp.name] = Number(inp.defaultValue);
      ranges[inp.name] = {
        enabled: true,
        min: inp.minValue ?? Math.max(1, Math.floor(Number(inp.defaultValue) * 0.3)),
        max: inp.maxValue ?? Math.ceil(Number(inp.defaultValue) * 2.5),
        step: inp.step ?? Math.max(1, Math.floor(Number(inp.defaultValue) * 0.1)),
      };
    }
    setParamValues(vals);
    setOptimizeRanges(ranges);
    setScriptParsed(inputs.length > 0);
  }, []);

  const handleRun = async () => {
    if (!pineScript.trim()) { setError("請先貼上 Pine Script 策略代碼"); return; }
    setRunning(true); setError(""); setResult(null); setSaved(false);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pineScript, symbol, timeframe, startDate, endDate, initialCapital, commission, params: paramValues }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? "回測失敗"); return; }
      setResult(data);
      if (data.parsedInputs?.length > 0) setParsedInputs(data.parsedInputs);
    } catch { setError("網路錯誤，請稍後再試"); }
    finally { setRunning(false); }
  };

  const handleSave = async () => {
    if (!result) return;
    try {
      const sRes = await fetch("/api/strategies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveStrategy", name: result.strategyName, pineScript, inputs: parsedInputs, description: result.strategyDescription ?? "" }),
      });
      const sData = await sRes.json();
      await fetch("/api/strategies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveResult", result, strategyId: sData.strategy?.id }),
      });
      setSaved(true);
    } catch { setError("儲存失敗"); }
  };

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回儀表板
          </Link>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <span className="font-bold">Pine Script 回測</span>
          </div>
        </div>
        <div className="flex gap-3">
          {result && !saved && (
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 rounded-lg text-sm transition-colors">
              <Save className="w-4 h-4" /> 儲存策略
            </button>
          )}
          {saved && <span className="flex items-center gap-2 px-4 py-2 text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /> 已儲存</span>}
          <button onClick={handleRun} disabled={running || !pineScript.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? "回測中..." : "執行回測"}
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-65px)]">
        {/* Left: Config */}
        <aside className="w-80 border-r border-white/10 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> 回測設定
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">交易對</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                  {SYMBOLS.map(s => <option key={s.value} value={s.value} className="bg-[#1a1a2e]">{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">時間週期</label>
                <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                  {TIMEFRAMES.map(t => <option key={t.value} value={t.value} className="bg-[#1a1a2e]">{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">開始</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">結束</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">初始資金 ($)</label>
                  <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">手續費 (%)</label>
                  <input type="number" step="0.01" value={commission} onChange={e => setCommission(Number(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Detected Params */}
          {parsedInputs.length > 0 && (
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" />
                  偵測 {parsedInputs.length} 個參數
                </h3>
                <button onClick={() => setShowOptimize(o => !o)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  優化 {showOptimize ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>
              <div className="space-y-4">
                {parsedInputs.map(inp => (
                  <div key={inp.name}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-400">{inp.title ?? inp.name}</label>
                      <span className="text-xs text-blue-400 font-mono">{paramValues[inp.name] ?? inp.defaultValue}</span>
                    </div>
                    <input type="range"
                      min={inp.minValue ?? 1} max={inp.maxValue ?? 100} step={inp.step ?? 1}
                      value={paramValues[inp.name] ?? Number(inp.defaultValue)}
                      onChange={e => setParamValues(p => ({ ...p, [inp.name]: Number(e.target.value) }))}
                      className="w-full accent-blue-500" />
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>{inp.minValue ?? 1}</span><span>{inp.maxValue ?? 100}</span>
                    </div>
                    {showOptimize && optimizeRanges[inp.name] && (
                      <div className="mt-2 bg-purple-900/20 border border-purple-500/20 rounded-lg p-2">
                        <div className="flex items-center gap-2 mb-2">
                          <input type="checkbox" checked={optimizeRanges[inp.name].enabled}
                            onChange={e => setOptimizeRanges(r => ({ ...r, [inp.name]: { ...r[inp.name], enabled: e.target.checked } }))}
                            className="accent-purple-500" />
                          <span className="text-xs text-purple-300">啟用優化範圍</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {(["min", "max", "step"] as const).map(f => (
                            <div key={f}>
                              <label className="text-xs text-gray-500 block">{f === "min" ? "最小" : f === "max" ? "最大" : "步長"}</label>
                              <input type="number" value={optimizeRanges[inp.name][f]}
                                onChange={e => setOptimizeRanges(r => ({ ...r, [inp.name]: { ...r[inp.name], [f]: Number(e.target.value) } }))}
                                className="w-full bg-white/5 border border-white/10 rounded px-1 py-0.5 text-xs text-white focus:outline-none" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pineScript.trim().length > 20 && parsedInputs.length === 0 && (
            <div className="p-4">
              <div className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-3">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                未偵測到 input 參數，將使用預設指標設定進行回測。
              </div>
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Editor */}
          <div className="border-b border-white/10 p-4" style={{ height: result ? "200px" : "45%" }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-blue-400" /> Pine Script
                {scriptParsed && <span className="text-xs text-green-400 bg-green-900/30 border border-green-500/30 px-2 py-0.5 rounded-full">✓ 已解析 {parsedInputs.length} 個參數</span>}
              </h3>
              {pineScript && (
                <button onClick={() => { setPineScript(""); setParsedInputs([]); setResult(null); setScriptParsed(false); }}
                  className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors">
                  <Trash2 className="w-3 h-3" /> 清除
                </button>
              )}
            </div>
            <textarea
              value={pineScript}
              onChange={e => handleScriptChange(e.target.value)}
              placeholder={"// 貼上您的 Pine Script 策略代碼\n//@version=5\nstrategy(\"MA Cross\", overlay=true)\nfastLength = input.int(12, title=\"Fast Length\", minval=2, maxval=50)\nslowLength = input.int(26, title=\"Slow Length\", minval=5, maxval=200)\nfastMA = ta.ema(close, fastLength)\nslowMA = ta.ema(close, slowLength)\nif ta.crossover(fastMA, slowMA)\n    strategy.entry(\"Long\", strategy.long)\nif ta.crossunder(fastMA, slowMA)\n    strategy.close(\"Long\")"}
              className="w-full h-[calc(100%-32px)] bg-[#0d0d1a] border border-white/10 rounded-lg p-3 text-sm font-mono text-gray-200 placeholder-gray-700 focus:outline-none focus:border-blue-500 resize-none"
              spellCheck={false}
            />
          </div>

          {error && (
            <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {!result && !running && !error && (
            <div className="flex-1 flex items-center justify-center text-center text-gray-600">
              <div>
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">貼上 Pine Script，設定參數後點擊「執行回測」</p>
                <p className="text-xs mt-1">系統將從 CoinGecko 獲取真實歷史數據進行回測</p>
              </div>
            </div>
          )}

          {running && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-blue-400" />
                <p className="text-sm text-gray-400">正在從 CoinGecko 獲取歷史數據並執行回測...</p>
              </div>
            </div>
          )}

          {result && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-lg">{result.strategyName}</h2>
                  <p className="text-gray-500 text-xs mt-0.5">{result.symbol} · {result.timeframe} · {result.totalBars} 根K線</p>
                </div>
                <Link href={`/dashboard/history?id=${result.id}`}
                  className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg transition-colors">
                  詳細報告 →
                </Link>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="總報酬率" value={`${result.totalReturn > 0 ? "+" : ""}${result.totalReturn}%`}
                  color={result.totalReturn >= 0 ? "text-green-400" : "text-red-400"}
                  sub={`終值 $${result.finalEquity.toLocaleString()}`} />
                <StatCard label="Sharpe 比率" value={result.sharpeRatio.toFixed(2)}
                  color={result.sharpeRatio >= 1 ? "text-green-400" : result.sharpeRatio >= 0 ? "text-yellow-400" : "text-red-400"} />
                <StatCard label="最大回撤" value={`-${result.maxDrawdown}%`} color="text-red-400" />
                <StatCard label="勝率" value={`${result.winRate}%`}
                  color={result.winRate >= 50 ? "text-green-400" : "text-red-400"}
                  sub={`${result.winningTrades}W / ${result.losingTrades}L`} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="總交易次數" value={String(result.totalTrades)} />
                <StatCard label="獲利因子" value={result.profitFactor.toFixed(2)}
                  color={result.profitFactor >= 1.5 ? "text-green-400" : "text-yellow-400"} />
                <StatCard label="平均獲利" value={`+${result.avgWin}%`} color="text-green-400" />
                <StatCard label="平均虧損" value={`${result.avgLoss}%`} color="text-red-400" />
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-white/10">
                {[["equity","權益曲線"],["trades","交易記錄"],["monthly","月度績效"],["params","參數"]].map(([key, label]) => (
                  <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
                    className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${activeTab === key ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "equity" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3 text-gray-300">權益曲線 vs 基準</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={result.equityCurve.filter((_,i) => i % Math.max(1, Math.floor(result.equityCurve.length/200)) === 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="time" tickFormatter={fmtDate} tick={{ fill: "#6b7280", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid #ffffff20", borderRadius: 8 }}
                        labelFormatter={v => new Date(v as number).toLocaleDateString("zh-TW")}
                        formatter={(v: number) => [`$${v.toLocaleString()}`, "權益"]} />
                      <ReferenceLine y={result.initialCapital} stroke="#ffffff30" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {activeTab === "trades" && (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-gray-500 text-xs">
                        <th className="text-left px-4 py-2">#</th>
                        <th className="text-left px-4 py-2">方向</th>
                        <th className="text-left px-4 py-2">進場日</th>
                        <th className="text-left px-4 py-2">出場日</th>
                        <th className="text-right px-4 py-2">進場價</th>
                        <th className="text-right px-4 py-2">出場價</th>
                        <th className="text-right px-4 py-2">損益%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(0, 50).map(t => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-4 py-2 text-gray-500 text-xs">{t.id}</td>
                          <td className="px-4 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${t.direction === "long" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                              {t.direction === "long" ? "多" : "空"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs">{new Date(t.entryTime).toLocaleDateString("zh-TW")}</td>
                          <td className="px-4 py-2 text-gray-400 text-xs">{new Date(t.exitTime).toLocaleDateString("zh-TW")}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{t.entryPrice.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{t.exitPrice.toLocaleString()}</td>
                          <td className={`px-4 py-2 text-right font-bold text-xs ${t.pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.trades.length > 50 && <p className="text-center text-gray-600 text-xs py-2">顯示前 50 筆，共 {result.trades.length} 筆</p>}
                </div>
              )}

              {activeTab === "monthly" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3 text-gray-300">月度報酬率</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {result.monthlyReturns.map(m => (
                      <div key={m.month} className={`rounded-lg p-3 text-center border ${m.return >= 0 ? "bg-green-900/20 border-green-500/20" : "bg-red-900/20 border-red-500/20"}`}>
                        <p className="text-xs text-gray-500 mb-1">{m.month}</p>
                        <p className={`font-bold text-sm ${m.return >= 0 ? "text-green-400" : "text-red-400"}`}>{m.return >= 0 ? "+" : ""}{m.return}%</p>
                      </div>
                    ))}
                    {result.monthlyReturns.length === 0 && <p className="text-gray-600 text-sm col-span-4 text-center py-4">交易次數不足</p>}
                  </div>
                </div>
              )}

              {activeTab === "params" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3 text-gray-300">使用的策略參數</h3>
                  {Object.keys(result.params).length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 text-xs border-b border-white/10">
                          <th className="text-left py-2">參數</th>
                          <th className="text-right py-2">目前值</th>
                          <th className="text-right py-2">預設值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.params).map(([k, v]) => {
                          const inp = parsedInputs.find(i => i.name === k);
                          return (
                            <tr key={k} className="border-b border-white/5">
                              <td className="py-2 text-gray-300">{inp?.title ?? k}</td>
                              <td className="py-2 text-right font-mono text-blue-400">{v}</td>
                              <td className="py-2 text-right font-mono text-gray-500">{inp?.defaultValue ?? "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : <p className="text-gray-600 text-sm">未偵測到自訂參數</p>}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
