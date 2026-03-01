# ================================================================================
# strategy.py  v4.0.0 - 2026-03-01
# --------------------------------------------------------------------------------
# CHANGES v4.0.0:
#   - GET /api/strategies/{id}  新增：ReportPage 直接取得單筆完整報告
#   - GET /api/strategies        回傳完整欄位（含 equity_curve, trades, params 等）
#   - GET /api/strategies/activities  回傳完整欄位（供近期活動看報告功能）
#   - GET /api/strategies/activities?limit=N  支援 limit 參數
# ================================================================================

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import uuid
import datetime as _dt

router = APIRouter()

_strategies: list[dict] = []
MAX_STRATEGIES = 200

# ── Request / Response Models ───────────────────────────────────────────────────

class StrategySaveRequest(BaseModel):
    type: str = "strategy"
    name: str
    description: str = ""
    pine_script: str = ""
    symbol: str = ""
    market_type: str = "spot"
    interval: str = ""
    start_date: str = ""
    end_date: str = ""
    # core metrics
    profit_pct: float = 0.0
    win_rate: float = 0.0
    max_drawdown: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    total_trades: int = 0
    final_equity: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    # full report data
    params: dict = {}
    equity_curve: list = []
    monthly_pnl: dict = {}
    trades: list = []
    rank: int = 1
    # optional backtest settings
    initial_capital: Optional[float] = None
    commission_type: Optional[str] = None
    commission_value: Optional[float] = None

class StrategyUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

# ── Routes ──────────────────────────────────────────────────────────────────────

@router.get("/activities")
async def list_activities(limit: int = Query(default=20, ge=1, le=200)):
    """
    近期回測活動清單（type="activity"，每次優化第一名自動儲存）
    回傳完整欄位，供 ReportPage 直接使用
    """
    activities = [s for s in _strategies if s.get("type") == "activity"]
    return {"activities": activities[:limit], "count": len(activities)}


@router.get("")
async def list_strategies():
    """
    策略總覽清單（type="strategy"，使用者手動儲存）
    回傳完整欄位，供策略總覽點擊後跳轉 /report/:id
    """
    strategies = [s for s in _strategies if s.get("type") == "strategy"]
    return {"strategies": strategies, "count": len(strategies)}


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str):
    """
    取得單筆策略完整資料
    供 ReportPage (/report/:id) 使用
    """
    for s in _strategies:
        if s["id"] == strategy_id:
            return s
    raise HTTPException(status_code=404, detail="Strategy not found")


@router.post("")
async def save_strategy(req: StrategySaveRequest):
    """
    儲存策略（手動：type="strategy" 或自動：type="activity"）
    回傳 id 供前端存入 sessionStorage 對應 report_<id>
    """
    entry = req.dict()
    entry["id"] = str(uuid.uuid4())
    entry["saved_at"] = _dt.datetime.now().isoformat()
    _strategies.insert(0, entry)
    if len(_strategies) > MAX_STRATEGIES:
        _strategies.pop()
    return {"status": "saved", "id": entry["id"], "total": len(_strategies)}


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, req: StrategyUpdateRequest):
    for s in _strategies:
        if s["id"] == strategy_id:
            if req.name is not None:
                s["name"] = req.name
            if req.description is not None:
                s["description"] = req.description
            s["updated_at"] = _dt.datetime.now().isoformat()
            return {"status": "updated", "strategy": s}
    raise HTTPException(status_code=404, detail="Strategy not found")


@router.delete("/{strategy_id}")
async def delete_strategy(strategy_id: str):
    global _strategies
    before = len(_strategies)
    _strategies = [s for s in _strategies if s["id"] != strategy_id]
    if len(_strategies) == before:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "deleted", "remaining": len(_strategies)}
