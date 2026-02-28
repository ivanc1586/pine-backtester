# =============================================================================
# strategy.py  v2.0.0 - 2026-02-28
# -----------------------------------------------------------------------------
# /api/strategies  — 策略總覽 CRUD（in-memory，含完整回測報告欄位）
#   GET  /api/strategies         — 列出所有策略
#   POST /api/strategies         — 新增策略（自動賦予 id + saved_at）
#   PUT  /api/strategies/{id}    — 更新策略名稱 / 描述
#   DELETE /api/strategies/{id}  — 刪除策略
# =============================================================================

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
import datetime as _dt

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory store（最多保留 200 筆，LIFO 插入）
# ---------------------------------------------------------------------------
_strategies: list[dict] = []
MAX_STRATEGIES = 200


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class StrategySaveRequest(BaseModel):
    # 基本識別
    name: str                           # e.g. "BTCUSDT 1H"
    description: str = ""
    pine_script: str = ""               # 含最佳參數的完整 Pine Script

    # 回測設定
    symbol: str = ""
    market_type: str = "spot"
    interval: str = ""
    start_date: str = ""
    end_date: str = ""

    # 核心績效指標
    profit_pct: float = 0.0
    win_rate: float = 0.0
    max_drawdown: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    total_trades: int = 0
    final_equity: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0

    # 完整報告資料
    params: dict = {}
    equity_curve: list = []
    monthly_pnl: dict = {}
    trades: list = []

    # 排名（從優化結果帶入）
    rank: int = 1


class StrategyUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_strategies():
    """列出所有已儲存的策略（含完整回測指標）。"""
    return {"strategies": _strategies, "count": len(_strategies)}


@router.post("")
async def save_strategy(req: StrategySaveRequest):
    """新增一筆策略到策略總覽。自動產生 id 與 saved_at。"""
    entry = req.dict()
    entry["id"] = str(uuid.uuid4())
    entry["saved_at"] = _dt.datetime.now().isoformat()

    _strategies.insert(0, entry)
    if len(_strategies) > MAX_STRATEGIES:
        _strategies.pop()

    return {"status": "saved", "id": entry["id"], "total": len(_strategies)}


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, req: StrategyUpdateRequest):
    """更新策略名稱或描述。"""
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
    """刪除策略。"""
    global _strategies
    before = len(_strategies)
    _strategies = [s for s in _strategies if s["id"] != strategy_id]
    if len(_strategies) == before:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "deleted", "total": len(_strategies)}
