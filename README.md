# 地理探测器分析与制图平台 / GeoDetector Analysis & Plotting Platform

**[中文说明](#中文说明) | [English](#english)**

---

## 中文说明

基于 **R plumber（计算后端）+ ECharts（前端制图）** 的本地网站。计算与绘图彻底分离：
GD 包负责 OPGD 地理探测计算（因子 / 交互 / 生态 / 风险探测 + 离散化参数寻优），所有图表在浏览器中重写渲染——改样式即时生效、无需重算，并可高分辨率导出。

### 环境配置

1. **安装 R**（建议 ≥ 4.2）：从 [CRAN](https://cran.r-project.org/) 下载安装。
2. **安装依赖包**（打开 R 或 RStudio 执行一次）：

   ```r
   install.packages(c("plumber", "GD", "readxl", "jsonlite", "car", "callr"))
   ```

3. **（仅 Windows 启动器）** 用记事本打开 `启动网站.bat`，把顶部 `RSCRIPT=` 行改成你机器上 `Rscript.exe` 的实际路径，例如：

   ```bat
   set "RSCRIPT=D:\Program Files\R\R-4.5.2\bin\Rscript.exe"
   ```

前端库（ECharts、JSZip）已本地化到 `www/lib/`，无需 Node.js、无需构建步骤，完全离线可用。

### 启动方式

| 方式 | 操作 |
|---|---|
| Windows 一键启动 | 双击 **`启动网站.bat`**（自动重启服务、轮询端口、打开浏览器） |
| 手动启动 | `Rscript run_app.R`，然后浏览器访问 <http://127.0.0.1:8765/index.html> |
| Docker | `docker build -t geodetector-web . && docker run -p 8765:8765 geodetector-web` |

冷启动（R 包加载）约需 15~30 秒；关闭名为 “GD-Server” 的 R 窗口即停止服务。端口可用环境变量 `PORT` 修改（默认 8765）。

### 使用教程（按页面流程）

**① 数据上传**

- 支持 CSV / Excel 多文件批量上传（自动识别 UTF-8 / GBK 编码，`<空>` 自动转 NA）。
- **面板数据自动解析（宽表拆分）**：若上传的表格表头为「变量_年份」宽表格式（如 `y_2020`、`pop_2024`、`GDP2015`），系统会自动检测并弹出「面板数据自动解析」卡片：
  1. 系统自动分离 **动态变量**（带年份，如 `tmp`、`pre`、`pop`）与 **静态变量**（不随时间变化，如 `dem`、`Slope`）；
  2. 勾选要提取的 **年份**（默认全选）；
  3. 选择 **因变量 Y**（单选，动态或静态均可）；
  4. 按需要的顺序点击 **自变量 X**——点击顺序即 `x1, x2, x3…` 的命名顺序，再次点击可取消；
  5. 点击「拆分为年度数据集」：每个年份生成一个数据集（如 `原始表格_2020.csv`），列自动重命名为 `y, x1~xn`，**变量角色同步自动设置**，可直接进行后续统计检验与探测。某年份若缺少所选变量列会自动跳过并提示。
- 普通（非面板）数据：上传后在「变量角色设置」中为每列指定 Y / 连续X / 分类X / 忽略；列名本身为 `y, x1~xn` 时可一键自动识别。

**② 统计检验**：描述统计与方差检测（零方差预警）、共线性检测（VIF + 容忍度，≥5 / ≥10 分级预警）、相关性分析（Pearson / Spearman + 显著性），自动汇总预警。建议在探测前运行。

**③ 地理探测**：OPGD 参数（equal / natural / quantile / geometric / sd 共 5 种离散化方法 × 自定义分级数范围自动寻优）、Y=0 剔除、超量随机抽样。单文件运行或全部文件批量运行，实时进度与日志；计算在独立 R 子进程（callr）中执行，可随时点「停止」终止，已完成结果保留。

**④ 制图中心**：6 类图表（因子探测、交互探测热图、离散化寻优全过程、生态探测、风险探测、相关性热图）+ Origin 式样式控制台——标题 / 坐标轴 / 标签 / 图例色标 / 11 套 SCI 色带 + 自定义色带 / 画布尺寸全部可调，变量显示名映射，样式自动保存。支持当前图导出（PNG / JPG / SVG，分辨率可调）和全部文件 × 全部图表一键打包 ZIP。

**⑤ 结果表格**：12 类结果表（清洗报告、因子 q 值、综合版交互作用表、生态、离散化最优参数与寻优全过程、风险分区均值与显著性矩阵、统计检验各表），单表导出 CSV（带 UTF-8 BOM，Excel 直接打开）或全部打包 ZIP。

### 项目结构

```
geodetector-web/
├── run_app.R          # 启动脚本（plumber，端口 8765）
├── 启动网站.bat        # Windows 双击启动
├── Dockerfile         # Docker / Render 部署
├── api/
│   ├── plumber.R      # API 路由（/api/upload /api/panel_split /api/stats /api/run_* ）
│   └── core.R         # 核心计算：读取/面板解析/清洗/统计检验/optidisc+gd+gdinteract+gdeco+gdrisk
├── www/               # 前端（纯静态，无需构建）
│   ├── index.html
│   ├── css/style.css
│   ├── js/charts.js   # 制图引擎：6 类图表的自适应默认值 / 样式 schema / ECharts 构建
│   ├── js/app.js      # 页面逻辑、面板拆分 UI、API 调用、批量导出
│   └── lib/           # echarts.min.js, jszip.min.js（本地化，离线可用）
└── _testdata/         # 本地测试数据（不入库）
```

### 数据格式要求

- **整理好的数据**：包含因变量列与若干自变量列（列名任意，上传后指定角色；`y, x1~xn` 可自动识别）。
- **面板宽表**：时间序列变量命名为 `变量名_年份` 或 `变量名年份`（如 `GDP_2015`、`pop2020`），上传后自动进入面板解析流程。
- 批量处理时各文件需包含相同的变量列；空值可用 `<空>` 表示，含缺失的行自动剔除。

### 常见问题

1. **浏览器显示“无法访问此网站”**：R 冷启动需 15~30 秒，刷新即可。
2. **GD-Server 窗口一闪而过**：R 包未装齐，执行 `install.packages(c("plumber","GD","readxl","jsonlite","car","callr"))`。
3. **bat 报 `Rscript not found`**：修改 bat 顶部 `RSCRIPT=` 为实际路径。
4. **端口 8765 被占用**：bat 会自动杀掉旧进程重启；手动启动时可设 `PORT` 环境变量换端口。

---

## English

A local web application for **GeoDetector (OPGD) analysis and publication-quality plotting**, built on an **R plumber backend + ECharts frontend**. Computation and plotting are fully decoupled: the R `GD` package performs factor / interaction / ecological / risk detection with optimal discretization parameter search, while all charts are re-rendered in the browser — style changes apply instantly without recomputation, and everything exports at high resolution.

### Environment Setup

1. **Install R** (≥ 4.2 recommended) from [CRAN](https://cran.r-project.org/).
2. **Install required packages** (run once in R / RStudio):

   ```r
   install.packages(c("plumber", "GD", "readxl", "jsonlite", "car", "callr"))
   ```

3. **(Windows launcher only)** Edit `启动网站.bat` and set the `RSCRIPT=` line at the top to your actual `Rscript.exe` path.

Frontend libraries (ECharts, JSZip) are vendored in `www/lib/` — no Node.js, no build step, fully offline-capable.

### Running

| Method | Command |
|---|---|
| Windows one-click | Double-click **`启动网站.bat`** (restarts the service, waits for the port, opens the browser) |
| Manual | `Rscript run_app.R`, then open <http://127.0.0.1:8765/index.html> |
| Docker | `docker build -t geodetector-web . && docker run -p 8765:8765 geodetector-web` |

Cold start takes 15–30 s (R package loading). Close the “GD-Server” R window to stop. Port is configurable via the `PORT` environment variable (default 8765).

### Usage Walkthrough

**① Data Upload**

- Batch-upload CSV / Excel files (UTF-8 / GBK auto-detected; `<空>` treated as NA).
- **Automatic panel-data parsing (wide-table splitting)**: if the uploaded table uses "variable_year" wide-format headers (e.g. `y_2020`, `pop_2024`, `GDP2015`), the app detects it automatically and shows a panel-parsing card:
  1. Columns are auto-classified into **dynamic variables** (year-suffixed, e.g. `tmp`, `pre`, `pop`) and **static variables** (time-invariant, e.g. `dem`, `Slope`);
  2. Tick the **years** to extract (all selected by default);
  3. Pick the **dependent variable Y** (dynamic or static);
  4. Click **explanatory variables X** in the order you want — the click order becomes `x1, x2, x3…`; click again to deselect;
  5. Hit "Split into yearly datasets": one dataset per year is created (e.g. `mytable_2020.csv`) with columns renamed to `y, x1~xn`, and variable roles are set automatically — ready for statistics and detection. Years missing a selected column are skipped with a notice.
- Regular (non-panel) data: assign a role (Y / continuous X / categorical X / ignore) to each column; columns already named `y, x1~xn` can be auto-detected in one click.

**② Statistical Checks**: descriptive statistics with zero-variance warning, multicollinearity check (VIF + tolerance with ≥5 / ≥10 alert levels), correlation analysis (Pearson / Spearman with significance), and an automatic warning summary. Recommended before detection.

**③ GeoDetector Run**: OPGD parameters (5 discretization methods — equal / natural / quantile / geometric / sd — × custom interval-number range, auto-optimized), optional Y=0 removal, random subsampling for oversized data. Run a single file or all files in batch with live progress and logs; computation runs in a separate R subprocess (callr) and can be stopped at any time, keeping finished results.

**④ Plotting Center**: 6 chart types (factor detection, interaction heatmap, discretization optimization process, ecological detection, risk detection, correlation heatmap) with an Origin-style style console — titles / axes / labels / legends & color bars / 11 SCI palettes + custom palette editor / canvas size, plus display-name mapping for variables; styles persist automatically. Export the current chart (PNG / JPG / SVG, adjustable resolution) or batch-export all files × all charts as a ZIP.

**⑤ Result Tables**: 12 result tables (cleaning report, factor q-values, comprehensive interaction table, ecological detection, optimal discretization parameters and full search process, risk-zone means and significance matrix, statistical tables), exportable as single CSVs (UTF-8 BOM, Excel-ready) or one ZIP.

### Project Layout

```
geodetector-web/
├── run_app.R          # entry point (plumber, port 8765)
├── 启动网站.bat        # Windows one-click launcher
├── Dockerfile         # Docker / Render deployment
├── api/
│   ├── plumber.R      # API routes (/api/upload /api/panel_split /api/stats /api/run_*)
│   └── core.R         # core computation: file reading / panel parsing / cleaning / stats / GD detection
├── www/               # frontend (pure static, no build step)
│   ├── index.html
│   ├── css/style.css
│   ├── js/charts.js   # chart engine: adaptive defaults / style schema / ECharts builders
│   ├── js/app.js      # page logic, panel-split UI, API calls, batch export
│   └── lib/           # echarts.min.js, jszip.min.js (vendored, offline)
└── _testdata/         # local test data (not committed)
```

### Data Format

- **Pre-arranged data**: one dependent column plus explanatory columns (any names; assign roles after upload; `y, x1~xn` auto-detected).
- **Wide-format panel data**: name time-series variables as `name_year` or `nameyear` (e.g. `GDP_2015`, `pop2020`) and the panel parser will take over after upload.
- For batch processing, all files must share the same columns; missing values can be written as `<空>` and incomplete rows are dropped automatically.

### Troubleshooting

1. **Browser says the site can't be reached** — cold start takes 15–30 s; refresh.
2. **GD-Server window closes instantly** — missing R packages; run `install.packages(c("plumber","GD","readxl","jsonlite","car","callr"))`.
3. **`Rscript not found` from the launcher** — fix the `RSCRIPT=` path at the top of the bat file.
4. **Port 8765 occupied** — the launcher kills the old process automatically; for manual runs set the `PORT` environment variable.
