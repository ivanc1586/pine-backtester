from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class StrategyConfig(BaseModel):
    name: str
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    params: dict = {}

@router.get("/list")
async def list_strategies():
    return {
        "strategies": [
            {
                "id": "sma_cross",
                "name": "SMA Crossover",
                "description": "Simple Moving Average crossover strategy",
                "params": [
                    {"name": "fast_period", "type": "int", "default": 10},
                    {"name": "slow_period", "type": "int", "default": 30},
                ]
            },
            {
                "id": "rsi",
                "name": "RSI Strategy",
                "description": "Relative Strength Index strategy",
                "params": [
                    {"name": "period", "type": "int", "default": 14},
                    {"name": "overbought", "type": "float", "default": 70},
                    {"name": "oversold", "type": "float", "default": 30},
                ]
            },
            {
                "id": "bollinger",
                "name": "Bollinger Bands",
                "description": "Bollinger Bands mean reversion strategy",
                "params": [
                    {"name": "period", "type": "int", "default": 20},
                    {"name": "std_dev", "type": "float", "default": 2.0},
                ]
            },
        ]
    }

@router.post("/save")
async def save_strategy(config: StrategyConfig):
    return {"status": "saved", "strategy": config.dict()}
