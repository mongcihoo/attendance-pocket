# AttendancePocket｜个人离线考勤

面向一台 iPhone 的本地考勤与工时记录工具。同一套 HTML/CSS/JavaScript 同时用于可安装的离线 PWA 和保留的 iPhone 原生外壳。没有账号、服务器数据库、跨设备同步或业务数据上传。

## 目录

```text
AttendancePocket/
├── index.html                 # PWA 入口，也是原生外壳内嵌页面
├── app.js                     # 全部业务逻辑与 IndexedDB 数据层
├── styles.css                 # iPhone 优先界面与安全区适配
├── manifest.webmanifest       # PWA 安装清单
├── sw.js                      # 离线资源与版本更新策略
├── icons/                     # Apple Touch、192、512、maskable 图标
├── iOS/
│   ├── AttendancePocket.xcodeproj/
│   └── AttendancePocket/      # 原生 SwiftUI/WKWebView 外壳（完整保留）
├── DEPLOYMENT.md              # 0 成本部署和 iPhone 安装说明
├── tests/validate_pwa.rb      # PWA 静态完整性检查（无依赖）
└── .github/workflows/pages.yml# 可选 GitHub Pages 自动部署
```

## 已实现业务功能

- 2–5 人管理与快速切换
- 每人每天上午/下午各一条记录，阻止重复时段
- 自动日期、星期、创建/更新时间；可填打卡时间和实际工时
- 地点、工作内容历史联想、别名、重命名和合并
- 补录、编辑、删除、列表和详情
- 月历上午/下午双色低饱和度圆点
- 按人员、日期、地点、工作内容组合统计出勤日、记录数和总工时
- 完整 JSON 覆盖恢复、CSV 导出
- iOS Web Share 文件分享优先，下载回退

## 数据与离线

正式业务数据只写入当前安装/网址所属的浏览器 `IndexedDB` 数据库 `attendance-pocket-db`。Service Worker 只缓存程序文件，不缓存或上传业务数据。首次通过 HTTPS 成功打开并完成缓存后，可从主屏幕断网启动并完成全部本地业务操作。

请先安装到主屏幕，再录入正式数据；至少每月导出一次 JSON 到“文件”App。清除 Safari 网站数据、删除主屏幕 Web App、改变部署网址/路径或设备损坏都可能令本地数据不可访问。

## 本地运行与检查

静态项目无需安装依赖、无需打包：

```bash
ruby -run -e httpd . -p 8080
# 或者（已安装 Python 时）
python3 -m http.server 8080
```

访问 `http://localhost:8080/`。localhost 属于浏览器安全上下文，可注册 Service Worker。

运行静态完整性检查：

```bash
ruby tests/validate_pwa.rb
```

## 版本更新策略

- 页面与静态资源使用版本号 `v=7`；缓存名为 `attendance-pocket-shell-v7`。
- 每次启动、回到前台或手动点击“检查应用更新”时，浏览器都会绕过 HTTP 缓存检查 `sw.js`。
- 新 Service Worker 安装完成后不会突然打断录入；页面显示“新版本已准备好”，用户点击“立即刷新”后切换版本。
- 激活新版本时自动删除旧的 AttendancePocket 程序缓存；IndexedDB 业务数据不受影响。
- 发布新版本时需同时递增 HTML 资源版本、`sw.js` 缓存名和 `APP_VERSION`。

## 原生 iPhone 版（保留）

用 Xcode 打开 `iOS/AttendancePocket.xcodeproj`，选择自己的签名 Team 和 iPhone 后运行。原生版继续使用持久化的 `WKWebsiteDataStore.default()`；数据位于原生 App 沙盒，与 Safari/PWA 的 IndexedDB 彼此独立。卸载原生 App 前也必须导出 JSON。

免费 Apple ID 安装通常需要定期重新签名；原工程没有被删除或改写为 PWA。若不想使用 PWA，可继续按原方式打开 Xcode 工程。详见 [DEPLOYMENT.md](DEPLOYMENT.md)。
