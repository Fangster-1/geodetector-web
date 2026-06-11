# AGENTS.md

## 项目概述

R plumber 后端 + 纯静态前端（无构建步骤）。地理探测器（GD 包）计算在 R 侧完成，所有图表由浏览器端 ECharts 渲染。

## 启动与运行

```bat
# Windows 双击启动（自动杀旧进程、轮询端口、打开浏览器）
启动网站.bat

# 手动启动
"D:\Program Files\R\R-4.5.2\bin\Rscript.exe" run_app.R
# 访问 http://127.0.0.1:8765/index.html
```

- 冷启动需 15~30 秒（R 包加载），端口 `8765`
- R 依赖：`plumber, GD, readxl, jsonlite, car`
- 前端库已本地化到 `www/lib/`（echarts、jszip），完全离线可用

## 架构要点

```
run_app.R              → 启动入口，注入 APP_ROOT 全局变量，挂载 plumber + 静态文件
api/plumber.R          → API 路由（/api/upload, /api/stats, /api/run, /api/run_start 等）
api/core.R             → 核心计算：文件读取、数据清洗、统计检验、地理探测四类分析
www/index.html         → 单页应用，5 个步骤页面
www/js/app.js          → 前端逻辑、API 调用、批量导出（814 行）
www/js/charts.js       → 制图引擎：6 类图表的 ECharts 构建与样式系统（864 行）
www/css/style.css      → 样式（158 行）
_testdata/             → 示例 CSV 数据，可删除
```

## 关键实现细节

- **APP_ROOT 注入**：`run_app.R` 将自身目录赋给 `globalenv()`，`plumber.R` 和 `core.R` 通过它定位文件。修改启动方式时必须保留此机制
- **后台计算**：地理探测通过 `callr::r_bg` 在子进程中执行，前端轮询 `/api/run_poll` 获取进度。子进程 stdout/stderr 重定向到临时文件防止管道阻塞
- **数据存储**：`STORE` 是 R 环境对象（内存），上传的文件和任务状态全部存在内存中，重启服务即丢失
- **CSV 编码**：先尝试 UTF-8-BOM，检测到乱码自动回退 GBK
- **前端无构建**：直接编辑 `www/` 下的文件，刷新浏览器即生效

## 编辑注意事项

- 所有 R 文件顶部有 `encoding = "UTF-8"` source 声明，保存时确保 UTF-8 编码
- `api/core.R` 中 `run_geodetector` 的 `progress_file` 参数用于实时进度，修改计算流程时需保留 `note()` 调用
- `www/js/charts.js` 中的 `PALETTES` 对象定义了 11 套色带，新增色带在此处添加
- 前端使用原生 JS（无框架），`$` 和 `$$` 是 querySelector 简写（`app.js:5-6`）
- `启动网站.bat` 使用英文提示避免 Windows 代码页问题，修改时保持英文

## 无以下设施

- 无测试套件、无 lint、无 typecheck、无 CI
- 无 package.json / lockfile / 依赖管理
- 无数据库（全部内存存储）
