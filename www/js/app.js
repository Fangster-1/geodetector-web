/* ==============================================================
 * 地理探测器分析与制图平台 - 前端主逻辑 v2
 * ============================================================== */
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------------- 全局状态 ---------------- */
const S = {
  rawFiles: [],         // 原始上传表 {id, name, n_rows, columns, preview}
  files: [],            // 拆分后的训练数据集 {id, name, n_rows, columns, preview}
  roles: {},            // 变量基名 -> 'y' | 'cont' | 'cat' | 'ignore'
  xOrder: [],           // 被选为自变量的基名，按点击先后顺序 -> 决定 x1,x2… 命名
  splitMeta: null,      // { y:'y', cont:['x1',...], cat:['x2',...], xMap:[{new,base}], years:[] }
  results: {},          // fileId -> {clean_report, result}
  stats: {},            // fileId -> {clean_report, stats}
  current: { fileId: null, chart: "factor" },
  style: { global: null, perChart: {}, varNames: {} },
  charts: { main: null, corrQuick: null }
};
const RUN = { active: false, abort: false, jobId: null, t0: 0, stage: "", file: "", ticker: null };
/* 本地秒表：平滑刷新已用时（阶段文字由轮询更新） */
function startTicker() {
  stopTicker();
  RUN.ticker = setInterval(() => {
    if (!RUN.active || !RUN.t0) return;
    const sec = Math.floor((Date.now() - RUN.t0) / 1000);
    const mm = Math.floor(sec / 60), ss = sec % 60;
    const tstr = mm > 0 ? `${mm}分${ss}秒` : `${ss}秒`;
    setRunStatus(`⏳ ${RUN.file} ｜ ${RUN.stage || "正在计算…"} ｜ 已用时 ${tstr}（点击"停止"可终止）`);
  }, 500);
}
function stopTicker() {
  if (RUN.ticker) { clearInterval(RUN.ticker); RUN.ticker = null; }
  setRunStatus("");
}

/* ---------------- 基础工具 ---------------- */
async function api(path, body) {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`服务器错误 HTTP ${r.status}`);
  return r.json();
}
function fileToB64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function toCSV(headers, rows) {
  const esc = v => {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
}
function makeTable(headers, rows) {
  return `<table class="tbl"><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c == null ? "" : c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const fnum = (v, d = 4) => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(d);
const nameMap = v => S.style.varNames[v] || v;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 页面导航 ---------------- */
$$("#stepNav .step").forEach(b => b.onclick = () => {
  $$("#stepNav .step").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $$(".page").forEach(p => p.classList.remove("active"));
  $("#page-" + b.dataset.page).classList.add("active");
  if (b.dataset.page === "charts") renderChart();
  if (b.dataset.page === "tables") renderTables();
});
function markStepDone(page) {
  const el = $(`#stepNav .step[data-page="${page}"]`);
  if (el) el.classList.add("done");
}

/* ---------------- 服务器状态 ---------------- */
(async function ping() {
  try {
    await fetch("/api/ping").then(x => x.json());
    $("#serverStatus").textContent = "● 服务正常";
    $("#serverStatus").className = "server-status ok";
  } catch (e) {
    $("#serverStatus").textContent = "● 服务未连接（请通过 启动网站.bat 启动）";
    $("#serverStatus").className = "server-status bad";
    setTimeout(ping, 3000);
  }
})();

/* ---------------- 心跳：浏览器关闭后后端自动停止 ---------------- */
// 后端超时 90s；前端 15s 一跳，并在标签页重新可见时立即补一跳，
// 以兼容浏览器对后台标签页 setInterval 的节流（最长约 60s/次）
function heartbeat() { fetch("/api/heartbeat").catch(() => {}); }
heartbeat();
setInterval(heartbeat, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) heartbeat(); });

/* ================= ① 数据上传 ================= */
const dz = $("#dropZone"), fi = $("#fileInput");
dz.onclick = () => fi.click();
dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
dz.ondragleave = () => dz.classList.remove("over");
dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); handleFiles(e.dataTransfer.files); };
fi.onchange = () => handleFiles(fi.files);

/* ---- 年份/基名工具 ---- */
// 需要从自变量列表中过滤掉的字段（ArcGIS 系统字段、几何字段、ID 字段）
const IGNORE_PATTERNS = [
  /^objectid(\d|_|$)/i,        // OBJECTID, OBJECTID_1, OBJECTID_12
  /^shape(_|\.|$)/i,           // Shape, Shape_Length, Shape_Area, Shape_Leng
  /^orig_fid$/i,
  /^target_fid$/i,
  /^join_count$/i,
  /^fid(_|\d|$)/i,             // FID, FID_1
  /^oid(_|\d|$)/i,             // OID, OID_
  /^id$/i,                     // 单独的 Id / ID
  /^geometry$/i, /^geom$/i, /^wkt$/i
];
// 归一化字段名：去 BOM/空白，并剥离 ArcGIS 常见的尾缀装饰（如 "OBJECTID *"、"Shape *"）
function normalizeField(name) {
  return String(name).replace(/^﻿/, "").trim().replace(/[\s*]+$/g, "");
}
function isIgnoredField(name) {
  const s = normalizeField(name);
  return IGNORE_PATTERNS.some(re => re.test(s));
}
// 检测列名中的年份 token（1900-2099），返回 4 位字符串或 null
function detectYear(name) {
  const m = String(name).match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
  return m ? m[1] : null;
}
// 剥离年份得到变量基名（前缀/后缀/中间均可）
function baseName(name) {
  const y = detectYear(name);
  if (!y) return String(name).trim();
  let b = String(name).replace(y, "");
  b = b.replace(/^[_\-\s]+|[_\-\s]+$/g, "").replace(/[_\-\s]{2,}/g, "_");
  return b || String(name).trim();
}
// 文件/数据集名去扩展名（不剥年份，用于文件命名与图表标识）
function fileBase(name) { return String(name).replace(/\.(csv|xlsx|xls)$/i, ""); }

/* ---- 解析进度动画 ---- */
function showParseRow(html, cls) {
  $("#parseStatus").innerHTML = `<div class="parse-row ${cls || ""}">${html}</div>`;
}
function clearParseRow() { $("#parseStatus").innerHTML = ""; }

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name));
  if (!files.length) { alert("请选择 CSV 或 Excel 文件"); return; }
  dz.querySelector("p").textContent = "解析中…";
  try {
    const payload = [];
    for (let i = 0; i < files.length; i++) {
      showParseRow(`<div class="spinner"></div><div class="parse-text">正在读取文件 <b>${files[i].name}</b> （${i + 1}/${files.length}）…</div>`);
      payload.push({ name: files[i].name, b64: await fileToB64(files[i]) });
      await sleep(20); // 让动画有机会渲染
    }
    showParseRow(`<div class="spinner"></div><div class="parse-bar-wrap"><div class="parse-bar" id="parseBar" style="width:30%"></div></div><div class="parse-text">服务器解析中（含编码识别、Excel 读取）…</div>`);
    const resp = await api("/api/upload", { files: payload });
    const bar = $("#parseBar"); if (bar) bar.style.width = "100%";
    let okCount = 0, errs = [];
    for (const f of resp.files) {
      if (f.ok) { S.rawFiles.push(f); okCount++; }
      else errs.push(`${f.name}: ${f.error}`);
    }
    if (okCount > 0) {
      showParseRow(`✅ <div class="parse-text">解析完成：成功 <b>${okCount}</b> 个文件${errs.length ? `，失败 ${errs.length} 个` : ""}。请在下方设置变量角色并拆分。</div>`, "done");
      setTimeout(clearParseRow, 4000);
    } else {
      showParseRow(`❌ <div class="parse-text">全部解析失败：${errs.join("；")}</div>`, "err");
    }
    if (errs.length && okCount > 0) console.warn("部分文件解析失败:", errs);
    if (S.rawFiles.length && !Object.keys(S.roles).length) initPanelRoles();
    refreshRawUI();
    markStepDone("upload");
  } catch (e) {
    showParseRow(`❌ <div class="parse-text">上传失败：${e.message}</div>`, "err");
  }
  dz.querySelector("p").textContent = "点击选择 或 拖拽文件到此处";
  fi.value = "";
}

/* 原始文件列表 + 预览 */
function refreshRawUI() {
  $("#fileList").innerHTML = S.rawFiles.map(f => `
    <div class="file-item">
      <span class="fname">📄 ${f.name}</span>
      <span class="fmeta">${f.n_rows} 行 × ${f.columns.length} 列</span>
      <button class="btn-danger-text" onclick="removeRaw('${f.id}')">删除</button>
    </div>`).join("");
  const opts = S.rawFiles.map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  $("#previewFileSel").innerHTML = opts;
  $("#panelFileSel").innerHTML = opts;
  $("#varCard").style.display = S.rawFiles.length ? "" : "none";
  $("#previewCard").style.display = S.rawFiles.length ? "" : "none";
  renderCacheBar();
  renderPanel();
  renderPreview();
}
// 缓存状态条
function renderCacheBar() {
  const nRaw = S.rawFiles.length, nDs = S.files.length;
  const nRes = Object.keys(S.results).length, nStat = Object.keys(S.stats).length;
  const has = nRaw || nDs || nRes || nStat;
  $("#cacheBar").style.display = has ? "" : "none";
  $("#cacheStatus").innerHTML = `缓存：原始表 <b>${nRaw}</b> 个 ｜ 拆分数据集 <b>${nDs}</b> 个 ｜ 已探测 <b>${nRes}</b> ｜ 已统计 <b>${nStat}</b>`;
}
// 清空所有「下游」缓存（拆分数据集、结果、统计、图表、表格）；保留原始表
async function clearDownstream() {
  for (const f of S.files) { try { await api("/api/remove", { id: f.id }); } catch (e) {} }
  S.files = []; S.results = {}; S.stats = {}; S.splitMeta = null;
  ["statsFileSel", "runFileSel", "chartFileSel", "tableFileSel"].forEach(id => { const el = $("#" + id); if (el) el.innerHTML = ""; });
  $("#splitCard").style.display = "none";
  $("#statsResultArea") && ($("#statsResultArea").style.display = "none");
  $("#tablesArea") && ($("#tablesArea").innerHTML = "");
  if (S.charts.main) { S.charts.main.clear(); }
  const cm = $("#chartMsg"); if (cm) cm.textContent = "请先上传数据并运行地理探测。";
  const mc = $("#mainChart"); if (mc) mc.style.display = "none";
}
window.removeRaw = async function (id) {
  const f = S.rawFiles.find(x => x.id === id);
  if (!confirm(`删除原始表「${f ? f.name : id}」？\n其拆分出的数据集、统计与探测结果等缓存将一并清除。`)) return;
  try { await api("/api/remove", { id }); } catch (e) {}
  S.rawFiles = S.rawFiles.filter(x => x.id !== id);
  // 删除原始表 → 下游派生数据全部失效，级联清理
  await clearDownstream();
  // 变量角色随原始表变化：删光后彻底重置，避免旧选择残留到下次上传
  if (!S.rawFiles.length) { S.roles = {}; S.xOrder = []; S.selectedYears = null; }
  $("#splitHint").textContent = "";
  refreshRawUI();
};
// 清空全部缓存
$("#clearAllBtn").onclick = async function () {
  if (!confirm("确认清空全部缓存？\n将删除所有原始表、拆分数据集、统计与探测结果，回到初始状态。")) return;
  try { await api("/api/clear_all", {}); } catch (e) {}
  await clearDownstream();
  S.rawFiles = []; S.roles = {}; S.xOrder = []; S.selectedYears = null;
  $("#splitHint").textContent = "";
  $("#previewTable").innerHTML = "";
  clearParseRow();
  refreshRawUI();
};

/* 所有原始表的基名并集（过滤掉 ArcGIS/ID 字段） */
function unionBases() {
  const set = new Map();   // base -> 顺序
  S.rawFiles.forEach(f => f.columns.forEach(c => {
    if (isIgnoredField(c)) return;
    const b = baseName(c);
    if (isIgnoredField(b)) return;
    if (!set.has(b)) set.set(b, set.size);
  }));
  return Array.from(set.keys());
}
function detectedYears() {
  const set = new Set();
  S.rawFiles.forEach(f => f.columns.forEach(c => { const y = detectYear(c); if (y) set.add(y); }));
  return Array.from(set).sort();
}
// 某基名是动态变量（带年份）还是静态变量（常量，不随年份变化）
function baseKind(base) {
  let hasYear = false;
  S.rawFiles.forEach(f => f.columns.forEach(c => {
    if (isIgnoredField(c)) return;
    if (baseName(c) !== base) return;
    if (detectYear(c)) hasYear = true;
  }));
  return hasYear ? "dynamic" : "static";
}
// 自变量在 xOrder 中的序号 -> x1, x2…（按点击顺序）
function xNameOf(base) {
  const i = S.xOrder.indexOf(base);
  return i >= 0 ? "x" + (i + 1) : "";
}

// 上传后初始化：自动识别 Y，默认选中全部年份；X 留给用户按顺序点选
function initPanelRoles() {
  const bases = unionBases();
  S.roles = {}; S.xOrder = [];
  const yb = bases.find(b => b.toLowerCase() === "y" || /(^|_)y$/.test(b.toLowerCase()));
  if (yb) S.roles[yb] = "y";
  S.selectedYears = detectedYears().slice();
}

/* 渲染面板自动解析模块（年份按钮 + Y 下拉 + X 标签） */
function renderPanel() {
  const bases = unionBases();
  const years = detectedYears();
  if (!S.selectedYears) S.selectedYears = years.slice();
  const dyn = bases.filter(b => baseKind(b) === "dynamic");
  const sta = bases.filter(b => baseKind(b) === "static");

  $("#panelInfo").innerHTML = years.length
    ? `识别到 <b>${years.length}</b> 个年份（${years.join("、")}），动态变量 ${dyn.length} 个，静态变量 ${sta.length} 个`
    : `未检测到年份，将作为<b>单个</b>数据集处理；可直接选 Y / X 后拆分`;

  // ① 年份按钮
  $("#yearBlock").style.display = years.length ? "" : "none";
  $("#yearButtons").innerHTML = years.map(y =>
    `<button class="year-btn ${S.selectedYears.includes(y) ? "on" : ""}" onclick="toggleYear('${y}')">${y}</button>`
  ).join("");

  // ② 因变量 Y 下拉
  const yBase = Object.keys(S.roles).find(b => S.roles[b] === "y") || "";
  $("#yBaseSel").innerHTML = `<option value="">(不选择)</option>` +
    bases.map(b => `<option value="${b}" ${yBase === b ? "selected" : ""}>${b}${baseKind(b) === "static" ? "（静态）" : ""}</option>`).join("");

  // ③ 自变量 X 标签（排除 Y 基名）。单击=选为/取消 X；选中后点右侧「连续/分类」标签切换类型
  $("#xChips").innerHTML = bases.filter(b => S.roles[b] !== "y").map(b => {
    const role = S.roles[b];
    const sel = role === "cont" || role === "cat";
    const xn = xNameOf(b);
    const kind = baseKind(b);
    const cls = role === "cont" ? "chip-cont" : role === "cat" ? "chip-cat" : "";
    const icon = kind === "dynamic" ? "🔄" : "📌";
    const tip = kind === "dynamic" ? "动态变量（带年份，逐年取值）" : "静态变量（常量，复制到每年）";
    const esc = b.replace(/'/g, "\\'");
    const typeBadge = sel
      ? `<span class="chip-type" onclick="event.stopPropagation();toggleXType('${esc}')" title="点击切换 连续/分类">${role === "cat" ? "分类" : "连续"}</span>`
      : "";
    return `<button class="x-chip ${cls}" onclick="toggleX('${esc}')" title="${tip}">
      <span class="chip-ic">${icon}</span>${b}${xn ? `<span class="chip-x">${xn}</span>` : ""}${typeBadge}</button>`;
  }).join("");
}

// 年份按钮：切换是否提取该年
window.toggleYear = function (y) {
  if (!S.selectedYears) S.selectedYears = detectedYears();
  if (S.selectedYears.includes(y)) S.selectedYears = S.selectedYears.filter(x => x !== y);
  else { S.selectedYears.push(y); S.selectedYears.sort(); }
  renderPanel();
};
// 因变量 Y 选择
$("#yBaseSel").onchange = function () {
  const b = this.value;
  Object.keys(S.roles).forEach(k => { if (S.roles[k] === "y") S.roles[k] = "ignore"; });
  if (b) { S.roles[b] = "y"; S.xOrder = S.xOrder.filter(x => x !== b); }
  renderPanel();
};
// 单击 X 标签：选为自变量（默认连续）/ 取消；按点击顺序命名 x1,x2…
window.toggleX = function (b) {
  const cur = S.roles[b];
  S.xOrder = S.xOrder.filter(x => x !== b);
  if (cur === "cont" || cur === "cat") { S.roles[b] = "ignore"; }
  else { S.roles[b] = "cont"; S.xOrder.push(b); }
  renderPanel();
};
// 点击「连续/分类」标签：切换该自变量的类型（不改变顺序）
window.toggleXType = function (b) {
  if (S.roles[b] === "cont") S.roles[b] = "cat";
  else if (S.roles[b] === "cat") S.roles[b] = "cont";
  renderPanel();
};
// 板文件选择联动预览
$("#panelFileSel").onchange = function () { $("#previewFileSel").value = this.value; renderPreview(); };
/* 拆分后供后续流程使用的变量配置（固定为 y / x1…xn） */
function getVarConfig() {
  if (S.splitMeta) return { y: S.splitMeta.y, cont: S.splitMeta.cont, cat: S.splitMeta.cat, allX: S.splitMeta.cont.concat(S.splitMeta.cat) };
  return { y: null, cont: [], cat: [], allX: [] };
}

/* 预览（原始表） */
$("#previewFileSel").onchange = renderPreview;
function renderPreview() {
  const f = S.rawFiles.find(x => x.id === $("#previewFileSel").value) || S.rawFiles[0];
  if (!f) { $("#previewTable").innerHTML = ""; return; }
  const rows = Array.isArray(f.preview) ? f.preview : Object.values(f.preview || {});
  $("#previewTable").innerHTML = makeTable(f.columns, rows);
}

/* ---- 拆分为年度数据集 ---- */
$("#splitBtn").onclick = doSplit;
async function doSplit() {
  const yBase = Object.keys(S.roles).find(b => S.roles[b] === "y");
  // X 严格按点击顺序（xOrder），仅保留仍为自变量的基名
  const xBases = S.xOrder.filter(b => S.roles[b] === "cont" || S.roles[b] === "cat");
  if (!yBase) { alert("请先指定一个因变量 Y"); return; }
  if (!xBases.length) { alert("请至少指定一个自变量 X"); return; }

  // 新列名映射：y, x1, x2 ... 顺序 = 点击先后
  const newCols = ["y"], xMap = [], contNew = [], catNew = [];
  xBases.forEach((b, i) => {
    const nm2 = "x" + (i + 1);
    newCols.push(nm2);
    xMap.push({ new: nm2, base: b });
    if (S.roles[b] === "cat") catNew.push(nm2); else contNew.push(nm2);
  });

  $("#splitBtn").disabled = true; $("#splitHint").textContent = "拆分中…";
  // 清空旧的拆分结果
  for (const f of S.files) { try { await api("/api/remove", { id: f.id }); } catch (e) {} }
  S.files = []; S.results = {}; S.stats = {};

  let allDatasets = [], usedYears = [];
  try {
    for (const raw of S.rawFiles) {
      // 为该原始表建立 base -> {byYear, constCol}
      const info = {};
      raw.columns.forEach(c => {
        if (isIgnoredField(c)) return;
        const b = baseName(c), y = detectYear(c);
        if (!info[b]) info[b] = { byYear: {}, constCol: null };
        if (y) info[b].byYear[y] = c; else info[b].constCol = c;
      });
      // 该表涉及的年份，并与用户在面板里选中的年份取交集
      const yrSet = new Set();
      [yBase, ...xBases].forEach(b => { if (info[b]) Object.keys(info[b].byYear).forEach(y => yrSet.add(y)); });
      const sel = (S.selectedYears && S.selectedYears.length) ? S.selectedYears : Array.from(yrSet);
      const years = Array.from(yrSet).filter(y => sel.includes(y)).sort();
      const rawBase = fileBase(raw.name).replace(/[_\-\s]+$/g, "");

      const colFor = (b, year) => {
        const it = info[b];
        if (!it) return null;
        if (year && it.byYear[year]) return it.byYear[year];
        return it.constCol || (year ? null : Object.values(it.byYear)[0] || null);
      };

      const datasets = [];
      if (years.length === 0) {
        // 无年份：单数据集
        const src = [colFor(yBase, null), ...xBases.map(b => colFor(b, null))];
        if (src.includes(null)) { alert(`原始表 ${raw.name} 缺少所选变量的列`); continue; }
        const dsName = S.rawFiles.length > 1 ? rawBase : (rawBase || "数据集");
        datasets.push({ name: dsName, src_cols: src, new_cols: newCols });
      } else {
        years.forEach(year => {
          const src = [colFor(yBase, year), ...xBases.map(b => colFor(b, year))];
          if (src.includes(null)) { console.warn(`${raw.name} 年份 ${year} 缺列，跳过`); return; }
          const dsName = S.rawFiles.length > 1 ? `${rawBase}_${year}` : year;
          datasets.push({ name: dsName, src_cols: src, new_cols: newCols });
          if (!usedYears.includes(year)) usedYears.push(year);
        });
      }
      if (!datasets.length) continue;
      const resp = await api("/api/split", { id: raw.id, datasets });
      resp.datasets.forEach(d => {
        if (d.ok) { S.files.push(d); allDatasets.push(d); }
        else console.warn("拆分失败:", d.name, d.error);
      });
    }
  } catch (e) {
    alert("拆分失败：" + e.message);
    $("#splitBtn").disabled = false; $("#splitHint").textContent = "";
    return;
  }

  if (!S.files.length) { alert("没有生成任何数据集，请检查变量选择与年份。"); $("#splitBtn").disabled = false; $("#splitHint").textContent = ""; return; }

  S.splitMeta = { y: "y", cont: contNew, cat: catNew, xMap, years: usedYears.sort() };
  $("#splitBtn").disabled = false;
  $("#splitHint").textContent = `✓ 已生成 ${S.files.length} 个数据集`;
  renderSplitResult();
  refreshDatasetSelectors();
  initVarNameCtrls();
}

function renderSplitResult() {
  $("#splitCard").style.display = "";
  $("#splitResult").innerHTML = `<div class="split-grid">` +
    S.files.map(f => `<div class="split-item">📊 <b>${f.name}</b>　${f.n_rows} 行 × ${f.columns.length} 列</div>`).join("") +
    `</div>`;
  // 变量映射表
  const m = S.splitMeta;
  $("#splitMapping").innerHTML = makeTable(
    ["新列名", "对应变量基名", "类型"],
    [["y", S.roles && Object.keys(S.roles).find(b => S.roles[b] === "y"), "因变量"]]
      .concat(m.xMap.map(x => [x.new, x.base, m.cat.includes(x.new) ? "分类自变量" : "连续自变量"])));
}

/* 把拆分后的数据集填入各页面的下拉选择器 */
function refreshDatasetSelectors() {
  const opts = S.files.map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  ["statsFileSel", "runFileSel"].forEach(id => { const el = $("#" + id); if (el) el.innerHTML = opts; });
  const doneOpts = S.files.filter(f => S.results[f.id]).map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  $("#chartFileSel").innerHTML = doneOpts || opts;
  $("#tableFileSel").innerHTML = doneOpts || opts;
  renderCacheBar();
}

/* ================= ② 统计检验 ================= */
$("#runStatsBtn").onclick = () => runStats([$("#statsFileSel").value]);
$("#runStatsAllBtn").onclick = () => runStats(S.files.map(f => f.id));

async function runStats(ids) {
  const vc = getVarConfig();
  if (!vc.y || !vc.allX.length) { alert("请先在 ① 数据上传 页面设置因变量 Y 和自变量 X"); return; }
  for (let i = 0; i < ids.length; i++) {
    const f = S.files.find(x => x.id === ids[i]);
    $("#statsProgress").textContent = `正在检验 ${f.name} (${i + 1}/${ids.length}) …`;
    try {
      const r = await api("/api/stats", {
        id: f.id, y: vc.y, x: vc.allX,
        remove_zero_y: $("#removeZeroY").checked, max_sample: +$("#maxSample").value || 100000
      });
      if (!r.ok) throw new Error(r.error);
      S.stats[f.id] = r;
    } catch (e) { alert(`${f.name} 统计检验失败：${e.message}`); }
  }
  $("#statsProgress").textContent = "检验完成 ✓";
  markStepDone("stats");
  showStats($("#statsFileSel").value);
  renderCacheBar();
}
$("#statsFileSel").onchange = e => showStats(e.target.value);
$("#corrMethodSel").onchange = () => showStats($("#statsFileSel").value);

function showStats(id) {
  const r = S.stats[id];
  if (!r) { $("#statsResultArea").style.display = "none"; return; }
  $("#statsResultArea").style.display = "";
  const st = r.stats;
  $("#statsWarnings").innerHTML = (st.warnings && st.warnings.length)
    ? st.warnings.map(w => `<p><span class="tag tag-warn">注意</span> ${w}</p>`).join("")
    : `<p><span class="tag tag-ok">通过</span> 未发现零方差、高相关 (|r|>0.8) 或严重共线性 (VIF≥10) 问题。</p>`;
  $("#descTable").innerHTML = makeTable(
    ["变量", "角色", "样本数", "均值", "标准差", "方差", "变异系数(%)", "最小值", "P25", "中位数", "P75", "最大值", "唯一值数", "方差检测"],
    st.descriptive.map(d => [
      d.variable, d.role, d.n, fnum(d.mean), fnum(d.sd), fnum(d.variance), fnum(d.cv_pct, 1),
      fnum(d.min), fnum(d.q25), fnum(d.median), fnum(d.q75), fnum(d.max), d.n_unique,
      d.zero_variance ? '<span class="tag tag-bad">零方差</span>' : '<span class="tag tag-ok">正常</span>'
    ]));
  $("#vifTable").innerHTML = st.vif
    ? makeTable(["变量", "VIF", "容忍度 (1/VIF)", "判定"], st.vif.map(v => [
        v.variable, fnum(v.vif, 3), fnum(v.tolerance, 3),
        v.level === "正常" ? '<span class="tag tag-ok">正常</span>'
          : v.level === "中度共线性" ? '<span class="tag tag-warn">中度共线性</span>'
          : '<span class="tag tag-bad">严重共线性</span>'
      ]))
    : `<p class="hint">${r.stats.vif_note || ""}</p>`;
  const method = $("#corrMethodSel").value;
  const co = st.correlation[method];
  $("#corrTable").innerHTML = makeTable(
    ["变量", ...co.vars],
    co.vars.map((v, i) => [v, ...co.vars.map((_, j) => {
      const rr = co.r[i][j], p = co.p[i][j];
      return i === j ? "1" : `${fnum(rr, 3)}${sigStars(p)}`;
    })]));
  const f = S.files.find(x => x.id === id);
  const ctx = { n: co.vars.length - 1, nCont: 0 };
  const defs = CHARTS.corr.defaults(ctx);
  defs.method = method; defs.width = 760; defs.height = 560;
  const opt = CHARTS.corr.build({ stats: st, fileLabel: fileBase(f.name) }, defs, S.style.global || globalDefaults(), nameMap);
  if (!S.charts.corrQuick) S.charts.corrQuick = echarts.init($("#corrQuickChart"));
  S.charts.corrQuick.clear();
  S.charts.corrQuick.setOption(opt);
}

/* ================= ③ 地理探测（可停止的后台任务） ================= */
function getRunParams() {
  const methods = $$("#methodChecks input:checked").map(x => x.value);
  const lo = +$("#itvMin").value, hi = +$("#itvMax").value;
  const intervals = [];
  for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) intervals.push(i);
  return {
    methods, intervals,
    remove_zero_y: $("#removeZeroY").checked,
    max_sample: +$("#maxSample").value || 100000,
    disc_sample: +$("#discSample").value || 50000
  };
}
function log(msg) {
  const el = $("#runLog");
  el.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
  el.scrollTop = el.scrollHeight;
}
function setRunStatus(t) { $("#runStatusLine").textContent = t; }

$("#runOneBtn").onclick = () => runGD([$("#runFileSel").value]);
$("#runAllBtn").onclick = () => runGD(S.files.map(f => f.id));
$("#stopBtn").onclick = async () => {
  if (!RUN.active) return;
  RUN.abort = true;
  $("#stopBtn").disabled = true;
  log("🛑 收到停止请求，正在终止计算子进程…");
  if (RUN.jobId) { try { await api("/api/run_stop", { job_id: RUN.jobId }); } catch (e) { } }
};

async function runGD(ids) {
  const vc = getVarConfig();
  if (!vc.y || !vc.allX.length) { alert("请先在 ① 数据上传 页面设置因变量 Y 和自变量 X"); return; }
  const p = getRunParams();
  if (!p.methods.length) { alert("请至少勾选一种离散化方法"); return; }
  RUN.active = true; RUN.abort = false; RUN.jobId = null;
  $("#runOneBtn").disabled = $("#runAllBtn").disabled = true;
  $("#stopBtn").disabled = false;
  $("#runLog").textContent = "开始运行…（计算在独立子进程中执行，可随时停止）";

  for (let i = 0; i < ids.length; i++) {
    if (RUN.abort) { log(`⏭ 已停止，跳过剩余 ${ids.length - i} 个文件。`); break; }
    const f = S.files.find(x => x.id === ids[i]);
    if (!f) continue;
    $("#runProgress").style.width = `${(i / ids.length) * 100}%`;
    log(`📦 ${f.name} (${i + 1}/${ids.length}) 启动计算（离散化寻优 + 四类探测）…`);
    const t0 = Date.now();
    try {
      const start = await api("/api/run_start", {
        id: f.id, y: vc.y, cont: vc.cont, cat: vc.cat,
        methods: p.methods, intervals: p.intervals,
        remove_zero_y: p.remove_zero_y, max_sample: p.max_sample,
        disc_sample: p.disc_sample
      });
      if (!start.ok) throw new Error(start.error);
      RUN.jobId = start.job_id;
      RUN.t0 = t0; RUN.file = f.name; RUN.stage = "";
      startTicker();

      let finished = false;
      while (!finished) {
        await sleep(1200);
        if (RUN.abort) {
          try { await api("/api/run_stop", { job_id: RUN.jobId }); } catch (e) { }
          log(`   🛑 ${f.name} 的计算已被终止。`);
          stopTicker();
          break;
        }
        let stt;
        try { stt = await fetch(`/api/run_poll?job_id=${encodeURIComponent(RUN.jobId)}`).then(r => r.json()); }
        catch (e) { log(`   ❌ 轮询失败：${e.message}`); stopTicker(); break; }
        if (!stt.ok) { log(`   ❌ ${stt.error}`); stopTicker(); break; }
        if (stt.status === "running") {
          RUN.stage = stt.stage || "";   // 阶段文字由后端进度文件提供
          continue;
        }
        stopTicker();
        if (stt.status === "done") {
          S.results[f.id] = { clean_report: stt.clean_report, result: stt.result };
          const cr = stt.clean_report;
          log(`   ✓ 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s | 原始 ${cr.n_raw} 行 → 有效 ${cr.n_final} 行` +
            (cr.n_na_removed ? `（剔除缺失 ${cr.n_na_removed}）` : "") +
            (cr.n_zero_y_removed ? `（剔除 Y=0 共 ${cr.n_zero_y_removed}）` : "") +
            (cr.sampled ? "（已随机抽样）" : ""));
          const top = stt.result.factor.slice().sort((a, b) => (b.q || 0) - (a.q || 0))[0];
          if (top) log(`   ↳ 最大解释力因子: ${top.variable}  q=${(+top.q).toFixed(4)}`);
        } else if (stt.status === "stopped") {
          log(`   🛑 ${f.name} 的计算已被终止。`);
        } else {
          log(`   ❌ 计算失败：${stt.message}`);
        }
        finished = true;
      }
      RUN.jobId = null;
    } catch (e) {
      log(`   ❌ 失败：${e.message}`);
    }
  }
  $("#runProgress").style.width = "100%";
  stopTicker();
  log(RUN.abort ? "🛑 任务已停止。已完成的文件结果可正常使用。" : "🎉 全部任务结束。前往 ④ 制图中心 / ⑤ 结果表格 查看。");
  RUN.active = false; RUN.jobId = null;
  $("#runOneBtn").disabled = $("#runAllBtn").disabled = false;
  $("#stopBtn").disabled = true;
  markStepDone("run");
  refreshDatasetSelectors();
  initVarNameCtrls();
}

/* ================= ④ 制图中心 ================= */
$("#chartFileSel").onchange = e => { S.current.fileId = e.target.value; renderChart(); };
$$("#chartTabs button").forEach(b => b.onclick = () => {
  $$("#chartTabs button").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  S.current.chart = b.dataset.ct;
  renderChart();
});

function currentPayload() {
  const id = $("#chartFileSel").value || S.current.fileId;
  const f = S.files.find(x => x.id === id);
  if (!f) return null;
  return {
    file: f,
    fileLabel: fileBase(f.name),
    result: S.results[id] ? S.results[id].result : null,
    stats: S.stats[id] ? S.stats[id].stats : null
  };
}
function chartCtx(payload) {
  if (payload && payload.result) {
    return { n: payload.result.all_x.length, nCont: payload.result.cont_vars.length };
  }
  const vc = getVarConfig();
  return { n: Math.max(vc.allX.length, 1), nCont: vc.cont.length };
}
function ensureStyles(type, ctx) {
  if (!S.style.global || !("exportFormat" in S.style.global)) S.style.global = globalDefaults();
  if (!S.style.perChart[type]) {
    S.style.perChart[type] = CHARTS[type].defaults(ctx);
  } else {
    // 版本升级 / 新增字段时自动补齐缺省值
    const d = CHARTS[type].defaults(ctx);
    for (const k in d) if (!(k in S.style.perChart[type])) S.style.perChart[type][k] = d[k];
  }
  return { g: S.style.global, st: S.style.perChart[type] };
}

function renderChart() {
  const type = S.current.chart;
  const payload = currentPayload();
  const box = $("#mainChart"), msg = $("#chartMsg");
  if (!payload) { msg.textContent = "请先上传数据并运行地理探测。"; box.style.display = "none"; return; }
  if (type !== "corr" && !payload.result) { msg.textContent = "该文件尚未运行地理探测，请先到 ③ 地理探测 页面运行。"; box.style.display = "none"; return; }
  const ctx = chartCtx(payload);
  const { g, st } = ensureStyles(type, ctx);
  const opt = CHARTS[type].build(payload, st, g, nameMap);
  if (opt.__empty) { msg.textContent = opt.__empty; box.style.display = "none"; renderStylePanel(type, true); return; }
  msg.textContent = "";
  box.style.display = "";
  box.style.width = st.width + "px";
  box.style.height = st.height + "px";
  if (!S.charts.main) S.charts.main = echarts.init(box);
  S.charts.main.clear();
  S.charts.main.resize({ width: st.width, height: st.height });
  S.charts.main.setOption(opt);
  renderStylePanel(type);
  saveStyle();
}
function renderChartOnly() {
  const type = S.current.chart;
  const payload = currentPayload();
  if (!payload) return;
  const ctx = chartCtx(payload);
  const { g, st } = ensureStyles(type, ctx);
  const opt = CHARTS[type].build(payload, st, g, nameMap);
  if (opt.__empty) return;
  const box = $("#mainChart");
  box.style.width = st.width + "px";
  box.style.height = st.height + "px";
  if (!S.charts.main) S.charts.main = echarts.init(box);
  S.charts.main.clear();
  S.charts.main.resize({ width: st.width, height: st.height });
  S.charts.main.setOption(opt);
  saveStyle();
}

/* ---------------- 样式控制面板（分组 + 自定义色带） ---------------- */
function ctrlHTML(item, val, scope) {
  const id = `ctl_${scope}_${item.k}`;
  let inp = "";
  if (item.t === "num") inp = `<input class="inp" type="number" id="${id}" value="${val}" ${item.min != null ? `min="${item.min}"` : ""} ${item.max != null ? `max="${item.max}"` : ""} step="${item.step || 1}">`;
  else if (item.t === "txt") inp = `<input class="inp" type="text" id="${id}" value="${(val || "").replace(/"/g, "&quot;")}">`;
  else if (item.t === "color") inp = `<input type="color" id="${id}" value="${val}">`;
  else if (item.t === "chk") inp = `<input type="checkbox" id="${id}" ${val ? "checked" : ""}>`;
  else if (item.t === "sel") inp = `<select class="inp" id="${id}">${item.opts.map(o => `<option value="${o[1]}" ${String(o[1]) === String(val) ? "selected" : ""}>${o[0]}</option>`).join("")}</select>`;
  return `<div class="ctrl-row"><label for="${id}">${item.label}</label>${inp}</div>`;
}

/* 自定义色带控件 */
function paletteCtrlHTML(st, scope) {
  const sel = Object.keys(PALETTES).map(k =>
    `<option value="${k}" ${st.palette === k ? "selected" : ""}>${k}</option>`).join("") +
    `<option value="__custom__" ${st.palette === "__custom__" ? "selected" : ""}>★ 自定义色带…</option>`;
  return `
  <div class="ctrl-row"><label>色带方案</label><select class="inp" id="ctl_${scope}_palSel">${sel}</select></div>
  <div class="palette-preview" id="ctl_${scope}_palPrev"></div>
  <div id="ctl_${scope}_palBox" class="custom-pal" style="display:${st.palette === "__custom__" ? "block" : "none"}">
    <div class="hint">自定义渐变色（从左到右，至少 2 个）</div>
    <div id="ctl_${scope}_palSwatches" class="pal-swatches"></div>
    <button class="btn btn-sm" id="ctl_${scope}_palAdd">+ 添加颜色</button>
  </div>
  <div class="ctrl-row"><label>反转色带</label><input type="checkbox" id="ctl_${scope}_palRev" ${st.reverse ? "checked" : ""}></div>`;
}
function bindPaletteCtrl(st, scope) {
  const selEl = $(`#ctl_${scope}_palSel`), prevEl = $(`#ctl_${scope}_palPrev`),
        boxEl = $(`#ctl_${scope}_palBox`), swEl = $(`#ctl_${scope}_palSwatches`),
        addEl = $(`#ctl_${scope}_palAdd`), revEl = $(`#ctl_${scope}_palRev`);
  if (!selEl) return;
  const updatePrev = () => {
    prevEl.innerHTML = paletteOf(st).map(c => `<span style="background:${c}"></span>`).join("");
  };
  const renderSwatches = () => {
    swEl.innerHTML = (st.customColors || []).map((c, i) => `
      <span class="pal-swatch">
        <input type="color" value="${c}" data-i="${i}">
        <button class="pal-del" data-i="${i}" title="删除">×</button>
      </span>`).join("");
    swEl.querySelectorAll("input[type=color]").forEach(el => el.oninput = () => {
      st.customColors[+el.dataset.i] = el.value;
      updatePrev(); renderChartOnly();
    });
    swEl.querySelectorAll(".pal-del").forEach(el => el.onclick = () => {
      if (st.customColors.length <= 2) { alert("自定义色带至少需要 2 个颜色"); return; }
      st.customColors.splice(+el.dataset.i, 1);
      renderSwatches(); updatePrev(); renderChartOnly();
    });
  };
  selEl.onchange = () => {
    st.palette = selEl.value;
    boxEl.style.display = st.palette === "__custom__" ? "block" : "none";
    if (st.palette === "__custom__") renderSwatches();
    updatePrev(); renderChartOnly();
  };
  addEl.onclick = () => {
    st.customColors.push("#888888");
    renderSwatches(); updatePrev(); renderChartOnly();
  };
  revEl.onchange = () => { st.reverse = revEl.checked; updatePrev(); renderChartOnly(); };
  if (st.palette === "__custom__") renderSwatches();
  updatePrev();
}

function bindCtrls(schema, target, scope) {
  schema.forEach(item => {
    if (item.t === "palette") { bindPaletteCtrl(target, scope); return; }
    const el = document.getElementById(`ctl_${scope}_${item.k}`);
    if (!el) return;
    el.oninput = el.onchange = () => {
      let v;
      if (item.t === "chk") v = el.checked;
      else if (item.t === "num") v = +el.value;
      else if (item.t === "sel") {
        const raw = el.value;
        v = (item.opts && typeof item.opts[0][1] === "number") ? +raw : raw;
      }
      else v = el.value;
      target[item.k] = v;
      renderChartOnly();
    };
  });
}

let stylePanelType = null;
function renderStylePanel(type, force) {
  if (!force && stylePanelType === type && $("#chartStyleCtrls").childElementCount) return;
  stylePanelType = type;
  const ctx = chartCtx(currentPayload());
  const { g, st } = ensureStyles(type, ctx);

  // 全局：仅字体 + 导出
  $("#globalStyleCtrls").innerHTML = GLOBAL_SCHEMA.map(i => ctrlHTML(i, g[i.k], "g")).join("");
  bindCtrls(GLOBAL_SCHEMA, g, "g");

  // 本图：按组渲染（含画布尺寸）
  const schema = CHARTS[type].schema.concat([
    { k: "width", label: "画布宽 (px)", t: "num", min: 300, max: 3600, g: "画布" },
    { k: "height", label: "画布高 (px)", t: "num", min: 300, max: 3600, g: "画布" }
  ].filter(x => !CHARTS[type].schema.some(s => s.k === x.k)));
  const groups = [];
  const byGroup = {};
  schema.forEach(item => {
    const gname = item.g || "其他";
    if (!byGroup[gname]) { byGroup[gname] = []; groups.push(gname); }
    byGroup[gname].push(item);
  });
  $("#chartStyleCtrls").innerHTML = groups.map((gname, gi) => `
    <details class="sub-group" ${gi < 2 ? "open" : ""}>
      <summary>${gname}</summary>
      <div>${byGroup[gname].map(i =>
        i.t === "palette" ? paletteCtrlHTML(st, "c") : ctrlHTML(i, st[i.k], "c")).join("")}</div>
    </details>`).join("");
  bindCtrls(schema, st, "c");
}

$("#resetStyleBtn").onclick = () => {
  const payload = currentPayload();
  const ctx = chartCtx(payload);
  S.style.global = globalDefaults();
  S.style.perChart[S.current.chart] = CHARTS[S.current.chart].defaults(ctx);
  stylePanelType = null;
  renderChart();
};

/* 变量显示名映射 */
function allKnownVars() {
  const set = new Set();
  Object.values(S.results).forEach(r => { r.result.all_x.forEach(v => set.add(v)); set.add(r.result.y); });
  const vc = getVarConfig();
  if (vc.y) set.add(vc.y);
  vc.allX.forEach(v => set.add(v));
  return Array.from(set);
}
function initVarNameCtrls() {
  $("#varNameCtrls").innerHTML = allKnownVars().map(v =>
    `<div class="ctrl-row"><label>${v}</label><input class="inp" type="text" placeholder="${v}" value="${(S.style.varNames[v] || "").replace(/"/g, "&quot;")}" data-var="${v}"></div>`).join("");
  $$("#varNameCtrls input").forEach(el => el.oninput = () => {
    const v = el.dataset.var;
    if (el.value.trim()) S.style.varNames[v] = el.value.trim();
    else delete S.style.varNames[v];
    renderChartOnly();
  });
}

/* 样式持久化（v3：坐标轴系统全面升级，启用新键避免旧缓存冲突） */
function saveStyle() { try { localStorage.setItem("gd_style_v3", JSON.stringify(S.style)); } catch (e) { } }
(function loadStyle() {
  try {
    const s = JSON.parse(localStorage.getItem("gd_style_v3"));
    if (s && s.global) S.style = s;
  } catch (e) { }
})();

/* ---------------- 导出（PNG / JPG / SVG，统一离屏渲染） ---------------- */
const extOf = g => g.exportFormat === "jpeg" ? "jpg" : g.exportFormat;
function buildExportURL(type, payload, st, g) {
  const opt = CHARTS[type].build(payload, st, g, nameMap);
  if (opt.__empty) return null;
  opt.animation = false;
  const host = $("#hiddenChartHost");
  const div = document.createElement("div");
  div.style.width = st.width + "px"; div.style.height = st.height + "px";
  host.appendChild(div);
  const ch = echarts.init(div, null, { renderer: g.exportFormat === "svg" ? "svg" : "canvas" });
  ch.setOption(opt);
  let url;
  if (g.exportFormat === "svg") {
    url = ch.getDataURL({ type: "svg" });
  } else {
    url = ch.getDataURL({ type: g.exportFormat, pixelRatio: g.pixelRatio || 3, backgroundColor: st.bgColor || "#fff" });
  }
  ch.dispose();
  host.removeChild(div);
  return url;
}
function zipAddDataURL(folder, name, url, g) {
  if (g.exportFormat === "svg") {
    const text = decodeURIComponent(url.substring(url.indexOf(",") + 1));
    folder.file(name + ".svg", text);
  } else {
    folder.file(name + "." + extOf(g), url.split(",")[1], { base64: true });
  }
}

// 当前实际显示的图类型：以激活的 tab 为准，保证“看到哪张就导出哪张”
function activeChartType() {
  const btn = document.querySelector("#chartTabs button.active");
  return btn ? btn.dataset.ct : S.current.chart;
}
$("#exportPngBtn").onclick = () => {
  const payload = currentPayload();
  if (!payload) { alert("请先选择已完成探测的文件"); return; }
  const type = activeChartType();
  S.current.chart = type;
  if (type !== "corr" && !payload.result) { alert("该文件尚未运行地理探测"); return; }
  const ctx = chartCtx(payload);
  const { g, st } = ensureStyles(type, ctx);
  const url = buildExportURL(type, payload, st, g);
  if (!url) { alert("当前图无内容可导出（请检查该图是否有数据）"); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = `${CHARTS[type].label}_${payload.fileLabel}.${extOf(g)}`;
  a.click();
};

$("#exportAllBtn").onclick = async () => {
  const ids = Object.keys(S.results);
  if (!ids.length) { alert("没有已完成的探测结果"); return; }
  const btn = $("#exportAllBtn");
  btn.disabled = true; btn.textContent = "导出中…";
  try {
    const zip = new JSZip();
    await addImagesToZip(zip, "");
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `地理探测器图表_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (e) {
    alert("导出失败：" + e.message);
  }
  btn.disabled = false; btn.textContent = "批量导出全部图 (ZIP)";
};

/* 把所有数据集的图片写入 zip 的 <prefix>图片/<数据集>/ 下 */
async function addImagesToZip(zip, prefix) {
  const g = S.style.global || globalDefaults();
  for (const id of Object.keys(S.results)) {
    const f = S.files.find(x => x.id === id);
    const label = fileBase(f.name);
    const folder = zip.folder((prefix || "") + "图片/" + label);
    const payload = { file: f, fileLabel: label, result: S.results[id].result, stats: S.stats[id] ? S.stats[id].stats : null };
    const ctx = { n: payload.result.all_x.length, nCont: payload.result.cont_vars.length };
    const types = ["factor", "interaction", "disc", "eco", "risk"].concat(payload.stats ? ["corr"] : []);
    for (const t of types) {
      const { st } = ensureStyles(t, ctx);
      const url = buildExportURL(t, payload, st, g);
      if (url) zipAddDataURL(folder, `${CHARTS[t].label}_${label}`, url, g);
      await sleep(15);
    }
  }
}

/* ================= ⑤ 结果表格 ================= */
$("#tableFileSel").onchange = renderTables;

function buildTables(id) {
  const R = S.results[id];
  if (!R) return null;
  const res = R.result, cr = R.clean_report;
  const T = {};
  T["数据清洗报告"] = {
    headers: ["原始行数", "剔除缺失", "剔除Y=0", "是否抽样", "有效样本"],
    rows: [[cr.n_raw, cr.n_na_removed, cr.n_zero_y_removed, cr.sampled ? "是" : "否", cr.n_final]]
  };
  T["因子探测结果"] = {
    headers: ["变量", "q 值", "p 值", "显著性"],
    rows: res.factor.map(f => [f.variable, fnum(f.q, 6), f.p == null ? "—" : Number(f.p).toExponential(3), sigStars(f.p) || "ns"])
  };
  if (res.interaction.length) {
    T["综合版交互作用探测表"] = {
      headers: ["变量1", "变量1_q", "变量2", "变量2_q", "交互q值", "C(交互作用)", "A+B(叠加)", "结果", "解释"],
      rows: res.interaction.map(r => [
        r.var1, fnum(r.q1, 6), r.var2, fnum(r.q2, 6), fnum(r.q12, 6),
        `${r.var1} ∩ ${r.var2} = ${fnum(r.q12, 6)}`,
        `${r.var1} + ${r.var2} = ${fnum(r.q1 + r.q2, 6)}`,
        r.relation, r.type_cn
      ])
    };
  }
  if (res.ecological.length) {
    T["生态探测结果"] = {
      headers: ["变量1", "变量2", "差异是否显著"],
      rows: res.ecological.map(r => [r.var1, r.var2, r.significant])
    };
  }
  if (res.discretization.length) {
    T["离散化最优参数"] = {
      headers: ["变量", "最优方法", "最优分级数", "最优 q", "分级断点", "各级样本数"],
      rows: res.discretization.map(d => [
        d.variable, d.best_method, d.best_n, fnum(d.best_q, 6),
        d.breaks.map(b => fnum(b, 4)).join("; "), d.interval_counts.join("; ")
      ])
    };
    T["离散化寻优全过程"] = {
      headers: ["变量", "方法", "分级数", "q 值", "是否最优"],
      rows: res.discretization.flatMap(d => d.process.map(p => [
        d.variable, p.method, p.n_intervals, p.q == null ? "无效组合" : fnum(p.q, 6),
        (p.method === d.best_method && p.n_intervals === d.best_n) ? "★ 最优" : ""
      ]))
    };
  }
  T["风险探测_分区均值"] = {
    headers: ["变量", "分级区间", "样本数", "Y 均值", "Y 标准差"],
    rows: res.risk.flatMap(d => d.groups.map(gp => [d.variable, gp.label, gp.n, fnum(gp.mean, 6), fnum(gp.sd, 6)]))
  };
  T["风险探测_显著性矩阵"] = {
    headers: ["变量", "分级1", "分级2", "t 统计量", "p 值", "差异显著"],
    rows: res.risk.flatMap(d => d.sig_matrix.map(s => [d.variable, s.itv1, s.itv2, fnum(s.t, 4), s.p == null ? "—" : Number(s.p).toExponential(3), s.significant]))
  };
  const sr = S.stats[id];
  if (sr) {
    const st = sr.stats;
    T["统计_描述与方差"] = {
      headers: ["变量", "角色", "样本数", "均值", "标准差", "方差", "变异系数(%)", "最小值", "中位数", "最大值", "唯一值数", "零方差"],
      rows: st.descriptive.map(d => [d.variable, d.role, d.n, fnum(d.mean, 6), fnum(d.sd, 6), fnum(d.variance, 6), fnum(d.cv_pct, 2), fnum(d.min, 6), fnum(d.median, 6), fnum(d.max, 6), d.n_unique, d.zero_variance ? "是" : "否"])
    };
    if (st.vif) T["统计_VIF共线性"] = {
      headers: ["变量", "VIF", "容忍度", "判定"],
      rows: st.vif.map(v => [v.variable, fnum(v.vif, 4), fnum(v.tolerance, 4), v.level])
    };
    ["pearson", "spearman"].forEach(m => {
      const co = st.correlation[m];
      T[`统计_${m}相关系数矩阵`] = {
        headers: ["变量", ...co.vars],
        rows: co.vars.map((v, i) => [v, ...co.vars.map((_, j) => fnum(co.r[i][j], 4))])
      };
    });
  }
  return T;
}

function renderTables() {
  const id = $("#tableFileSel").value;
  const T = buildTables(id);
  if (!T) { $("#tablesArea").innerHTML = `<div class="card"><p class="hint">该文件尚未运行地理探测。</p></div>`; return; }
  $("#tablesArea").innerHTML = Object.entries(T).map(([name, t], i) => `
    <details class="tbl-block" ${i < 3 ? "open" : ""}>
      <summary>${name} <button class="btn btn-sm" onclick="event.preventDefault();exportTable('${id}','${name}')">导出 CSV</button></summary>
      <div class="table-wrap">${makeTable(t.headers, t.rows)}</div>
    </details>`).join("");
}
window.exportTable = function (id, name) {
  const T = buildTables(id);
  if (!T || !T[name]) return;
  const f = S.files.find(x => x.id === id);
  const csv = toCSV(T[name].headers, T[name].rows.map(r => r.map(c => String(c).replace(/<[^>]+>/g, ""))));
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}_${fileBase(f.name)}.csv`);
};

/* ============ 一键导出全部结果（分类汇总） ============ */
// 表名 -> 类别：'stats'（数理统计）/ 'gd'（地理探测器）
const TABLE_CATEGORY = {
  "数据清洗报告": "gd", "因子探测结果": "gd", "综合版交互作用探测表": "gd",
  "生态探测结果": "gd", "离散化最优参数": "gd", "离散化寻优全过程": "gd",
  "风险探测_分区均值": "gd", "风险探测_显著性矩阵": "gd",
  "统计_描述与方差": "stats", "统计_VIF共线性": "stats",
  "统计_pearson相关系数矩阵": "stats", "统计_spearman相关系数矩阵": "stats"
};
const stripHtml = s => String(s).replace(/<[^>]+>/g, "");

// 构建一个分类的工作簿：每个表名一个 sheet，纵向堆叠所有数据集（带「数据集」列）
function buildWorkbook(category) {
  const ids = Object.keys(S.results);
  const sheets = {};   // sheetName -> aoa
  for (const id of ids) {
    const f = S.files.find(x => x.id === id);
    const dsName = fileBase(f.name);
    const T = buildTables(id);
    Object.entries(T).forEach(([name, t]) => {
      if (TABLE_CATEGORY[name] !== category) return;
      const sheetName = name.replace(/^统计_/, "").slice(0, 31);
      if (!sheets[sheetName]) sheets[sheetName] = [["数据集", ...t.headers]];
      else sheets[sheetName].push([]);  // 数据集间空行分隔
      t.rows.forEach((r, ri) => sheets[sheetName].push([ri === 0 ? dsName : "", ...r.map(stripHtml)]));
    });
  }
  if (!Object.keys(sheets).length) return null;
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([sn, aoa]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sn);
  });
  return wb;
}

$("#exportAllBundleBtn").onclick = async () => {
  const ids = Object.keys(S.results);
  if (!ids.length) { alert("没有已完成的探测结果，请先到 ③ 地理探测 运行。"); return; }
  const want = {
    train: $("#expTrain").checked, images: $("#expImages").checked,
    stats: $("#expStatsXlsx").checked, gd: $("#expGdXlsx").checked
  };
  if (!want.train && !want.images && !want.stats && !want.gd) { alert("请至少勾选一项导出内容"); return; }
  const btn = $("#exportAllBundleBtn");
  btn.disabled = true; btn.textContent = "导出中…";
  const hint = $("#exportBundleHint");
  try {
    const zip = new JSZip();
    // 1. 训练数据表（从后端取回完整 CSV）
    if (want.train) {
      hint.textContent = "正在打包训练数据表…";
      const folder = zip.folder("训练数据表");
      for (const f of S.files) {
        try {
          const r = await fetch(`/api/get_csv?id=${encodeURIComponent(f.id)}`).then(x => x.json());
          if (r.ok) folder.file(`${fileBase(f.name)}.csv`, "﻿" + r.csv);
        } catch (e) { console.warn("取训练数据失败", f.name, e); }
      }
    }
    // 2. 所有图片
    if (want.images) {
      hint.textContent = "正在渲染并打包图片…";
      await addImagesToZip(zip, "");
    }
    // 3. 数理统计 Excel
    if (want.stats) {
      hint.textContent = "正在汇总数理统计结果…";
      const wb = buildWorkbook("stats");
      if (wb) { const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }); zip.file("数理统计结果.xlsx", buf); }
    }
    // 4. 地理探测器 Excel
    if (want.gd) {
      hint.textContent = "正在汇总地理探测器结果…";
      const wb = buildWorkbook("gd");
      if (wb) { const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }); zip.file("地理探测器结果.xlsx", buf); }
    }
    hint.textContent = "正在生成 ZIP…";
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `地理探测器分析结果_${new Date().toISOString().slice(0, 10)}.zip`);
    hint.textContent = "✓ 导出完成";
  } catch (e) {
    alert("导出失败：" + e.message);
    hint.textContent = "";
  }
  btn.disabled = false; btn.textContent = "⬇ 导出选中结果 (ZIP)";
};
