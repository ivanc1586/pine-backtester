# =============================================================================
# strategy.py  v5.1.0 - 2026-03-02
# -----------------------------------------------------------------------------
# CHANGES v5.1.0:
#   - type="strategy"（策略總覽回測結果）→ 永久保存，expires_at = NULL
#   - type="activity"（近期回測活動）→ TTL 7 天，expires_at = now+7d
#     * 寫入時同步刪除過期 activity（DELETE WHERE expires_at < now）
#     * list_activities 過濾已過期但未被清除的資料
#     * 移除舊的 LIMIT 200 per-type cleanup，改為時間清理
#   - create_db_and_tables 加入 ALTER TABLE 相容舊 DB（欄位已存在則略過）
#   - schema 新增 expires_at TEXT 欄位（可 NULL）及對應 index
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

_ACTIVITY_TTL_DAYS = 7

# -- DB Init -------------------------------------------------------------------

async def create_db_and_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        # 主表
        await db.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'strategy',
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                data TEXT NOT NULL
            )
        """)
        # 相容舊 DB：若 expires_at 欄位不存在則新增（已存在時 SQLite 會拋錯，直接略過）
        try:
            await db.execute("ALTER TABLE strategies ADD COLUMN expires_at TEXT")
        except Exception:
            pass  # column already exists — safe to ignore
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_type_created ON strategies(type, created_at DESC)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_expires_at ON strategies(expires_at)"
        )
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
    """回傳近期回測活動（僅回傳未過期的，TTL 7 天）。"""
    now_iso = _dt.datetime.now().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT data FROM strategies
            WHERE type = 'activity'
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (now_iso, limit)
        ) as cursor:
            rows = await cursor.fetchall()
    activities = [json.loads(r["data"]) for r in rows]
    return {"activities": activities, "count": len(activities)}


@router.get("")
async def list_strategies():
    """回傳策略總覽（永久保存，無 TTL）。"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE type = 'strategy' ORDER BY created_at DESC",
        ) as cursor:
            rows = await cursor.fetchall()
    strategies = [json.loads(r["data"]) for r in rows]
    return {"strategies": strategies, "count": len(strategies)}


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE id = ?", (strategy_id,)
        ) as cursor:
            row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return json.loads(row["data"])


@router.post("")
async def save_strategy(req: StrategySaveRequest):
    """
    type="strategy" → 永久保存（expires_at = NULL）
    type="activity" → TTL 7 天（expires_at = now + 7d），並清除過期的 activity
    """
    entry = req.model_dump()
    entry["id"] = str(uuid.uuid4())
    now = _dt.datetime.now()
    entry["created_at"] = now.isoformat()

    if req.type == "activity":
        expires_at = (now + _dt.timedelta(days=_ACTIVITY_TTL_DAYS)).isoformat()
    else:
        expires_at = None  # strategy → 永久

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO strategies (id, type, name, created_at, expires_at, data) VALUES (?,?,?,?,?,?)",
            (entry["id"], entry["type"], entry["name"], entry["created_at"], expires_at, json.dumps(entry))
        )
        if req.type == "activity":
            # 清除 7 天前的舊 activity（寫入觸發，無需獨立排程）
            await db.execute(
                "DELETE FROM strategies WHERE type = 'activity' AND expires_at IS NOT NULL AND expires_at < ?",
                (now.isoformat(),)
            )
        await db.commit()

    return {"id": entry["id"], "status": "saved", "expires_at": expires_at}


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, req: StrategyUpdateRequest):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT data FROM strategies WHERE id = ?", (strategy_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Strategy not found")
        entry = json.loads(row["data"])
        if req.name is not None:
            entry["name"] = req.name
        if req.description is not None:
            entry["description"] = req.description
        await db.execute(
            "UPDATE strategies SET name = ?, data = ? WHERE id = ?",
            (entry["name"], json.dumps(entry), strategy_id)
        )
        await db.commit()
    return {"status": "updated", "id": strategy_id}


@router.delete("/{strategy_id}")
async def delete_strategy(strategy_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute(
            "DELETE FROM strategies WHERE id = ?", (strategy_id,)
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Strategy not found")
    return {"status": "deleted", "id": strategy_id}
