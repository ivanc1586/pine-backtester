"""
market.py - Binance.US (primary) + Kraken (fallback) with SQLite caching
- Binance.com returns HTTP 451 on US-hosted servers (Railway)
- Binance.US uses api.binance.us / stream.binance.us:9443 (same payload format)
- Kraken is fallback: api.kraken.com/0/public/OHLC (no auth, no geo-block)
"""

import asyncio
import json
import sqlite3
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import websockets
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(tags=["market"])

# ---------------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------------
DB_PATH = Path("/tmp/market_cache.db")
SYNC_INTERVAL_SEC = 60

# Binance.US endpoints (same payload format as Binance.com)
BINANCE_US_REST = "https://api.binance.us/api/v3/klines"
BINANCE_US_WS   = "wss://stream.binance.us:9443/ws"

# Kraken fallback
KRAKEN_REST = "https://api.kraken.com/0/public/OHLC"

# Interval mapping: UI label -> (Binance interval str, Kraken interval minutes)
INTERVAL_MAP: dict[str, tuple[str, int]] = {
    "1m":  ("1m",  1),
    "5m":  ("5m",  5),
