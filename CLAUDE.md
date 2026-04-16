# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

离线可用的仓库抽检 PWA 应用。工作人员用手机扫描条形码（CODE_128），系统根据 `docs/SIT IT.xlsx` 生成的 `docs/outbound-index.json` 判断是否命中已出库清单。命中时给出红色强警示，未命中时给出绿色正常提示。纯客户端应用，无后端。

## Development Commands

```bash
# 本地开发（HTTP 模式，摄像头不可用）
python -m http.server 8080

# HTTPS 模式（手机摄像头可用，需要 HTTPS 或 localhost）
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=0.0.0.0"
python -c "import http.server, ssl; s=http.server.HTTPServer(('0.0.0.0',8443),http.server.SimpleHTTPRequestHandler); s.socket=ssl.wrap_socket(s.socket,keyfile='key.pem',certfile='cert.pem',server_side=True); s.serve_forever()"

# 生成运行索引（修改 Excel 后必须执行）
python scripts/build-outbound-index.py

# 语法校验（无构建步骤，用 node 检查 JS）
node --check js/app.js js/db.js js/scanner.js js/utils.js sw.js

# Docker 部署
docker build -t stock-review .
docker run -p 80:80 stock-review
```

无构建步骤、无包管理器、无测试框架。零依赖纯静态文件项目。

## Architecture

### 数据流

```
SIT IT.xlsx → scripts/build-outbound-index.py → outbound-index.json → App 加载索引 → Scanner 扫码 → Utils 标准化 → Set 匹配 → IndexedDB 持久化
```

Excel 是维护源，前端运行时只依赖 `docs/outbound-index.json`。修改 Excel 后必须重新运行 `build-outbound-index.py`。

### 模块职责

| 模块 | 职责 |
|------|------|
| `js/utils.js` — `Utils` | ID 生成、日期格式化、HTML 转义防 XSS、条码标准化、目标码判断 |
| `js/db.js` — `DB` | IndexedDB 封装，`inspections` store（DB_VERSION: 4） |
| `js/scanner.js` — `Scanner` | 基于 `html5-qrcode`（CODE_128 only）的条形码扫描，实例复用模式（同一容器只创建一次 Html5Qrcode） |
| `js/app.js` — `App` | 单页路由、索引加载与 Set 匹配、抽检结果判定、重复条码检测、最近记录展示、SW 注册与自动更新 |
| `scripts/build-outbound-index.py` | 从 Excel 提取 `INVOICE` 列，直接解析 ZIP/XML 生成 JSON 索引 |

### 页面路由

单页应用，通过 `showPage()` 切换 `.page.active` 类：

- `page-home` — 基础数据状态与开始抽检入口
- `page-scanner` — 摄像头扫码、结果卡、继续/结束按钮、最近记录

### 扫码交互流程

1. 进入扫码页 → 摄像头启动 → 连续扫描
2. 非目标码 → 轻提示 + 轻震动，不中断扫描
3. 目标码命中 → 红色结果卡 + 强震动 → 停留展示 → 用户点击"继续抽检"或"结束抽检"
4. 目标码未命中 → 绿色结果卡 + 短震动 → 同上
5. 同一条码不重复写入 IndexedDB，结果显示"已抽检过"

### 条码规则

仅接受：`7位数字` 或 `JY + 7位数字`。运行时统一标准化为 `JYxxxxxxx`。

当前只扫描 CODE_128 格式。如需支持其他格式，修改 `scanner.js` 的 `_getScannerFormats()`。

### Service Worker 缓存策略

- `sw.js` 中 `VERSION` 变量控制缓存版本
- 导航请求：network-first；索引文件：network-first；静态资源：stale-while-revalidate
- 新 SW 安装后通过 `postMessage('SKIP_WAITING')` + `skipWaiting()` 立即激活，监听 `activated` 状态自动 reload

### IndexedDB Schema

- **inspections** store: `id`(keyPath), `rawCode`, `normalizedCode`, `plainCode`, `result`, `message`, `matchedSource`, `scannedAt`
- 索引：`scannedAt`、`normalizedCode`、`result`

## Key Conventions

- `sw.js` 的 `VERSION` 与 `js/app.js` 的 `VERSION` **必须同步递增**，每次修改任何前端文件后都要改
- 所有 UI 字符串和注释为中文
- HTML 转义统一使用 `Utils.esc()` 防 XSS
- 全局单例对象模式：`Utils`、`DB`、`Scanner`、`App`
- 第三方库本地化在 `libs/`，不使用 CDN（当前仅 `html5-qrcode.min.js`）
- 摄像头需要 HTTPS 或 localhost 环境
- PWA 安全区域：header/page/toast 使用 `env(safe-area-inset-*)` 适配刘海屏
- 刷新按钮使用 `onclick` 内联绑定（安卓独立模式下 addEventListener 可能不触发）

## iOS 注意事项

- `html5-qrcode` 的 `facingMode` 只接受字符串（如 `'environment'`）或 `{ exact: ... }`，不支持 `{ ideal: ... }`
- `Scanner` 复用同一 `Html5Qrcode` 实例，不要每次 start 都 new + clear，否则 iOS 报 "Cannot transition to a new state"
- 扫码成功后用 `_pause()`（只 stop 不 clear）而非 `stop()`（stop + clear 销毁实例）

## Pending Work

- 无
