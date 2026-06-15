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
    pixelRatio: 3
  };
}
const GLOBAL_SCHEMA = [
  { k: "fontFamily", label: "字体（中英文混排）", t: "sel", opts: FONT_OPTIONS },
  { k: "exportFormat", label: "导出图片格式", t: "sel", opts: [["PNG (位图,推荐)", "png"], ["JPG (位图)", "jpeg"], ["SVG (矢量,可AI编辑)", "svg"]] },
  { k: "pixelRatio", label: "导出分辨率倍数", t: "sel", opts: [["1×", 1], ["2×", 2], ["3× (推荐)", 3], ["4×", 4], ["6×", 6]] }
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
    { k: prefix + "LineShow", label: "显示坐标轴", t: "chk", g },
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
        bottom: horiz ? 62 : ((st.catLabelRotate || 0) > 25 ? 90 : 72)
      };
      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `单因子探测结果`),
        grid: buildGrid(st, autoGrid),
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
      const cell = clamp(Math.round(100 - 3.2 * ctx.n), 46, 86);
      return Object.assign(commonDefaults(ctx),
        axisDefaults("x", "cat", { xTickShow: false }),
        axisDefaults("y", "cat", { yTickShow: false }),
        {
          showValues: true, showSymbols: true,
          cellBorderWidth: 1.5, cellBorderColor: "#ffffff",
          vmPos: "auto", vmX: 14, vmY: 18, vmLength: 0, vmWidth: 16,
          frameShow: true, frameWidth: 1.2, frameColor: "#000000",
          showCaption: true, captionText: "注：* 双因子增强，** 非线性增强",
          width: ctx.n * cell + 250, height: ctx.n * cell + 170
        });
    },
    schema: [
      ...SC_TITLE,
      { k: "showValues", label: "显示 q 值", t: "chk", g: "数值标签" },
      { k: "showSymbols", label: "显示增强标记 (*/**)", t: "chk", g: "数值标签" },
      ...SC_LABEL,
      { k: "cellBorderWidth", label: "格子边框宽", t: "num", min: 0, max: 10, step: 0.5, g: "图形" },
      { k: "cellBorderColor", label: "格子边框色", t: "color", g: "图形" },
      { k: "frameShow", label: "外边框(含上边框)", t: "chk", g: "图形" },
      { k: "frameWidth", label: "外边框宽度", t: "num", min: 0.5, max: 6, step: 0.2, g: "图形" },
      { k: "frameColor", label: "外边框颜色", t: "color", g: "图形" },
      { k: "vmPos", label: "色标位置", t: "sel", opts: [["智能(空白三角区)", "auto"], ["右侧", "right"], ["底部", "bottom"], ["手动定位", "manual"]], g: "图例与色标" },
      { k: "vmX", label: "手动: 水平位置(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmY", label: "手动: 垂直位置(%)", t: "num", min: 0, max: 95, g: "图例与色标" },
      { k: "vmLength", label: "色标长度(px, 0=自动)", t: "num", min: 0, max: 800, g: "图例与色标" },
      { k: "vmWidth", label: "色标宽度(px)", t: "num", min: 6, max: 60, g: "图例与色标" },
      ...SC_LEGEND,
      ...axisSchema("x", "X 轴", "cat"),
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
      const data = [];
      res.factor.forEach(f => data.push([idx[f.variable], idx[f.variable], f.q ?? 0, ""]));
      res.interaction.forEach(r => {
        const i = Math.max(idx[r.var1], idx[r.var2]), j = Math.min(idx[r.var1], idx[r.var2]);
        const sym = /nonlinear/i.test(r.type_en) && /enhance/i.test(r.type_en) ? "**" : (/bi/i.test(r.type_en) ? "*" : "");
        data.push([i, j, r.q12 ?? 0, sym]);
      });
      const qmax = Math.max(...data.map(d => d[2]));

      // ---- 绘图区几何（自动或手动边距，供智能色标 / 外边框使用） ----
      const autoGrid = {
        left: 90, right: st.vmPos === "right" ? 120 : 42,
        top: st.titleShow ? st.titleSize + 42 : 28,
        bottom: (st.vmPos === "bottom" ? 105 : 52) + (st.showCaption ? 28 : 0) + ((st.xLabelRotate || 0) > 25 ? 22 : 0)
      };
      const gr = buildGrid(st, autoGrid);
      const LL = gr.left, RR = gr.right, TT = gr.top, BB = gr.bottom;
      const plotW = st.width - LL - RR, plotH = st.height - TT - BB;

      const vm = {
        min: 0, max: Math.ceil(qmax * 100) / 100, calculable: true, precision: 2,
        inRange: { color: paletteOf(st) }, textStyle: TS(g, st.legendSize, st.yLabelColor),
        itemWidth: st.vmWidth
      };
      const vmLen = st.vmLength > 0 ? st.vmLength : clamp(plotH * 0.42, 110, 380);
      if (st.vmPos === "auto") {
        Object.assign(vm, { left: LL + plotW * 0.05, top: TT + plotH * 0.05, orient: "vertical", itemHeight: Math.min(vmLen, plotH * 0.5) });
      } else if (st.vmPos === "right") {
        Object.assign(vm, { right: 12, top: "middle", orient: "vertical", itemHeight: vmLen });
      } else if (st.vmPos === "bottom") {
        Object.assign(vm, { bottom: st.showCaption ? 34 : 8, left: "center", orient: "horizontal", itemHeight: st.vmWidth, itemWidth: vmLen });
      } else {
        Object.assign(vm, { left: st.vmX + "%", top: st.vmY + "%", orient: "vertical", itemHeight: vmLen });
      }

      const graphics = [];
      if (st.frameShow) graphics.push({
        type: "rect", silent: true, z: 5,
        shape: { x: LL, y: TT, width: plotW, height: plotH },
        style: { fill: "none", stroke: st.frameColor, lineWidth: st.frameWidth }
      });
      if (st.showCaption) graphics.push({
        type: "text", left: LL, bottom: 8,
        style: { text: st.captionText, font: `${st.legendSize}px ${g.fontFamily}`, fill: st.xLabelColor }
      });

      const xAxis = buildAxis(g, st, "x", { type: "category", data: vars.map(nm) });
      xAxis.splitArea = { show: false };
      const yAxis = buildAxis(g, st, "y", { type: "category", data: vars.map(nm) });
      yAxis.splitArea = { show: false };

      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `交互作用探测`),
        grid: { left: LL, right: RR, top: TT, bottom: BB },
        xAxis, yAxis,
        visualMap: vm,
        graphic: graphics,
        series: [{
          type: "heatmap", data: data.map(d => ({ value: [d[0], d[1], d[2]], sym: d[3] })),
          itemStyle: { borderColor: st.cellBorderColor, borderWidth: st.cellBorderWidth },
          label: {
            show: st.showValues,
            formatter: p => fmt(p.value[2], st.decimals) + (st.showSymbols && p.data.sym ? p.data.sym : ""),
            ...TS(g, st.labelSize, st.labelColor)
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
          showBest: true, bestSymbol: "star", bestColor: "#e63536", bestSize: 16,
          bestLabelMode: "label", bestLabelPos: "auto",
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
          colorMode: "single", barColor: "#0c5496",
          barWidth: 70, barBorderWidth: 0.5, barBorderColor: "#333333",
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
          vmLength: 0, vmWidth: 16,
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
      { k: "vmLength", label: "色标长度(px, 0=自动)", t: "num", min: 0, max: 800, g: "图例与色标" },
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
      const autoGrid = { left: 95, right: 105, top: st.titleShow ? st.titleSize + 40 : 30, bottom: (st.xLabelRotate || 0) > 25 ? 88 : 70 };
      const gr = buildGrid(st, autoGrid);
      const plotH = st.height - gr.top - gr.bottom;
      const xAxis = buildAxis(g, st, "x", { type: "category", data: vars.map(nm) });
      const yAxis = buildAxis(g, st, "y", { type: "category", data: vars.map(nm), inverse: true });
      return {
        backgroundColor: st.bgColor,
        title: buildTitle(g, st, `${st.method === "pearson" ? "Pearson" : "Spearman"} 相关性`),
        grid: gr,
        xAxis, yAxis,
        visualMap: {
          min: -1, max: 1, precision: 2, calculable: true, orient: "vertical", right: 10, top: "middle",
          inRange: { color: paletteOf(st) }, textStyle: TS(g, st.legendSize, st.xLabelColor),
          itemWidth: st.vmWidth,
          itemHeight: st.vmLength > 0 ? st.vmLength : clamp(plotH * 0.5, 140, 360)
        },
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
