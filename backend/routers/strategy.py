# =============================================================================
# strategy.py  v5.0.0 - 2026-03-01
# -----------------------------------------------------------------------------
# CHANGES v5.0.0:
#   - SQLite 持久化（aiosqlite）取代純記憶體 _strategies list
#     * 資料存入 /tmp/strategies.db，Railway 重啟後仍保留
#     * 啟動時非同步初始化 DB（create_db_and_tables）
#   - GET /api/strategies        回傳完整策略紀錄
#   - GET /api/strategies/activities  回傳最近回測活動
#   - GET /api/strategies/{id}   取得單筆完整紀錄
#   - POST /api/strategies        儲存新策略
#   - PUT /api/strategies/{id}    更新名稱/描述
#   - DELETE /api/strategies/{id} 刪除策略
# =============================================================================

import json
import os
import uuid
import datetime as _dt
import logging

import aiosqlite
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter()

DB_PATH = os.environ.get("STRATEGIES_DB_PATH", "/tmp/strategies.db")

# -- DB Init -------------------------------------------------------------------

async def create_db_and_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'strategy',
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_type_created ON strategies(type, created_at DESC)")
        await db.commit()
    logger.info(f"strategy DB ready: {DB_PATH}")

# -- Request / Response Models -------------------------------------------------

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
    initial_capital: Optional[float] = None
    commission_type: Optional[str] = None
    commission_value: Optional[float] = None

class StrategyUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

# -- Routes --------------------------------------------------------------------

@router.get("/activities")
async def list_activities(limit: int = Query(default=20, ge=1, le=200)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE type=? ORDER BY created_at DESC LIMIT ?",
            ("activity", limit)
        ) as cursor:
            rows = await cursor.fetchall()
    activities = [json.loads(r["data"]) for r in rows]
    return {"activities": activities, "count": len(activities)}


@router.get("")
async def list_strategies():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE type=? ORDER BY created_at DESC",
            ("strategy",)
        ) as cursor:
            rows = await cursor.fetchall()
    strategies = [json.loads(r["data"]) for r in rows]
    return {"strategies": strategies, "count": len(strategies)}


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE id=?", (strategy_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return json.loads(row["data"])


@router.post("")
async def save_strategy(req: StrategySaveRequest):
    entry = req.model_dump()
    entry["id"] = str(uuid.uuid4())
    entry["created_at"] = _dt.datetime.now().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO strategies (id, type, name, created_at, data) VALUES (?,?,?,?,?)",
            (entry["id"], entry["type"], entry["name"], entry["created_at"], json.dumps(entry))
        )
        # Keep max 200 rows per type
        await db.execute("""
            DELETE FROM strategies WHERE type=? AND id NOT IN (
                SELECT id FROM strategies WHERE type=? ORDER BY created_at DESC LIMIT 200
            )
        """, (entry["type"], entry["type"]))
        await db.commit()
    return {"id": entry["id"], "status": "saved"}


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, req: StrategyUpdateRequest):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT data FROM strategies WHERE id=?", (strategy_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Strategy not found")
        entry = json.loads(row["data"])
        if req.name is not None:
            entry["name"] = req.name
        if req.description is not None:
            entry["description"] = req.description
        await db.execute(
            "UPDATE strategies SET name=?, data=? WHERE id=?",
            (entry["name"], json.dumps(entry), strategy_id)
        )
        await db.commit()
    return {"status": "updated", "id": strategy_id}


@router.delete("/{strategy_id}")
async def delete_strategy(strategy_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute("DELETE FROM strategies WHERE id=?", (strategy_id,))
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "deleted", "id": strategy_id}
