#!/usr/bin/env python3
"""
verify_push.py
==============
推送後驗證腳本 — 每次 push 任何 page 到 GitHub 後執行此腳本。

用法：
  GITHUB_TOKEN=xxx python scripts/verify_push.py

功能：
  1. GET 每個受保護的檔案
  2. 核對 MUST / MUST NOT 關鍵字清單
  3. 印出通過 (PASS) / 失敗 (FAIL) 報告
  4. 有任何 FAIL 時，exit code = 1（可接入 CI/CD）

環境變數：
  GITHUB_TOKEN  — GitHub Personal Access Token (read 權限即可)
  GITHUB_REPO   — 預設 ivanc1586/pine-backtester
  GITHUB_BRANCH — 預設 main
"""

import os, sys, base64, json, urllib.request, urllib.error

REPO   = os.environ.get('GITHUB_REPO',   'ivanc1586/pine-backtester')
BRANCH = os.environ.get('GITHUB_BRANCH', 'main')
TOKEN  = os.environ.get('GITHUB_TOKEN',  '')

RULES = [
    {
        'path': 'frontend/src/pages/MarketsPage.tsx',
        'min_bytes': 20000,
        'must_contain': [
            'fapi.binance.com',
            'chart_market',
            'v3.0.0',
        ],
        'must_not_contain': [
            'FUTURES_SYMBOLS',
            'futuresTickers',
            'ES=F',
            'NQ=F',
            'CL=F',
            'GC=F',
            'slice(0, 4)',
            'height: 44',
        ],
    },
    {
        'path': 'frontend/src/pages/ChartPage.tsx',
        'min_bytes': 40000,
        'must_contain': [
            'XAUUSDT',
            'XAGUSDT',
            'chart_market',
            'switchPair',
        ],
        'must_not_contain': [],
    },
    {
        'path': 'frontend/src/pages/HomePage.tsx',
        'min_bytes': 20000,
        'must_contain': [
            'chart_market',
            'fapi.binance.com',
            'sessionStorage',
        ],
        'must_not_contain': [],
    },
    {
        'path': 'frontend/src/constants/symbols.ts',
        'min_bytes': 4000,
        'must_contain': [
            'XAUUSDT', 'XAGUSDT', 'isMetal',
            'getMarketType', 'setChartTarget',
            'fapi.binance.com', 'LS_CHART_MARKET',
        ],
        'must_not_contain': [],
    },
    {
        'path': 'FIXES.md',
        'min_bytes': 3000,
        'must_contain': ['FIXES.md', 'MUST NOT', 'MUST 包含', 'SOP'],
        'must_not_contain': [],
    },
]

def get_file_content(path):
    url = f'https://api.github.com/repos/{REPO}/contents/{path}?ref={BRANCH}'
    req = urllib.request.Request(url)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('X-GitHub-Api-Version', '2022-11-28')
    if TOKEN:
        req.add_header('Authorization', f'Bearer {TOKEN}')
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    size    = data.get('size', 0)
    content = base64.b64decode(data['content']).decode('utf-8', errors='replace')
    return size, content

def main():
    print(f'\n=== verify_push.py  repo={REPO}  branch={BRANCH} ===\n')
    overall_pass = True

    for rule in RULES:
        path = rule['path']
        print(f'-- {path}')
        try:
            size, content = get_file_content(path)
        except urllib.error.HTTPError as e:
            print(f'   [FAIL] HTTP {e.code}: cannot fetch file')
            overall_pass = False
            continue
        except Exception as e:
            print(f'   [FAIL] Error: {e}')
            overall_pass = False
            continue

        file_pass = True
        min_b = rule.get('min_bytes', 0)
        if size < min_b:
            print(f'   [FAIL] size {size} < minimum {min_b}')
            file_pass = False
        else:
            print(f'   [PASS] size {size} bytes')

        for kw in rule.get('must_contain', []):
            if kw in content:
                print(f'   [PASS] contains: {kw!r}')
            else:
                print(f'   [FAIL] MISSING: {kw!r}')
                file_pass = False

        for kw in rule.get('must_not_contain', []):
            if kw not in content:
                print(f'   [PASS] not found: {kw!r}')
            else:
                print(f'   [FAIL] SHOULD NOT EXIST: {kw!r}')
                file_pass = False

        print(f'   => {"ALL PASSED" if file_pass else "FAILED"}\n')
        if not file_pass:
            overall_pass = False

    print('=' * 50)
    if overall_pass:
        print('RESULT: ALL FILES PASSED')
        return 0
    else:
        print('RESULT: FAILURES DETECTED — fix before deploying')
        return 1

if __name__ == '__main__':
    sys.exit(main())
