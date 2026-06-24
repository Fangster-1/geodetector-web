/* ==============================================================
 * 制图引擎 v2：每种图表拥有完整独立样式集
 * - 全局仅控制：字体、导出格式、导出分辨率
 * - 每图独立：标题/坐标轴/数值标签/图例色标/色带(含自定义)/布局/画布
 * ============================================================== */

const PALETTES = {
  "经典蓝红":   ["#0c5496", "#73a9d1", "#e3eff6", "#f49695", "#e63536"],
  "NPG (Nature)": ["#3C5488", "#4DBBD5", "#00A087", "#F39B7F", "#E64B35"],
  "JCO":        ["#0073C2", "#7AA6DC", "#EFC000", "#CD534C", "#868686"],
  "Lancet":     ["#00468B", "#0099B4", "#42B540", "#925E9F", "#ED0000"],
  "Spectral":   ["#5E4FA2", "#3288BD", "#66C2A5", "#FDAE61", "#D53E4F"],
  "Viridis":    ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  "RdBu (相关性)": ["#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b"],
  "RdYlBu (蓝黄红)": ["#4575b4", "#74add1", "#abd9e9", "#e0f3f8", "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027"],
  "蓝橙红(GD论文)": ["#3b6ea5", "#6ba3c8", "#a9cfe3", "#dceaf2", "#f7f0e6", "#fbd9a8", "#f3a460", "#dd6a3e", "#b8332a"],
  "深红青": ["#2a6b7e", "#4d93a3", "#a9cdd6", "#dde9ec", "#ececec", "#f4cdd8", "#dd7a98", "#c13862", "#9e1b42"],
  "蓝橙渐变": ["#2c7bb6", "#74add1", "#abd9e9", "#e8f3f6", "#fdf2e0", "#fdc980", "#fa9a4e", "#e96030", "#c2331f"],
  "热力红":     ["#fff5f0", "#fcbba1", "#fb6a4a", "#cb181d", "#67000d"],
  "蓝绿":       ["#f7fcf0", "#ccebc5", "#7bccc4", "#2b8cbe", "#084081"],
  "大地色":     ["#543005", "#bf812d", "#f6e8c3", "#80cdc1", "#003c30"],
  "紫橙":       ["#542788", "#998ec3", "#f7f7f7", "#fdb863", "#b35806"]
};

const FONT_OPTIONS = [
  ["中文宋体 + 英文新罗马 (推荐)", '"Times New Roman", SimSun'],
  ["中文黑体 + 英文Arial", 'Arial, SimHei'],
  ["全部宋体", "SimSun"],
  ["全部 Times New Roman", '"Times New Roman"'],
  ["全部黑体", "SimHei"],
  ["微软雅黑", '"Microsoft YaHei"'],
  ["Arial", "Arial"]
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (v, d) => (v == null || isNaN(v)) ? "" : Number(v).toFixed(d);
function sigStars(p) {
  if (p == null || isNaN(p)) return "";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "";
}

/* ---------------- 色带工具（支持自定义色带） ---------------- */
function paletteOf(st) {
  let arr;
  if (st.palette === "__custom__") {
    arr = (st.customColors && st.customColors.length >= 2)
      ? st.customColors.slice()
      : ["#0c5496", "#e3eff6", "#e63536"];
  } else {
    arr = (PALETTES[st.palette] || PALETTES["经典蓝红"]).slice();
  }
  return st.reverse ? arr.reverse() : arr;
}
function hex2rgb(h) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function lerpPalette(colors, t) {
  t = clamp(t, 0, 1);
  if (colors.length === 1) return colors[0];
  const seg = (colors.length - 1) * t, i = Math.min(Math.floor(seg), colors.length - 2), f = seg - i;
  const a = hex2rgb(colors[i]), b = hex2rgb(colors[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* ---------------- 全局样式（仅字体 + 导出） ---------------- */
function globalDefaults() {
  return {
    fontFamily: '"Times New Roman", SimSun',
    exportFormat: "png",
    dpi: 600                 // 导出分辨率（DPI），导出时 pixelRatio = dpi/96
  };
}
// 由 DPI 换算导出像素倍率（以屏幕 96dpi 为基准）
function dpiToRatio(g) { return Math.max(0.5, (g.dpi || (g.pixelRatio ? g.pixelRatio * 96 : 600)) / 96); }
const GLOBAL_SCHEMA = [
  { k: "fontFamily", label: "字体（中英文混排）", t: "sel", opts: FONT_OPTIONS },
  { k: "exportFormat", label: "导出图片格式", t: "sel", opts: [["PNG (位图,推荐)", "png"], ["JPG (位图)", "jpeg"], ["SVG (矢量,可AI编辑)", "svg"]] },
  { k: "dpi", label: "导出分辨率 DPI", t: "num", min: 72, max: 1200, step: 50 }
];

/* 文本样式快捷函数：g=全局(字体)，size、color 来自每图样式 */
const TS = (g, size, color, extra) => Object.assign(
  { fontFamily: g.fontFamily, fontSize: size, color: color || "#000" }, extra || {});

function titleStyle(g, st) {
  return { fontFamily: g.fontFamily, fontSize: st.titleSize, color: st.titleColor,
           fontWeight: st.titleBold ? "bold" : "normal" };
}

/* ============================================================
 * 通用样式系统：标题 / 坐标轴 / 边距 / 数值标签 / 图例 / 色彩 / 画布
 * 每个图都复用，保证“所有元素都可自定义”
 * ============================================================ */

/* ---- 通用默认值（标题/数值标签/图例/边距/色彩/背景） ---- */
function commonDefaults(ctx, over) {
  return Object.assign({
    // 标题
    titleShow: true, titleText: "", titleSize: 20, titleColor: "#000000",
    titleBold: true, titlePos: "center", titleTop: 8,
    // 数值标签（柱顶/格内的数字）
    labelSize: clamp(Math.round(17 - 0.45 * ctx.n), 9, 15), labelColor: "#000000", decimals: 3,
    // 图例 / 色标
    legendSize: 13,
    // 色彩
    palette: "经典蓝红", reverse: false,
    customColors: ["#0c5496", "#73a9d1", "#e3eff6", "#f49695", "#e63536"],
    bgColor: "#ffffff",
    // 绘图区边距（自动 / 手动）
    marginAuto: true, gridLeft: 80, gridRight: 45, gridTop: 60, gridBottom: 70
  }, over || {});
}

/* ---- 单个坐标轴的默认值（prefix='x'/'y'/'cat'/'val'） ---- */
function axisDefaults(prefix, kind, over) {
  const baseSize = 14;
  const d = {};
  d[prefix + "Name"] = "";                      // 轴标题文字
  d[prefix + "NameSize"] = baseSize + 1;
  d[prefix + "NameColor"] = "#000000";
  d[prefix + "NameGap"] = kind === "cat" ? 34 : 50;
  d[prefix + "LabelShow"] = true;               // 刻度标签
  d[prefix + "LabelSize"] = baseSize;
  d[prefix + "LabelColor"] = "#000000";
  d[prefix + "LabelRotate"] = 0;
  d[prefix + "LineShow"] = true;                // 轴线
  d[prefix + "LineWidth"] = 1;
  d[prefix + "LineColor"] = "#000000";
  d[prefix + "TickShow"] = true;                // 刻度线
  d[prefix + "TickLen"] = 5;
  d[prefix + "SplitShow"] = kind === "val";     // 网格线
  d[prefix + "SplitColor"] = "#e3e8ee";
  if (kind === "val") { d[prefix + "Min"] = ""; d[prefix + "Max"] = ""; }
  return Object.assign(d, over || {});
}

/* ---- 单个坐标轴的样式控件（分组名默认为 “X轴/Y轴” 等） ---- */
function axisSchema(prefix, groupLabel, kind) {
  const g = groupLabel;
  const s = [
    { k: prefix + "LineShow", label: "显示整条坐标轴", t: "chk", g },
    { k: prefix + "Name", label: "轴标题文字", t: "txt", g },
    { k: prefix + "NameSize", label: "轴标题字号", t: "num", min: 6, max: 36, g },
    { k: prefix + "NameColor", label: "轴标题颜色", t: "color", g },
    { k: prefix + "NameGap", label: "轴标题距轴", t: "num", min: 0, max: 140, g },
    { k: prefix + "LabelShow", label: "显示刻度标签", t: "chk", g },
    { k: prefix + "LabelSize", label: "刻度标签字号", t: "num", min: 6, max: 32, g },
    { k: prefix + "LabelColor", label: "刻度标签颜色", t: "color", g },
    { k: prefix + "LabelRotate", label: "刻度标签旋转°", t: "num", min: -90, max: 90, g },
    { k: prefix + "LineWidth", label: "轴线宽度", t: "num", min: 0.5, max: 8, step: 0.5, g },
    { k: prefix + "LineColor", label: "轴线颜色", t: "color", g },
    { k: prefix + "TickShow", label: "显示刻度线", t: "chk", g },
    { k: prefix + "TickLen", label: "刻度线长度", t: "num", min: 0, max: 20, g },
    { k: prefix + "SplitShow", label: "显示网格线", t: "chk", g },
    { k: prefix + "SplitColor", label: "网格线颜色", t: "color", g }
  ];
  if (kind === "val") {
    s.push({ k: prefix + "Min", label: "最小值(空=自动)", t: "txt", g });
    s.push({ k: prefix + "Max", label: "最大值(空=自动)", t: "txt", g });
  }
  return s;
}

/* ---- 由样式生成一个完整的 ECharts 坐标轴对象 ---- */
function buildAxis(g, st, prefix, base) {
  base = base || {};
  const ax = {
    // “显示坐标轴”为整轴总开关：关闭则该轴（轴线+刻度+标签+轴标题）整体隐藏
    show: st[prefix + "LineShow"] !== false,
    type: base.type || "category",
    axisLabel: TS(g, base.labelSize != null ? base.labelSize : st[prefix + "LabelSize"],
                  st[prefix + "LabelColor"],
                  { show: st[prefix + "LabelShow"] !== false, rotate: st[prefix + "LabelRotate"] || 0 }),
    axisLine: { show: st[prefix + "LineShow"] !== false,
                lineStyle: { color: st[prefix + "LineColor"], width: st[prefix + "LineWidth"] } },
    axisTick: { show: st[prefix + "TickShow"] !== false, length: st[prefix + "TickLen"],
                lineStyle: { color: st[prefix + "LineColor"] } },
    splitLine: { show: !!st[prefix + "SplitShow"],
                 lineStyle: { color: st[prefix + "SplitColor"], type: "dashed" } }
  };
  if (base.isCat) ax.axisTick.alignWithLabel = true;
  if (base.data) ax.data = base.data;
  if (base.inverse) ax.inverse = true;
  if (base.position) ax.position = base.position;
  if (base.gridIndex != null) ax.gridIndex = base.gridIndex;
  if (base.labelExtra) ax.axisLabel = Object.assign(ax.axisLabel, base.labelExtra);
  // 轴标题
  const nameText = base.name != null ? base.name : st[prefix + "Name"];
  if (nameText) {
    ax.name = nameText;
    ax.nameLocation = "middle";
    ax.nameGap = base.nameGap != null ? base.nameGap : st[prefix + "NameGap"];
    ax.nameTextStyle = TS(g, base.nameSize != null ? base.nameSize : st[prefix + "NameSize"],
                          st[prefix + "NameColor"], { fontWeight: "bold" });
  }
  // 数值轴范围
  if (ax.type === "value") {
    const mn = parseFloat(st[prefix + "Min"]); const mx = parseFloat(st[prefix + "Max"]);
    if (!isNaN(mn)) ax.min = mn;
    if (!isNaN(mx)) ax.max = mx;
    else if (base.autoMax != null) ax.max = base.autoMax;
    if (isNaN(mn) && base.autoMin != null) ax.min = base.autoMin;
  }
  return ax;
}

/* ---- 标题对象 ---- */
function buildTitle(g, st, defText) {
  if (!st.titleShow) return undefined;
  return {
    text: st.titleText || defText,
    left: st.titlePos || "center",
    top: st.titleTop != null ? st.titleTop : 8,
    textStyle: titleStyle(g, st)
  };
}

/* ---- 绘图区边距（自动则用 auto，手动则用用户设定） ---- */
function buildGrid(st, autoGrid) {
  if (st.marginAuto === false) {
    return { left: st.gridLeft, right: st.gridRight, top: st.gridTop, bottom: st.gridBottom, containLabel: false };
  }
  return autoGrid;
}

/* ---- 自定义色标（无缝拼接色块 + 刻度标签），返回 graphic 元素数组 ----
 * geo: { x, y, len, thick, orient('vertical'|'horizontal'), min, max, endpointsOnly }
 * 连续：用许多薄块拟合平滑渐变；分段：vmPieces 个紧贴色块；均无空白。
 * endpointsOnly=true 时只标注首尾两个数值（用于空白三角区的小色标）。 */
function buildColorbar(g, st, geo) {
  const els = [];
  const pal = paletteOf(st);
  const vert = geo.orient === "vertical";
  const piece = st.vmType === "piecewise";
  const nSeg = piece ? Math.max(2, st.vmPieces) : 96;
  const dec = Math.min(st.decimals, 3);
  const font = `${st.legendSize}px ${g.fontFamily}`;
  const fill = st.xLabelColor || "#000";
  // 色块：相邻块重叠 0.6px 杜绝亚像素缝隙
  for (let i = 0; i < nSeg; i++) {
    const tc = piece ? (nSeg > 1 ? i / (nSeg - 1) : 0.5) : (i + 0.5) / nSeg;
    const col = lerpPalette(pal, tc);
    let rx, ry, rw, rh;
    if (vert) { rh = geo.len / nSeg; rw = geo.thick; rx = geo.x; ry = geo.y + geo.len - (i + 1) * rh; }
    else { rw = geo.len / nSeg; rh = geo.thick; rx = geo.x + i * rw; ry = geo.y; }
    els.push({ type: "rect", silent: true, z: 6,
      shape: { x: rx, y: ry, width: rw + 0.6, height: rh + 0.6 }, style: { fill: col } });
  }
  // 色标外框
  els.push({ type: "rect", silent: true, z: 7,
    shape: { x: geo.x, y: geo.y, width: vert ? geo.thick : geo.len, height: vert ? geo.len : geo.thick },
    style: { fill: "none", stroke: "#555", lineWidth: 0.8 } });
  // 刻度标签：endpointsOnly→只首尾；分段→各边界值；连续→等分 5 段共 6 个刻度
  const nLab = geo.endpointsOnly ? 1 : (piece ? nSeg : 5);
  for (let k = 0; k <= nLab; k++) {
    const val = geo.min + (geo.max - geo.min) * (k / nLab);
    if (vert) {
      const ty = geo.y + geo.len - (k / nLab) * geo.len;
      els.push({ type: "text", z: 7, left: geo.x + geo.thick + 6, top: ty,
        style: { text: val.toFixed(dec), textVerticalAlign: "middle", textAlign: "left", font, fill } });
      els.push({ type: "line", silent: true, z: 7,
        shape: { x1: geo.x + geo.thick, y1: ty, x2: geo.x + geo.thick + 4, y2: ty }, style: { stroke: fill, lineWidth: 0.8 } });
    } else {
      const tx = geo.x + (k / nLab) * geo.len;
      els.push({ type: "text", z: 7, left: tx, top: geo.y + geo.thick + 5,
        style: { text: val.toFixed(dec), textVerticalAlign: "top", textAlign: "center", font, fill } });
    }
  }
  return els;
}

/* ---- 通用控件片段 ---- */
const SC_TITLE = [
  { k: "titleShow", label: "显示标题", t: "chk", g: "标题" },
  { k: "titleText", label: "标题文字(空=自动)", t: "txt", g: "标题" },
  { k: "titleSize", label: "标题字号", t: "num", min: 6, max: 60, g: "标题" },
  { k: "titleColor", label: "标题颜色", t: "color", g: "标题" },
  { k: "titleBold", label: "标题加粗", t: "chk", g: "标题" },
  { k: "titlePos", label: "标题水平位置", t: "sel", opts: [["居中", "center"], ["左", "left"], ["右", "right"]], g: "标题" },
  { k: "titleTop", label: "标题垂直偏移(px)", t: "num", min: 0, max: 200, g: "标题" }
];
const SC_LABEL = [
  { k: "labelSize", label: "数值标签字号", t: "num", min: 6, max: 32, g: "数值标签" },
  { k: "labelColor", label: "数值标签颜色", t: "color", g: "数值标签" },
  { k: "decimals", label: "小数位数", t: "num", min: 0, max: 6, g: "数值标签" }
];
const SC_LEGEND = [
  { k: "legendSize", label: "图例/色标字号", t: "num", min: 6, max: 32, g: "图例与色标" }
];
const SC_PALETTE = [
  { k: "palette", label: "色带", t: "palette", g: "色彩" },
  { k: "bgColor", label: "背景色", t: "color", g: "色彩" }
];
const SC_MARGIN = [
  { k: "marginAuto", label: "绘图区边距自动", t: "chk", g: "绘图区边距" },
  { k: "gridLeft", label: "左边距(px)", t: "num", min: 0, max: 600, g: "绘图区边距" },
  { k: "gridRight", label: "右边距(px)", t: "num", min: 0, max: 600, g: "绘图区边距" },
  { k: "gridTop", label: "上边距(px)", t: "num", min: 0, max: 600, g: "绘图区边距" },
  { k: "gridBottom", label: "下边距(px)", t: "num", min: 0, max: 600, g: "绘图区边距" }
];
const SC_CANVAS = [
  { k: "width", label: "画布宽 (px)", t: "num", min: 300, max: 3600, g: "画布" },
  { k: "height", label: "画布高 (px)", t: "num", min: 300, max: 3600, g: "画布" }
];

/* ---------------- 热图按因子数 n 自适应：单元格大小、画布、字号 ----------------
 * 5~16 个因子都给出合理的格子像素，据此自动算画布尺寸与字号。
 * margins 与画布尺寸共用同一套公式，保证 plotW = n*cell 精确成立。 */
function heatmapMetrics(n) {
  const cell = clamp(Math.round(780 / Math.max(n, 1)), 42, 96);  // n=5→96, n=8→88, n=12→65, n=16→49
  return {
    cell,
    plot: n * cell,
    labelSize: clamp(Math.round(cell * 0.30), 13, 24),   // 坐标轴/对角线标签
    valueSize: clamp(Math.round(cell * 0.27), 11, 20),   // 格内数值
    titleSize: clamp(Math.round(cell * 0.34 + 10), 20, 32)
  };
}
// 交互热图的绘图区边距（依标签模式 / 色标位置 / n），自适应与 build 共用
function imMargins(st, n) {
  const m = heatmapMetrics(n);
  const diagMode = st.labelMode === "diagonal";
  const showY = !diagMode && st.yLineShow !== false;   // 坐标轴模式且 Y 轴未隐藏
  const showX = !diagMode && st.xLineShow !== false;
  // 底部列变量名：坐标轴模式看 X 轴开关；对角线模式也在底部显示“另一组变量”
  const showColLabels = diagMode || showX;
  const rot = Math.abs(st.xLabelRotate || 0);
  const colBase = showColLabels ? (rot > 60 ? m.labelSize * 4.0 : rot > 25 ? m.labelSize * 3.0 : m.labelSize * 1.9) : 0;
  return {
    left:   diagMode ? 34 : (showY ? Math.round(m.labelSize * 4.0 + 28) : 50),
    right:  st.vmPos === "right" ? Math.round(m.labelSize * 3.6 + 64) : (diagMode ? Math.round(m.labelSize * 4 + 20) : 46),
    top:    st.titleShow ? m.titleSize + 46 : 28,
    bottom: Math.round(colBase + 30) + (st.showCaption ? 26 : 0) +
            (st.vmPos === "bottom" ? Math.round(m.labelSize * 3.2) : 0)
  };
}
// 渲染前写回交互热图的自适应画布与字号（保留用户的其它样式）
function applyInteractionAutoSize(st, n) {
  if (st.autoSize === false) return;
  const m = heatmapMetrics(n), mar = imMargins(st, n);
  st.width = m.plot + mar.left + mar.right;
  st.height = m.plot + mar.top + mar.bottom;
  st.titleSize = m.titleSize;
  st.labelSize = m.valueSize;
  st.xLabelSize = m.labelSize; st.yLabelSize = m.labelSize;
  st.legendSize = clamp(m.labelSize - 1, 12, 19);
  st.diagLabelSize = 0;
}

/* ---------------- 多面板网格布局（disc / risk 共用，间距可调） ---------------- */
function panelLayout(nPanel, cols, opt) {
  cols = clamp(cols, 1, nPanel);
  const rows = Math.ceil(nPanel / cols);
  const o = Object.assign({ topPad: 9, leftPad: 6, rightPad: 3, bottomPad: 8, hGap: 6, vGap: 11 }, opt || {});
  const w = (100 - o.leftPad - o.rightPad - (cols - 1) * o.hGap) / cols;
  const h = (100 - o.topPad - o.bottomPad - (rows - 1) * o.vGap) / rows;
  const rects = [];
  for (let i = 0; i < nPanel; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    rects.push({ left: o.leftPad + c * (w + o.hGap), top: o.topPad + r * (h + o.vGap), width: w, height: h });
  }
  return { rects, rows, cols };
}
/* 多面板自动字号：随面板像素高度自适应 */
function panelAutoFont(heightPx, rectHeightPct) {
  const panelH = heightPx * rectHeightPct / 100;
  return clamp(Math.round(panelH * 0.072), 8, 16);
}

/* ============================================================== */
const CHARTS = {

  /* ================ 因子探测柱状图 ================ */
  factor: {
    label: "因子探测",
    defaults(ctx) {
      return Object.assign(commonDefaults(ctx),
        axisDefaults("cat", "cat", { catName: "驱动因子", catNameGap: 38 }),
        axisDefaults("val", "val", { valName: "q 值", valNameGap: 56, valSplitShow: true }),
        {
          orient: "v", sort: "desc",
          colorMode: "gradient", barColor: "#0c5496",
          barWidth: 60, barBorderWidth: 0.6, barBorderColor: "#333333",
          showValues: true, showSig: true, labelPos: "outside",
          showCaption: true, captionText: "注：*** P < 0.001   ** P < 0.01   * P < 0.05",
          width: clamp(120 + ctx.n * 90, 560, 1400), height: 560
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "orient", label: "方向", t: "sel", opts: [["竖向柱状", "v"], ["横向条形", "h"]], g: "图形" },
      { k: "sort", label: "排序", t: "sel", opts: [["按 q 值降序", "desc"], ["按 q 值升序", "asc"], ["原始顺序", "none"]], g: "图形" },
      { k: "colorMode", label: "着色方式", t: "sel", opts: [["按 q 值渐变(色带)", "gradient"], ["统一单色", "single"]], g: "图形" },
      { k: "barColor", label: "单色柱颜色", t: "color", g: "图形" },
      { k: "barWidth", label: "柱宽 (%)", t: "num", min: 10, max: 95, g: "图形" },
      { k: "barBorderWidth", label: "柱边框宽", t: "num", min: 0, max: 6, step: 0.2, g: "图形" },
      { k: "barBorderColor", label: "柱边框色", t: "color", g: "图形" },
      { k: "showValues", label: "显示数值", t: "chk", g: "数值标签" },
      { k: "showSig", label: "显示显著性 (*)", t: "chk", g: "数值标签" },
      { k: "labelPos", label: "数值位置", t: "sel", opts: [["柱外", "outside"], ["柱内顶部", "insideTop"], ["柱内", "inside"]], g: "数值标签" },
      { k: "showCaption", label: "显示注释行", t: "chk", g: "注释" },
      { k: "captionText", label: "注释内容", t: "txt", g: "注释" },
      ...SC_LABEL,
      ...axisSchema("cat", "类目轴 (因子)", "cat"),
      ...axisSchema("val", "数值轴 (q 值)", "val"),
      ...SC_MARGIN,
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const res = payload.result;
      let rows = res.factor.map(f => ({ v: nm(f.variable), q: f.q ?? 0, p: f.p }));
      if (st.sort === "desc") rows.sort((a, b) => b.q - a.q);
      if (st.sort === "asc") rows.sort((a, b) => a.q - b.q);
      const horiz = st.orient === "h";
      if (horiz) rows = rows.slice().reverse();
      const qmax = Math.max(...rows.map(r => r.q), 1e-9);
      const pal = paletteOf(st);
      const catAxis = buildAxis(g, st, "cat", { type: "category", data: rows.map(r => r.v), isCat: true });
      const valAxis = buildAxis(g, st, "val", { type: "value" });
      const valPos = horiz ? "right" : (st.labelPos === "outside" ? "top" : st.labelPos);
      const autoGrid = {
        left: horiz ? 100 : 84, right: 40,
        top: st.titleShow ? st.titleSize + 40 : 30,
        bottom: (horiz ? 62 : ((st.catLabelRotate || 0) > 25 ? 90 : 72)) + (st.showCaption ? 28 : 0)
      };
      const graphics = [];
      if (st.showCaption && st.captionText) graphics.push({
        type: "text", left: autoGrid.left, bottom: 8,
        style: { text: st.captionText,
                 font: `${clamp(st.catLabelSize || 14, 11, 20)}px ${g.fontFamily}`,
                 fill: st.catLabelColor || "#333333" }
      });
      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `单因子探测结果`),
        grid: buildGrid(st, autoGrid),
        graphic: graphics,
        xAxis: horiz ? valAxis : catAxis,
        yAxis: horiz ? catAxis : valAxis,
        series: [{
          type: "bar", barWidth: st.barWidth + "%",
          data: rows.map(r => ({
            value: r.q,
            itemStyle: {
              color: st.colorMode === "gradient" ? lerpPalette(pal, r.q / qmax) : st.barColor,
              borderColor: st.barBorderColor, borderWidth: st.barBorderWidth
            },
            label: {
              show: st.showValues, position: valPos,
              formatter: () => fmt(r.q, st.decimals) + (st.showSig ? sigStars(r.p) : ""),
              ...TS(g, st.labelSize, st.labelColor)
            }
          }))
        }]
      };
    }
  },

  /* ================ 交互探测热图 ================ */
  interaction: {
    label: "交互探测热图",
    defaults(ctx) {
      const m = heatmapMetrics(ctx.n);
      const d = Object.assign(commonDefaults(ctx),
        axisDefaults("x", "cat", { xTickShow: false }),
        axisDefaults("y", "cat", { yTickShow: false }),
        {
          autoSize: true,
          showValues: true, showSymbols: true,
          cellBorderWidth: 1.5, cellBorderColor: "#ffffff",
          labelMode: "axis", yReverse: false, xReverse: false,
          diagHighlight: false, diagFill: "#c0392b", diagBorderColor: "#c0392b",
          diagBorderWidth: 2.5, diagTextColor: "#ffffff", diagLabelSize: 0,
          vmType: "piecewise", vmPieces: 7, vmGap: 0,
          vmPos: "right", vmX: 14, vmY: 18, vmLength: 0, vmWidth: 18, vmOffsetX: 0, vmOffsetY: 0,
          frameShow: true, frameWidth: 1.2, frameColor: "#000000",
          frameTop: true, frameRight: true, frameBottom: true, frameLeft: true,
          showCaption: true, captionText: "注：* 双因子增强，** 非线性增强",
          palette: "蓝橙红(GD论文)",
          titleSize: m.titleSize, labelSize: m.valueSize,
          xLabelSize: m.labelSize, yLabelSize: m.labelSize, legendSize: clamp(m.labelSize - 1, 11, 18),
          width: m.plot + 200, height: m.plot + 150
        });
      return d;
    },
    autoSize(ctx, st) { applyInteractionAutoSize(st, ctx.n); },
    schema: [
      ...SC_TITLE,
      { k: "autoSize", label: "按因子数自适应画布/字号", t: "chk", g: "画布" },
      { k: "labelMode", label: "变量标签模式", t: "sel", opts: [["坐标轴标签", "axis"], ["对角线旁标注", "diagonal"]], g: "图形" },
      { k: "yReverse", label: "Y轴翻转(x1在顶/底)", t: "chk", g: "图形" },
      { k: "xReverse", label: "X轴翻转(x1在左/右)", t: "chk", g: "图形" },
      { k: "xLabelRotate", label: "X轴变量名旋转°", t: "num", min: -90, max: 90, g: "图形" },
      { k: "showValues", label: "显示 q 值", t: "chk", g: "数值标签" },
      { k: "showSymbols", label: "显示增强标记 (*/**)", t: "chk", g: "数值标签" },
      ...SC_LABEL,
      { k: "cellBorderWidth", label: "格子边框宽", t: "num", min: 0, max: 10, step: 0.5, g: "图形" },
      { k: "cellBorderColor", label: "格子边框色", t: "color", g: "图形" },
      { k: "diagHighlight", label: "高亮对角格(单因子)", t: "chk", g: "对角线" },
      { k: "diagFill", label: "对角格填充色", t: "color", g: "对角线" },
      { k: "diagBorderColor", label: "对角格边框色", t: "color", g: "对角线" },
      { k: "diagBorderWidth", label: "对角格边框宽", t: "num", min: 0, max: 8, step: 0.5, g: "对角线" },
      { k: "diagTextColor", label: "对角格数值色", t: "color", g: "对角线" },
      { k: "diagLabelSize", label: "对角线标注字号(0=自动)", t: "num", min: 0, max: 40, g: "对角线" },
      { k: "frameShow", label: "显示外边框", t: "chk", g: "边框" },
      { k: "frameTop", label: "上边框", t: "chk", g: "边框" },
      { k: "frameRight", label: "右边框", t: "chk", g: "边框" },
      { k: "frameBottom", label: "下边框", t: "chk", g: "边框" },
      { k: "frameLeft", label: "左边框", t: "chk", g: "边框" },
      { k: "frameWidth", label: "边框宽度", t: "num", min: 0.5, max: 6, step: 0.2, g: "边框" },
      { k: "frameColor", label: "边框颜色", t: "color", g: "边框" },
      { k: "vmType", label: "色标类型", t: "sel", opts: [["连续渐变", "continuous"], ["分段(离散)", "piecewise"]], g: "图例与色标" },
      { k: "vmPieces", label: "分段段数", t: "num", min: 3, max: 12, g: "图例与色标" },
      { k: "vmPos", label: "色标位置", t: "sel", opts: [["右侧(对齐边框)", "right"], ["底部(横向)", "bottom"], ["智能(空白三角区)", "auto"], ["手动定位(%)", "manual"]], g: "图例与色标" },
      { k: "vmOffsetX", label: "微调: 水平偏移(px)", t: "num", min: -600, max: 600, g: "图例与色标" },
      { k: "vmOffsetY", label: "微调: 垂直偏移(px)", t: "num", min: -600, max: 600, g: "图例与色标" },
      { k: "vmX", label: "手动定位: 水平(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmY", label: "手动定位: 垂直(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmLength", label: "色标长度(px, 0=随图)", t: "num", min: 0, max: 800, g: "图例与色标" },
      { k: "vmWidth", label: "色标宽度(px)", t: "num", min: 6, max: 60, g: "图例与色标" },
      ...SC_LEGEND,
      ...axisSchema("x", "X 轴", "cat").filter(s => s.k !== "xLabelRotate"),
      ...axisSchema("y", "Y 轴", "cat"),
      ...SC_MARGIN,
      { k: "showCaption", label: "显示注释行", t: "chk", g: "注释" },
      { k: "captionText", label: "注释内容", t: "txt", g: "注释" },
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const res = payload.result;
      const vars = res.all_x, n = vars.length;
      const idx = {}; vars.forEach((v, i) => idx[v] = i);
      const diagMode = st.labelMode === "diagonal";   // 对角线旁标注 → 隐藏两条坐标轴；坐标轴显隐由各自“显示整条坐标轴”控制
      // data 单元：{ value:[col,row,q], sym, diag }
      // 对角线模式把交互值放到另一侧三角，让对角格右侧留白以放标签（仿图1）
      const data = [];
      res.factor.forEach(f => data.push({ value: [idx[f.variable], idx[f.variable], f.q ?? 0], sym: "", diag: true }));
      res.interaction.forEach(r => {
        const hi = Math.max(idx[r.var1], idx[r.var2]), lo = Math.min(idx[r.var1], idx[r.var2]);
        const col = diagMode ? lo : hi, row = diagMode ? hi : lo;
        const sym = /nonlinear/i.test(r.type_en) && /enhance/i.test(r.type_en) ? "**" : (/bi/i.test(r.type_en) ? "*" : "");
        data.push({ value: [col, row, r.q12 ?? 0], sym, diag: false });
      });
      const qmax = Math.max(...data.map(d => d.value[2]));

      // ---- 绘图区几何（边距与自适应共用 imMargins，保证 plotW=n*cell） ----
      const autoGrid = (st.marginAuto === false)
        ? { left: st.gridLeft, right: st.gridRight, top: st.gridTop, bottom: st.gridBottom }
        : imMargins(st, n);
      const LL = autoGrid.left, RR = autoGrid.right, TT = autoGrid.top, BB = autoGrid.bottom;
      const plotW = st.width - LL - RR, plotH = st.height - TT - BB;
      const cellW = plotW / n, cellH = plotH / n;

      // ---- 颜色映射（隐藏 ECharts 自带图例，仅用于给格子上色；图例自绘） ----
      const qMax = Math.ceil(qmax * 100) / 100;
      const vm = {
        show: false, min: 0, max: qMax, inRange: { color: paletteOf(st) }
      };
      if (st.vmType === "piecewise") { vm.type = "piecewise"; vm.splitNumber = st.vmPieces; }
      else { vm.calculable = true; }

      const graphics = [];
      // ---- 逐边框（可单独开关上/右/下/左）----
      if (st.frameShow) {
        const fs = { stroke: st.frameColor, lineWidth: st.frameWidth };
        const L = LL, R = LL + plotW, T = TT, B = TT + plotH;
        if (st.frameTop !== false)    graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: T, x2: R, y2: T }, style: fs });
        if (st.frameBottom !== false) graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: B, x2: R, y2: B }, style: fs });
        if (st.frameLeft !== false)   graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: T, x2: L, y2: B }, style: fs });
        if (st.frameRight !== false)  graphics.push({ type: "line", silent: true, z: 5, shape: { x1: R, y1: T, x2: R, y2: B }, style: fs });
      }
      // ---- 自绘无缝色标（位置随翻转/朝向自适应，并可用偏移微调）----
      let cgeo;
      if (st.vmPos === "bottom") {
        const barW = st.vmLength > 0 ? st.vmLength : plotW;
        cgeo = { x: LL + (plotW - barW) / 2, y: TT + plotH + 40, len: barW, thick: st.vmWidth, orient: "horizontal", min: 0, max: qMax };
      } else if (st.vmPos === "right") {
        const barH = st.vmLength > 0 ? st.vmLength : plotH;
        cgeo = { x: LL + plotW + 18, y: TT + (plotH - barH) / 2, len: barH, thick: st.vmWidth, orient: "vertical", min: 0, max: qMax };
      } else if (st.vmPos === "manual") {
        const barH = st.vmLength > 0 ? st.vmLength : plotH * 0.6;
        cgeo = { x: LL + plotW * (st.vmX / 100), y: TT + plotH * (st.vmY / 100), len: barH, thick: st.vmWidth, orient: "vertical", min: 0, max: qMax };
      } else { // auto：放进空白三角区，只标首尾两个数值；按是否对角/翻转选空角
        const barH = st.vmLength > 0 ? st.vmLength : plotH * 0.42;
        // 空白角随 填充三角(对角与否) + X/Y 翻转 自适应
        const rightSide = diagMode !== !!st.xReverse;   // X 翻转时水平镜像
        const topSide = diagMode ? st.yReverse : !st.yReverse;
        const cx = rightSide ? LL + plotW * 0.70 : LL + plotW * 0.04;
        const cy = topSide ? TT + plotH * 0.06 : TT + plotH - barH - plotH * 0.06;
        cgeo = { x: cx, y: cy, len: barH, thick: st.vmWidth, orient: "vertical", min: 0, max: qMax, endpointsOnly: true };
      }
      // 偏移微调（对所有位置生效）
      cgeo.x += (st.vmOffsetX || 0); cgeo.y += (st.vmOffsetY || 0);
      buildColorbar(g, st, cgeo).forEach(e => graphics.push(e));

      if (st.showCaption) graphics.push({
        type: "text", left: LL, bottom: 8,
        style: { text: st.captionText, font: `${st.legendSize}px ${g.fontFamily}`, fill: st.xLabelColor }
      });
      // ---- 对角线旁变量标注（labelMode = diagonal）----
      if (diagMode) {
        const dsz = st.diagLabelSize > 0 ? st.diagLabelSize : clamp(st.xLabelSize, 11, 20);
        const offRight = !st.xReverse;   // 标签朝向空白三角一侧
        for (let i = 0; i < n; i++) {
          const cx = st.xReverse ? (LL + plotW - (i + 0.5) * cellW) : (LL + (i + 0.5) * cellW);
          const cy = st.yReverse ? (TT + (i + 0.5) * cellH) : (TT + plotH - (i + 0.5) * cellH);
          graphics.push({
            type: "text", z: 8,
            left: offRight ? cx + cellW * 0.5 + 8 : cx - cellW * 0.5 - 8, top: cy,
            style: { text: nm(vars[i]), textVerticalAlign: "middle", textAlign: offRight ? "left" : "right",
                     font: `bold ${dsz}px ${g.fontFamily}`, fill: st.xLabelColor }
          });
        }
      }

      // 坐标轴：axis 模式由各自“显示整条坐标轴”开关控制
      // diagonal 模式：行变量用对角线旁标注，列变量改用底部 X 轴显示（另一组变量），Y 轴隐藏
      const xAxis = buildAxis(g, st, "x", { type: "category", data: vars.map(nm), inverse: st.xReverse });
      xAxis.splitArea = { show: false };
      xAxis.axisLabel.interval = 0;   // 类目过密时也强制每个变量都显示
      const yAxis = buildAxis(g, st, "y", { type: "category", data: vars.map(nm), inverse: st.yReverse });
      yAxis.splitArea = { show: false };
      yAxis.axisLabel.interval = 0;
      if (diagMode) {
        yAxis.show = false;
        xAxis.show = true;                       // 显示底部列变量名 = 交互的另一组变量
        xAxis.axisLine = { show: false };        // 轴线由外边框负责，避免重复
        xAxis.axisTick = { show: false };
        xAxis.axisLabel = Object.assign({}, xAxis.axisLabel,
          { show: true, interval: 0, rotate: st.xLabelRotate || 0 });
      }

      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `交互作用探测`),
        grid: { left: LL, right: RR, top: TT, bottom: BB },
        xAxis, yAxis,
        visualMap: vm,
        graphic: graphics,
        series: [{
          type: "heatmap", data: data.map(d => {
            const o = { value: d.value, sym: d.sym, diag: d.diag };
            if (d.diag && st.diagHighlight) {
              o.itemStyle = { color: st.diagFill, borderColor: st.diagBorderColor, borderWidth: st.diagBorderWidth };
              o.label = { color: st.diagTextColor, fontWeight: "bold" };
            }
            return o;
          }),
          itemStyle: { borderColor: st.cellBorderColor, borderWidth: st.cellBorderWidth },
          label: {
            show: st.showValues,
            formatter: p => fmt(p.value[2], st.decimals) + (st.showSymbols && p.data.sym ? p.data.sym : ""),
            color: st.labelColor, fontFamily: g.fontFamily, fontSize: st.labelSize
          },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.4)" } }
        }]
      };
    }
  },

  /* ================ 因子离散化寻优过程图 ================ */
  disc: {
    label: "离散化寻优",
    defaults(ctx) {
      const nc = Math.max(ctx.nCont, 1);
      const cols = nc <= 2 ? nc : (nc <= 6 ? 3 : 4);
      const rows = Math.ceil(nc / cols);
      return Object.assign(commonDefaults(ctx),
        axisDefaults("x", "cat"), axisDefaults("y", "val", { ySplitShow: true }),
        {
          cols, hGap: 6, vGap: 11, sharedY: false,
          axisAuto: true, xName: "分级数", yName: "q 值",
          lineWidth: 2.2, symbolType: "circle", symbolSize: 7,
          showBest: true, bestSymbol: "diamond", bestColor: "#000000", bestSize: 16,
          bestLabelMode: "none", bestLabelPos: "auto",
          annotate: true, subTitleSize: 0, showLegend: true,
          width: clamp(cols * 360 + 60, 520, 2400), height: clamp(rows * 270 + 110, 420, 2600)
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "cols", label: "每行子图数", t: "num", min: 1, max: 6, g: "布局" },
      { k: "hGap", label: "子图列距 (%)", t: "num", min: 1, max: 20, step: 0.5, g: "布局" },
      { k: "vGap", label: "子图行距 (%)", t: "num", min: 2, max: 25, step: 0.5, g: "布局" },
      { k: "sharedY", label: "统一 Y 轴范围", t: "chk", g: "布局" },
      { k: "annotate", label: "子图标注最优参数", t: "chk", g: "布局" },
      { k: "subTitleSize", label: "子图标题字号(0=自动)", t: "num", min: 0, max: 30, g: "布局" },
      { k: "axisAuto", label: "刻度字号自动适配面板", t: "chk", g: "坐标轴" },
      { k: "xName", label: "X 轴标题(分级数)", t: "txt", g: "坐标轴" },
      { k: "yName", label: "Y 轴标题(q 值)", t: "txt", g: "坐标轴" },
      { k: "xLabelSize", label: "刻度标签字号(手动)", t: "num", min: 6, max: 28, g: "坐标轴" },
      { k: "xLabelColor", label: "坐标轴文字颜色", t: "color", g: "坐标轴" },
      { k: "xLineShow", label: "显示 X 轴线", t: "chk", g: "坐标轴" },
      { k: "yLineShow", label: "显示 Y 轴线", t: "chk", g: "坐标轴" },
      { k: "xLineColor", label: "轴线颜色", t: "color", g: "坐标轴" },
      { k: "xTickShow", label: "显示刻度线", t: "chk", g: "坐标轴" },
      { k: "ySplitShow", label: "显示横向网格线", t: "chk", g: "坐标轴" },
      { k: "ySplitColor", label: "网格线颜色", t: "color", g: "坐标轴" },
      { k: "lineWidth", label: "线宽", t: "num", min: 0.5, max: 8, step: 0.5, g: "图形" },
      { k: "symbolType", label: "数据点样式", t: "sel", opts: [["实心圆", "circle"], ["空心圆", "emptyCircle"], ["实心方块", "rect"], ["空心方块", "emptyRect"], ["实心三角", "triangle"], ["空心三角", "emptyTriangle"], ["实心菱形", "diamond"], ["空心菱形", "emptyDiamond"], ["无", "none"]], g: "图形" },
      { k: "symbolSize", label: "数据点大小", t: "num", min: 0, max: 20, g: "图形" },
      { k: "showBest", label: "标记最优点", t: "chk", g: "最优标注" },
      { k: "bestSymbol", label: "最优点符号", t: "sel", opts: [["五角星", "star"], ["大头钉", "pin"], ["圆点", "circle"], ["菱形", "diamond"], ["箭头", "arrow"]], g: "最优标注" },
      { k: "bestColor", label: "最优点颜色", t: "color", g: "最优标注" },
      { k: "bestSize", label: "最优点大小", t: "num", min: 6, max: 40, g: "最优标注" },
      { k: "bestLabelMode", label: "最优点文字", t: "sel", opts: [["显示「最优」", "label"], ["显示 q 值", "q"], ["显示 方法·分级", "param"], ["不显示文字", "none"]], g: "最优标注" },
      { k: "bestLabelPos", label: "文字位置", t: "sel", opts: [["智能避让", "auto"], ["上方", "top"], ["下方", "bottom"], ["左侧", "left"], ["右侧", "right"]], g: "最优标注" },
      { k: "showLegend", label: "显示方法图例", t: "chk", g: "图例与色标" },
      ...SC_LEGEND,
      ...SC_LABEL,
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const discs = payload.result.discretization || [];
      if (!discs.length) return { __empty: "本结果没有连续变量，无离散化寻优过程。" };
      const methods = payload.result.params.methods;
      const itvs = payload.result.params.intervals.map(String);
      const pal = paletteOf(st);
      const mColor = m => lerpPalette(pal, methods.length === 1 ? 0.5 : methods.indexOf(m) / (methods.length - 1));

      const topPad = (st.titleShow ? (st.titleSize + 18) / st.height * 100 : 2) + (st.showLegend ? Math.max(4, 3000 / st.height) : 2) + 4;
      const lay = panelLayout(discs.length, st.cols, { topPad, hGap: st.hGap, vGap: st.vGap });
      const effAxis = st.axisAuto ? panelAutoFont(st.height, lay.rects[0].height) : st.xLabelSize;
      const subSize = st.subTitleSize > 0 ? st.subTitleSize : clamp(effAxis + 1, 10, 16);
      const aColor = st.xLabelColor;

      let yMinAll = Infinity, yMaxAll = -Infinity;
      discs.forEach(d => d.process.forEach(p => { if (p.q != null) { yMinAll = Math.min(yMinAll, p.q); yMaxAll = Math.max(yMaxAll, p.q); } }));
      const padAll = (yMaxAll - yMinAll) * 0.12 || 0.05;

      const grids = [], xAxes = [], yAxes = [], series = [], titles = [];
      if (st.titleShow) titles.push(buildTitle(g, st, `因子离散化参数寻优过程`));

      discs.forEach((d, i) => {
        const r = lay.rects[i];
        grids.push({ left: r.left + "%", top: r.top + "%", width: r.width + "%", height: r.height + "%" });
        xAxes.push({
          gridIndex: i, type: "category", data: itvs,
          axisLabel: TS(g, effAxis, aColor),
          axisLine: { show: st.xLineShow !== false, lineStyle: { color: st.xLineColor, width: st.xLineWidth } },
          axisTick: { show: st.xTickShow !== false, length: st.xTickLen, alignWithLabel: true, lineStyle: { color: st.xLineColor } },
          name: i >= discs.length - lay.cols ? (st.xName || "") : "", nameLocation: "middle",
          nameGap: effAxis + 12, nameTextStyle: TS(g, effAxis, aColor)
        });
        // 面板各自的 y 范围（用于智能标注位置判断）
        let pMin = Infinity, pMax = -Infinity;
        d.process.forEach(p => { if (p.q != null) { pMin = Math.min(pMin, p.q); pMax = Math.max(pMax, p.q); } });
        const pPad = (pMax - pMin) * 0.15 || 0.05;
        yAxes.push({
          gridIndex: i, type: "value",
          axisLabel: TS(g, effAxis, aColor, { formatter: v => v.toFixed(2) }),
          axisLine: { show: st.yLineShow !== false, lineStyle: { color: st.xLineColor, width: st.yLineWidth } },
          axisTick: { show: st.xTickShow !== false, length: st.yTickLen, lineStyle: { color: st.xLineColor } },
          name: i % lay.cols === 0 ? (st.yName || "") : "", nameLocation: "middle", nameGap: effAxis + 22, nameTextStyle: TS(g, effAxis, aColor),
          min: st.sharedY ? Math.max(0, yMinAll - padAll) : Math.max(0, pMin - pPad),
          max: st.sharedY ? yMaxAll + padAll : pMax + pPad,
          splitLine: { show: !!st.ySplitShow, lineStyle: { type: "dashed", color: st.ySplitColor } }
        });
        const sub = st.annotate
          ? `${nm(d.variable)}  最优: ${d.best_method} · ${d.best_n}级  q=${fmt(d.best_q, st.decimals)}`
          : nm(d.variable);
        titles.push({ text: sub, left: (r.left + r.width / 2) + "%", top: (r.top - Math.max(3.2, 2200 / st.height)) + "%", textAlign: "center", textStyle: TS(g, subSize, aColor, { fontWeight: "bold" }) });

        methods.forEach(m => {
          series.push({
            name: m, type: "line", xAxisIndex: i, yAxisIndex: i,
            data: itvs.map(it => { const f = d.process.find(p => p.method === m && String(p.n_intervals) === it); return f && f.q != null ? +f.q : null; }),
            lineStyle: { width: st.lineWidth },
            symbol: st.symbolType === "none" ? "none" : st.symbolType,
            symbolSize: st.symbolSize,
            color: mColor(m), connectNulls: false
          });
        });

        if (st.showBest) {
          // ---- 智能避让：根据最优点在面板中的位置自动选择文字方位 ----
          const lo = st.sharedY ? yMinAll - padAll : pMin - pPad;
          const hi = st.sharedY ? yMaxAll + padAll : pMax + pPad;
          const tNorm = (d.best_q - lo) / ((hi - lo) || 1);
          const xi = itvs.indexOf(String(d.best_n));
          const atRight = xi >= itvs.length - 1, atLeft = xi <= 0;
          let pos = st.bestLabelPos;
          if (pos === "auto") {
            if (tNorm > 0.72) pos = atRight ? "left" : (atLeft ? "right" : "bottom");
            else if (atRight) pos = "left";
            else if (atLeft) pos = "right";
            else pos = "top";
          }
          const lblText = st.bestLabelMode === "label" ? "最优"
            : st.bestLabelMode === "q" ? `q=${fmt(d.best_q, st.decimals)}`
            : st.bestLabelMode === "param" ? `${d.best_method}·${d.best_n}` : "";
          series.push({
            name: "最优参数", type: "scatter", xAxisIndex: i, yAxisIndex: i,
            data: [[String(d.best_n), d.best_q]],
            symbol: st.bestSymbol, symbolSize: st.bestSymbol === "pin" ? st.bestSize * 1.6 : st.bestSize,
            color: st.bestColor, z: 10,
            label: {
              show: st.bestLabelMode !== "none", position: pos, distance: 6,
              formatter: lblText,
              ...TS(g, st.labelSize, st.bestColor, { fontWeight: "bold" })
            }
          });
        }
      });
      return {
        backgroundColor: st.bgColor,
        title: titles,
        legend: st.showLegend ? { top: st.titleShow ? st.titleSize + 16 : 6, left: "center", data: methods.concat(st.showBest ? ["最优参数"] : []), textStyle: TS(g, st.legendSize, aColor), itemWidth: 22 } : undefined,
        grid: grids, xAxis: xAxes, yAxis: yAxes, series,
        tooltip: { trigger: "axis" }
      };
    }
  },

  /* ================ 生态探测三角图 ================ */
  eco: {
    label: "生态探测",
    defaults(ctx) {
      const n = Math.max(ctx.n - 1, 1);
      const cell = clamp(Math.round(100 - 3 * n), 50, 90);
      return Object.assign(commonDefaults(ctx),
        axisDefaults("x", "cat", { xTickShow: false }),
        axisDefaults("y", "cat", { yTickShow: false }),
        {
          colorMode: "manual", colorY: "#e63536", colorN: "#0c5496",
          showLabels: true, labelTextColor: "#ffffff",
          cellBorderWidth: 2, cellBorderColor: "#ffffff",
          legendPos: "right",
          width: n * cell + 260, height: n * cell + 150
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "colorMode", label: "着色方式", t: "sel", opts: [["手动两色", "manual"], ["取色带首尾", "palette"]], g: "图形" },
      { k: "colorY", label: "显著(Y)颜色", t: "color", g: "图形" },
      { k: "colorN", label: "不显著(N)颜色", t: "color", g: "图形" },
      { k: "cellBorderWidth", label: "格子边框宽", t: "num", min: 0, max: 10, step: 0.5, g: "图形" },
      { k: "cellBorderColor", label: "格子边框色", t: "color", g: "图形" },
      { k: "showLabels", label: "显示 Y/N 文字", t: "chk", g: "数值标签" },
      { k: "labelTextColor", label: "Y/N 文字颜色", t: "color", g: "数值标签" },
      ...SC_LABEL,
      { k: "legendPos", label: "图例位置", t: "sel", opts: [["右侧", "right"], ["顶部", "top"], ["底部", "bottom"]], g: "图例与色标" },
      ...SC_LEGEND,
      ...axisSchema("x", "X 轴", "cat"),
      ...axisSchema("y", "Y 轴", "cat"),
      ...SC_MARGIN,
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const res = payload.result;
      if (!res.ecological || !res.ecological.length) return { __empty: "自变量不足 2 个，无生态探测结果。" };
      const vars = res.all_x, n = vars.length;
      const idx = {}; vars.forEach((v, i) => idx[v] = i);
      const xCats = vars.slice(0, n - 1).map(nm), yCats = vars.slice(1).map(nm);
      const data = res.ecological.map(r => {
        const i = Math.min(idx[r.var1], idx[r.var2]), j = Math.max(idx[r.var1], idx[r.var2]);
        return { value: [i, j - 1, r.significant === "Y" ? 1 : 0], sig: r.significant };
      });
      const pal = paletteOf(st);
      const cY = st.colorMode === "palette" ? pal[pal.length - 1] : st.colorY;
      const cN = st.colorMode === "palette" ? pal[0] : st.colorN;
      const vm = {
        type: "piecewise",
        pieces: [{ value: 1, label: "Y 差异显著", color: cY }, { value: 0, label: "N 无显著差异", color: cN }],
        textStyle: TS(g, st.legendSize, st.xLabelColor)
      };
      if (st.legendPos === "right") Object.assign(vm, { orient: "vertical", right: 8, top: 70 });
      else if (st.legendPos === "top") Object.assign(vm, { orient: "horizontal", left: "center", top: st.titleShow ? st.titleSize + 18 : 6 });
      else Object.assign(vm, { orient: "horizontal", left: "center", bottom: 6 });
      const autoGrid = {
        left: 95, right: st.legendPos === "right" ? 150 : 45,
        top: (st.titleShow ? st.titleSize + 40 : 30) + (st.legendPos === "top" ? 30 : 0),
        bottom: ((st.xLabelRotate || 0) > 25 ? 88 : 70) + (st.legendPos === "bottom" ? 30 : 0)
      };
      const xAxis = buildAxis(g, st, "x", { type: "category", data: xCats });
      const yAxis = buildAxis(g, st, "y", { type: "category", data: yCats, inverse: true });
      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `生态探测（F 检验显著性）`),
        grid: buildGrid(st, autoGrid),
        xAxis, yAxis,
        visualMap: vm,
        series: [{
          type: "heatmap", data,
          itemStyle: { borderColor: st.cellBorderColor, borderWidth: st.cellBorderWidth },
          label: { show: st.showLabels, formatter: p => p.data.sig, ...TS(g, st.labelSize, st.labelTextColor, { fontWeight: "bold" }) }
        }]
      };
    }
  },

  /* ================ 风险探测分面柱状图 ================ */
  risk: {
    label: "风险探测",
    defaults(ctx) {
      const n = Math.max(ctx.n, 1);
      const cols = n <= 2 ? n : (n <= 6 ? 3 : 4);
      const rows = Math.ceil(n / cols);
      return Object.assign(commonDefaults(ctx),
        axisDefaults("x", "cat", { xLabelRotate: 45 }),
        axisDefaults("y", "val", { ySplitShow: true }),
        {
          cols, hGap: 6, vGap: 13, axisAuto: true,
          colorMode: "single", barColor: "#cfcfcf",
          barWidth: 70, barBorderWidth: 0.6, barBorderColor: "#7a7a7a",
          showValues: false, yName: "Y 均值", subTitleSize: 0,
          width: clamp(cols * 380 + 60, 560, 2600), height: clamp(rows * 290 + 100, 420, 2800)
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "cols", label: "每行子图数", t: "num", min: 1, max: 6, g: "布局" },
      { k: "hGap", label: "子图列距 (%)", t: "num", min: 1, max: 20, step: 0.5, g: "布局" },
      { k: "vGap", label: "子图行距 (%)", t: "num", min: 2, max: 25, step: 0.5, g: "布局" },
      { k: "subTitleSize", label: "子图标题字号(0=自动)", t: "num", min: 0, max: 30, g: "布局" },
      { k: "colorMode", label: "着色方式", t: "sel", opts: [["按变量取色带分色", "perVar"], ["统一单色", "single"]], g: "图形" },
      { k: "barColor", label: "单色柱颜色", t: "color", g: "图形" },
      { k: "barWidth", label: "柱宽 (%)", t: "num", min: 10, max: 95, g: "图形" },
      { k: "barBorderWidth", label: "柱边框宽", t: "num", min: 0, max: 6, step: 0.2, g: "图形" },
      { k: "barBorderColor", label: "柱边框色", t: "color", g: "图形" },
      { k: "showValues", label: "显示数值", t: "chk", g: "数值标签" },
      ...SC_LABEL,
      { k: "axisAuto", label: "刻度字号自动适配面板", t: "chk", g: "坐标轴" },
      { k: "xLabelSize", label: "刻度标签字号(手动)", t: "num", min: 6, max: 28, g: "坐标轴" },
      { k: "xLabelColor", label: "坐标轴文字颜色", t: "color", g: "坐标轴" },
      { k: "xLabelRotate", label: "分级标签旋转°", t: "num", min: 0, max: 90, g: "坐标轴" },
      { k: "yName", label: "Y 轴标题", t: "txt", g: "坐标轴" },
      { k: "xLineShow", label: "显示 X 轴线", t: "chk", g: "坐标轴" },
      { k: "yLineShow", label: "显示 Y 轴线", t: "chk", g: "坐标轴" },
      { k: "xLineColor", label: "轴线颜色", t: "color", g: "坐标轴" },
      { k: "xTickShow", label: "显示刻度线", t: "chk", g: "坐标轴" },
      { k: "ySplitShow", label: "显示横向网格线", t: "chk", g: "坐标轴" },
      { k: "ySplitColor", label: "网格线颜色", t: "color", g: "坐标轴" },
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const risk = payload.result.risk || [];
      if (!risk.length) return { __empty: "无风险探测结果。" };
      const pal = paletteOf(st);
      const topPad = (st.titleShow ? (st.titleSize + 22) / st.height * 100 : 3) + 4;
      const lay = panelLayout(risk.length, st.cols, { topPad, hGap: st.hGap, vGap: st.vGap, bottomPad: 10 });
      const effAxis = st.axisAuto ? panelAutoFont(st.height, lay.rects[0].height) : st.xLabelSize;
      const subSize = st.subTitleSize > 0 ? st.subTitleSize : clamp(effAxis + 1, 10, 16);
      const aColor = st.xLabelColor;
      const grids = [], xAxes = [], yAxes = [], series = [], titles = [];
      if (st.titleShow) titles.push(buildTitle(g, st, `风险探测（分区 Y 均值）`));
      risk.forEach((d, i) => {
        const r = lay.rects[i];
        grids.push({ left: r.left + "%", top: r.top + "%", width: r.width + "%", height: r.height + "%" });
        xAxes.push({
          gridIndex: i, type: "category", data: d.groups.map(x => x.label),
          axisLabel: TS(g, clamp(effAxis - 2, 7, 15), aColor, { rotate: st.xLabelRotate, interval: 0 }),
          axisLine: { show: st.xLineShow !== false, lineStyle: { color: st.xLineColor, width: st.xLineWidth } },
          axisTick: { show: st.xTickShow !== false, alignWithLabel: true, lineStyle: { color: st.xLineColor } }
        });
        yAxes.push({
          gridIndex: i, type: "value", axisLabel: TS(g, effAxis - 1, aColor),
          name: i % lay.cols === 0 ? (st.yName || "") : "", nameLocation: "middle", nameGap: effAxis + 24, nameTextStyle: TS(g, effAxis - 1, aColor),
          axisLine: { show: st.yLineShow !== false, lineStyle: { color: st.xLineColor, width: st.yLineWidth } },
          axisTick: { show: st.xTickShow !== false, lineStyle: { color: st.xLineColor } },
          splitLine: { show: !!st.ySplitShow, lineStyle: { type: "dashed", color: st.ySplitColor } }
        });
        titles.push({ text: nm(d.variable), left: (r.left + r.width / 2) + "%", top: (r.top - Math.max(3.4, 2400 / st.height)) + "%", textAlign: "center", textStyle: TS(g, subSize, aColor, { fontWeight: "bold" }) });
        const color = st.colorMode === "single" ? st.barColor : lerpPalette(pal, risk.length === 1 ? 0.5 : i / (risk.length - 1));
        series.push({
          type: "bar", xAxisIndex: i, yAxisIndex: i, barWidth: st.barWidth + "%",
          itemStyle: { color, borderColor: st.barBorderColor, borderWidth: st.barBorderWidth },
          data: d.groups.map(x => x.mean),
          label: { show: st.showValues, position: "top", formatter: p => fmt(p.value, st.decimals), ...TS(g, clamp(st.labelSize - 1, 7, 16), st.labelColor) }
        });
      });
      return { backgroundColor: st.bgColor, title: titles, grid: grids, xAxis: xAxes, yAxis: yAxes, series, tooltip: {} };
    }
  },

  /* ================ 相关性热图 ================ */
  corr: {
    label: "相关性热图",
    defaults(ctx) {
      const n = ctx.n + 1;
      const cell = clamp(Math.round(96 - 3 * n), 42, 80);
      return Object.assign(commonDefaults(ctx, { palette: "RdBu (相关性)", reverse: true }),
        axisDefaults("x", "cat", { xTickShow: false }),
        axisDefaults("y", "cat", { yTickShow: false }),
        {
          method: "pearson", showValues: true, showSig: true, maskUpper: true,
          cellBorderWidth: 1.5, cellBorderColor: "#ffffff",
          vmType: "continuous", vmPieces: 8,
          vmPos: "right", vmX: 14, vmY: 18, vmLength: 0, vmWidth: 16, vmOffsetX: 0, vmOffsetY: 0,
          frameShow: true, frameWidth: 1.2, frameColor: "#000000",
          frameTop: true, frameRight: true, frameBottom: true, frameLeft: true,
          width: n * cell + 250, height: n * cell + 160
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "method", label: "相关系数", t: "sel", opts: [["Pearson", "pearson"], ["Spearman", "spearman"]], g: "图形" },
      { k: "maskUpper", label: "只显示下三角", t: "chk", g: "图形" },
      { k: "cellBorderWidth", label: "格子边框宽", t: "num", min: 0, max: 10, step: 0.5, g: "图形" },
      { k: "cellBorderColor", label: "格子边框色", t: "color", g: "图形" },
      { k: "showValues", label: "显示数值", t: "chk", g: "数值标签" },
      { k: "showSig", label: "显示显著性 (*)", t: "chk", g: "数值标签" },
      ...SC_LABEL,
      { k: "frameShow", label: "显示外边框", t: "chk", g: "边框" },
      { k: "frameTop", label: "上边框", t: "chk", g: "边框" },
      { k: "frameRight", label: "右边框", t: "chk", g: "边框" },
      { k: "frameBottom", label: "下边框", t: "chk", g: "边框" },
      { k: "frameLeft", label: "左边框", t: "chk", g: "边框" },
      { k: "frameWidth", label: "边框宽度", t: "num", min: 0.5, max: 6, step: 0.2, g: "边框" },
      { k: "frameColor", label: "边框颜色", t: "color", g: "边框" },
      { k: "vmType", label: "色标类型", t: "sel", opts: [["连续渐变", "continuous"], ["分段(离散)", "piecewise"]], g: "图例与色标" },
      { k: "vmPieces", label: "分段段数", t: "num", min: 3, max: 12, g: "图例与色标" },
      { k: "vmPos", label: "色标位置", t: "sel", opts: [["右侧(对齐边框)", "right"], ["底部(横向)", "bottom"], ["智能(空白三角区)", "auto"], ["手动定位(%)", "manual"]], g: "图例与色标" },
      { k: "vmOffsetX", label: "微调: 水平偏移(px)", t: "num", min: -600, max: 600, g: "图例与色标" },
      { k: "vmOffsetY", label: "微调: 垂直偏移(px)", t: "num", min: -600, max: 600, g: "图例与色标" },
      { k: "vmX", label: "手动定位: 水平(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmY", label: "手动定位: 垂直(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmLength", label: "色标长度(px, 0=随图)", t: "num", min: 0, max: 800, g: "图例与色标" },
      { k: "vmWidth", label: "色标宽度(px)", t: "num", min: 6, max: 60, g: "图例与色标" },
      ...SC_LEGEND,
      ...axisSchema("x", "X 轴", "cat"),
      ...axisSchema("y", "Y 轴", "cat"),
      ...SC_MARGIN,
      ...SC_PALETTE,
      ...SC_CANVAS
    ],
    build(payload, st, g, nm) {
      const stats = payload.stats;
      if (!stats) return { __empty: "请先在 ② 统计检验 页面对该文件运行统计检验。" };
      const co = stats.correlation[st.method];
      const vars = co.vars, n = vars.length;
      const data = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (st.maskUpper && j > i) continue;
        const r = co.r[i][j], p = co.p[i][j];
        data.push({ value: [j, i, r == null ? 0 : +(+r).toFixed(4)], p });
      }
      const autoGrid = { left: 95, right: st.vmPos === "right" ? 110 : 45, top: st.titleShow ? st.titleSize + 40 : 30, bottom: ((st.xLabelRotate || 0) > 25 ? 88 : 70) + (st.vmPos === "bottom" ? 50 : 0) };
      const gr = buildGrid(st, autoGrid);
      const LL = gr.left, RR = gr.right, TT = gr.top, BB = gr.bottom;
      const plotW = st.width - LL - RR, plotH = st.height - TT - BB;

      const vm = { show: false, min: -1, max: 1, inRange: { color: paletteOf(st) } };
      if (st.vmType === "piecewise") { vm.type = "piecewise"; vm.splitNumber = st.vmPieces; }
      else { vm.calculable = true; }

      const graphics = [];
      if (st.frameShow) {
        const fs = { stroke: st.frameColor, lineWidth: st.frameWidth };
        const L = LL, R = LL + plotW, T = TT, B = TT + plotH;
        if (st.frameTop !== false)    graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: T, x2: R, y2: T }, style: fs });
        if (st.frameBottom !== false) graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: B, x2: R, y2: B }, style: fs });
        if (st.frameLeft !== false)   graphics.push({ type: "line", silent: true, z: 5, shape: { x1: L, y1: T, x2: L, y2: B }, style: fs });
        if (st.frameRight !== false)  graphics.push({ type: "line", silent: true, z: 5, shape: { x1: R, y1: T, x2: R, y2: B }, style: fs });
      }
      // 自绘无缝色标（-1~1）
      let cgeo;
      if (st.vmPos === "bottom") {
        const barW = st.vmLength > 0 ? st.vmLength : plotW;
        cgeo = { x: LL + (plotW - barW) / 2, y: TT + plotH + 42, len: barW, thick: st.vmWidth, orient: "horizontal", min: -1, max: 1 };
      } else if (st.vmPos === "right") {
        const barH = st.vmLength > 0 ? st.vmLength : plotH;
        cgeo = { x: LL + plotW + 16, y: TT + (plotH - barH) / 2, len: barH, thick: st.vmWidth, orient: "vertical", min: -1, max: 1 };
      } else if (st.vmPos === "manual") {
        const barH = st.vmLength > 0 ? st.vmLength : plotH * 0.6;
        cgeo = { x: LL + plotW * (st.vmX / 100), y: TT + plotH * (st.vmY / 100), len: barH, thick: st.vmWidth, orient: "vertical", min: -1, max: 1 };
      } else { // auto：下三角时空白在右上，只标首尾
        const barH = st.vmLength > 0 ? st.vmLength : plotH * 0.42;
        cgeo = { x: LL + plotW * 0.70, y: TT + plotH * 0.06, len: barH, thick: st.vmWidth, orient: "vertical", min: -1, max: 1, endpointsOnly: true };
      }
      cgeo.x += (st.vmOffsetX || 0); cgeo.y += (st.vmOffsetY || 0);
      buildColorbar(g, st, cgeo).forEach(e => graphics.push(e));

      const xAxis = buildAxis(g, st, "x", { type: "category", data: vars.map(nm) });
      xAxis.splitArea = { show: false };
      const yAxis = buildAxis(g, st, "y", { type: "category", data: vars.map(nm), inverse: true });
      yAxis.splitArea = { show: false };
      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `${st.method === "pearson" ? "Pearson" : "Spearman"} 相关性`),
        grid: { left: LL, right: RR, top: TT, bottom: BB },
        xAxis, yAxis,
        visualMap: vm,
        graphic: graphics,
        series: [{
          type: "heatmap", data,
          itemStyle: { borderColor: st.cellBorderColor, borderWidth: st.cellBorderWidth },
          label: {
            show: st.showValues,
            formatter: p => fmt(p.value[2], Math.min(st.decimals, 2)) + (st.showSig && p.value[0] !== p.value[1] ? sigStars(p.data.p) : ""),
            ...TS(g, st.labelSize, st.labelColor)
          }
        }]
      };
    }
  }
};
