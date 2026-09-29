# PWA 0 成本部署与 iPhone 安装

## 为什么首次访问仍需要托管

iPhone Safari 只有在访问一个 HTTPS 网站后，才能把它添加到主屏幕并让 Service Worker 缓存离线程序。手机无法凭空访问只存在于电脑文件夹里的页面；`file://` 文件也不能可靠注册 Service Worker。因此，“完全不依赖任何外部托管且仍由 Safari 首次访问”不可行。

托管这里只负责发送 HTML/CSS/JavaScript/图标，不保存考勤数据。正式数据始终留在该 iPhone 的 IndexedDB。

## 方案 A：GitHub Pages（推荐，公开源码，长期 0 成本）

1. 新建一个 GitHub 仓库，把本目录的全部文件上传到仓库根目录。
2. 打开仓库 `Settings → Pages`，在 `Build and deployment` 中选择 `GitHub Actions`。
3. 仓库已带 `.github/workflows/pages.yml`；提交后等待 `Deploy static PWA` 完成。
4. Pages 会给出 `https://你的用户名.github.io/仓库名/`。始终使用同一个网址和路径。

适合：愿意让程序源码公开。GitHub Pages 不需要域名、服务器或数据库。若使用私有仓库，应先核对自己账号当时的 Pages 权限与额度。

## 方案 B：Cloudflare Pages（免费静态站点，可连接私有仓库）

1. 注册免费 Cloudflare 账号，进入 `Workers & Pages → Create → Pages`。
2. 连接包含本目录的 GitHub 仓库，或使用 Direct Upload 上传本目录。
3. Framework preset 选 `None`；Build command 留空；Output directory 填仓库根目录 `.`。
4. 发布后使用平台给出的 `https://项目名.pages.dev/`。

项目中的 `_headers` 会让 Cloudflare 对入口和 Service Worker 禁用长期 HTTP 缓存，减少旧版本滞留。免费额度足够这种小型静态工具；业务数据不会进入 Cloudflare。

## iPhone 添加到主屏幕

1. iPhone 联网，用 **Safari** 打开部署后的 HTTPS 网址。
2. 等待首页正常显示；可先切到“设置 → 离线与版本”，确认版本信息。
3. 点击 Safari 工具栏的“分享”按钮。
4. 向下滑并选择“添加到主屏幕”，名称可保留“个人考勤”。
5. 如果系统显示“作为 Web App 打开 / Open as Web App”，将它打开，再点击“添加”。
6. 回到桌面，从新图标打开一次。建议此后只从该图标录入正式数据。
7. 做一次测试记录和 JSON 导出，再开启飞行模式并从任务切换器完全关闭后重开，确认离线启动。

## 备份与恢复

- 导出：`设置 → 备份与恢复 → 导出完整 JSON 备份`。支持的 iOS 版本会直接打开分享面板，可选择“存储到‘文件’”；不支持文件分享时会回退为 Safari 下载。
- 恢复：`导入 JSON 备份`，从“文件”选择 `.json`。导入会显示人数和记录数并要求确认，然后覆盖当前数据库。
- CSV：只用于在表格中查看，不包含完整恢复语义，不能代替 JSON。
- 更换网址、托管平台或路径前，先导出 JSON；在新网址安装后再导入。

## 联网与费用

- 需要联网：第一次打开网址、安装前缓存程序、检查/获取新版本、切换到新的部署网址。
- 不需要联网：安装并成功缓存后启动；人员、记录、月历、统计、词库；JSON 导入；生成 JSON/CSV。
- 后续费用：本项目本身为 0；使用上述免费静态托管、自带子域名且不超出平台免费政策时，无 Apple Developer 年费、域名费、数据库费或服务器费。平台的免费政策未来可能调整，项目不绑定任何一家，可随时迁移并用 JSON 恢复。

## 回滚与原生版

- PWA 程序回滚：把上一版静态文件重新发布，并使用一个新的缓存名（例如 `attendance-pocket-shell-v6`），让浏览器把它识别为一次更新；不要把缓存名倒回旧值。
- 数据回滚：导入此前导出的 JSON（会覆盖当前数据）。
- 原生版：完整保留在 `iOS/`。用 Xcode 打开 `iOS/AttendancePocket.xcodeproj` 即可继续安装；它和 PWA 的数据各自在独立沙盒中，迁移时用 JSON 导出/导入。
