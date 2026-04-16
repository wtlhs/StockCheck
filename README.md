# StockReview - 仓库抽检工具

离线可用的仓库抽检 PWA 应用。工作人员用手机扫描条形码，系统根据 `docs/SIT IT.xlsx` 生成的 `docs/outbound-index.json` 判断是否命中已出库清单；命中显示红色异常警示，未命中显示绿色正常提示。

## 功能

- **条形码扫描** — 使用摄像头连续扫描一维码，支持 `7位数字` 和 `JY+7位数字`
- **目标码预判** — 非目标码仅轻提示，不打断连续扫描
- **异常预警** — 命中已出库清单时显示红色强警示并震动提醒
- **正常放行** — 未命中时显示绿色正常提示
- **最近记录** — 最近 10 条抽检记录保存在 IndexedDB 并即时展示
- **离线可用** — PWA + Service Worker + IndexedDB，无网络也可继续使用已缓存索引
- **安装到桌面** — 可添加到手机主屏幕，按原生应用方式使用

## 条码规则

仅接受以下两类目标码：

- `1234567`
- `JY1234567`

运行时会统一标准化为 `JY1234567` 形式进行匹配，同时保留纯数字形式用于辅助命中。

## 数据来源

- 维护源：`docs/SIT IT.xlsx`
- 运行索引：`docs/outbound-index.json`
- 生成脚本：`scripts/build-outbound-index.py`

索引文件包含：

```json
{
  "version": "2026-04-14",
  "source": "SIT IT.xlsx",
  "count": 30,
  "codes": ["JY2502012"],
  "plainCodes": ["2502012"]
}
```

## 快速开始

### 本地开发

```bash
# HTTP 模式（摄像头不可用）
python -m http.server 8080

# HTTPS 模式（手机摄像头可用）
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=0.0.0.0"
python -c "import http.server, ssl; s=http.server.HTTPServer(('0.0.0.0',8443),http.server.SimpleHTTPRequestHandler); s.socket=ssl.wrap_socket(s.socket,keyfile='key.pem',certfile='cert.pem',server_side=True); s.serve_forever()"
```

> 手机摄像头需要 HTTPS 或 localhost 才能工作。通过局域网 IP 用 HTTP 访问时浏览器会拒绝摄像头权限。

### Docker 部署

```bash
docker build -t stock-review .
docker run -p 80:80 stock-review
```

## 使用流程

1. 打开应用，等待基础数据加载完成
2. 点击“开始抽检”进入扫码页
3. 将条形码放入取景框内
4. 若命中已出库清单，立即显示红色异常警示
5. 若未命中，显示绿色正常提示
6. 系统自动恢复扫码，继续下一件抽检

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 HTML/CSS/JavaScript，零构建步骤 |
| 扫码 | html5-qrcode + getUserMedia |
| 存储 | IndexedDB |
| 数据匹配 | JSON 索引 + 内存 Set |
| 离线 | Service Worker + PWA Manifest |
| 部署 | NGINX / Docker |

## 项目结构

```
├── index.html                    # 单页应用入口
├── manifest.json                 # PWA 配置
├── sw.js                         # Service Worker
├── css/style.css                 # 样式
├── js/
│   ├── app.js                    # 应用主体（页面切换、抽检流程、SW 更新）
│   ├── db.js                     # IndexedDB 数据层（inspections）
│   ├── scanner.js                # 条形码扫描模块
│   └── utils.js                  # 工具函数与条码标准化
├── scripts/
│   └── build-outbound-index.py   # 从 Excel 生成运行索引
├── docs/
│   ├── SIT IT.xlsx               # 已出库清单维护源
│   └── outbound-index.json       # 前端运行索引
├── libs/                         # 第三方库（本地化）
├── icons/                        # PWA 图标
├── Dockerfile                    # Docker 部署
└── nginx.conf                    # NGINX 配置
```
