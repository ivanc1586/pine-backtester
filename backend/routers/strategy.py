# =============================================================================
# strategy.py  v3.0.0 - 2026-02-28
# -----------------------------------------------------------------------------
# /api/strategies              — 策略概覽（type="strategy"，使用者手動存）
# /api/strategies/activities   — 最近優化活動（type="activity"，每次優化第一名自動存）
# =============================================================================

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
import datetime as _dt

router = APIRouter()

_strategies: list[dict] = []
MAX_STRATEGIES = 200

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
    profit_pct: float = 0.0
    win_rate: float = 0.0
    max_drawdown: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    total_trades: int = 0
    final_equity: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    params: dict = {}
    equity_curve: list = []
    monthly_pnl: dict = {}
    trades: list = []
    rank: int = 1

class StrategyUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

@router.get("/activities")
async def list_activities():
    activities = [s for s in _strategies if s.get("type") == "activity"]
    return {"activities": activities, "count": len(activities)}

@router.get("")
async def list_strategies():
    strategies = [s for s in _strategies if s.get("type") == "strategy"]
    return {"strategies": strategies, "count": len(strategies)}

@router.post("")
async def save_strategy(req: StrategySaveRequest):
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
    return {"status": "deleted", "total": len(_strategies)}
