/* ==============================================================
 * 地理探测器分析与制图平台 - 前端主逻辑 v2
 * ============================================================== */
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------------- 全局状态 ---------------- */
const S = {
  files: [],            // {id, name, n_rows, columns, preview}
  roles: {},            // 列名 -> 'y' | 'cont' | 'cat' | 'ignore'
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
const baseName = n => n.replace(/\.(csv|xlsx|xls)$/i, "");
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

/* ================= ① 数据上传 ================= */
const dz = $("#dropZone"), fi = $("#fileInput");
dz.onclick = () => fi.click();
dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
dz.ondragleave = () => dz.classList.remove("over");
dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); handleFiles(e.dataTransfer.files); };
fi.onchange = () => handleFiles(fi.files);

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name));
  if (!files.length) { alert("请选择 CSV 或 Excel 文件"); return; }
  dz.querySelector("p").textContent = "上传解析中，请稍候…";
  try {
    const payload = [];
    for (const f of files) payload.push({ name: f.name, b64: await fileToB64(f) });
    const resp = await api("/api/upload", { files: payload });
    for (const f of resp.files) {
      if (f.ok) S.files.push(f);
      else alert(`文件 ${f.name} 解析失败：${f.error}`);
    }
    refreshFileUI();
    if (S.files.length && !Object.keys(S.roles).length) autoDetectRoles();
    markStepDone("upload");
  } catch (e) {
    alert("上传失败：" + e.message);
  }
  dz.querySelector("p").textContent = "点击选择 或 拖拽文件到此处";
  fi.value = "";
}

function refreshFileUI() {
  $("#fileList").innerHTML = S.files.map(f => `
    <div class="file-item">
      <span class="fname">📄 ${f.name}</span>
      <span class="fmeta">${f.n_rows} 行 × ${f.columns.length} 列</span>
      <span class="${S.results[f.id] ? "file-status-ok" : "fmeta"}">${S.results[f.id] ? "✓ 已完成探测" : "未运行"}</span>
      <button class="btn-danger-text" onclick="removeFile('${f.id}')">删除</button>
    </div>`).join("");
  const opts = S.files.map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  ["previewFileSel", "statsFileSel", "runFileSel"].forEach(id => { $("#" + id).innerHTML = opts; });
  const doneOpts = S.files.filter(f => S.results[f.id]).map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  $("#chartFileSel").innerHTML = doneOpts || opts;
  $("#tableFileSel").innerHTML = doneOpts || opts;
  $("#varCard").style.display = S.files.length ? "" : "none";
  $("#previewCard").style.display = S.files.length ? "" : "none";
  renderRoleTable();
  renderPreview();
}
window.removeFile = async function (id) {
  await api("/api/remove", { id });
  S.files = S.files.filter(f => f.id !== id);
  delete S.results[id]; delete S.stats[id];
  refreshFileUI();
};

/* 变量角色 */
function unionColumns() {
  const set = new Set();
  S.files.forEach(f => f.columns.forEach(c => set.add(c)));
  return Array.from(set);
}
function autoDetectRoles() {
  S.roles = {};
  unionColumns().forEach(c => {
    const lc = c.toLowerCase().trim();
    if (lc === "y") S.roles[c] = "y";
    else if (/^x\d+$/.test(lc)) S.roles[c] = "cont";
    else S.roles[c] = "ignore";
  });
  renderRoleTable();
}
$("#autoDetectBtn").onclick = autoDetectRoles;

function renderRoleTable() {
  const cols = unionColumns();
  $("#roleTable").innerHTML = `<div class="role-grid">` + cols.map(c => {
    const role = S.roles[c] || "ignore";
    const cls = role === "y" ? "role-y" : role === "cont" ? "role-cont" : role === "cat" ? "role-cat" : "";
    return `<div class="role-item ${cls}">
      <span class="cname" title="${c}">${c}</span>
      ${["ignore|忽略", "y|Y", "cont|连续X", "cat|分类X"].map(o => {
        const [v, lab] = o.split("|");
        return `<label><input type="radio" name="role_${c}" value="${v}" ${role === v ? "checked" : ""}
          onchange="setRole('${c.replace(/'/g, "\\'")}','${v}')"> ${lab}</label>`;
      }).join("")}
    </div>`;
  }).join("") + `</div>`;
}
window.setRole = function (col, role) {
  if (role === "y") Object.keys(S.roles).forEach(c => { if (S.roles[c] === "y") S.roles[c] = "ignore"; });
  S.roles[col] = role;
  renderRoleTable();
};
function getVarConfig() {
  const y = Object.keys(S.roles).find(c => S.roles[c] === "y");
  const cont = Object.keys(S.roles).filter(c => S.roles[c] === "cont");
  const cat = Object.keys(S.roles).filter(c => S.roles[c] === "cat");
  return { y, cont, cat, allX: cont.concat(cat) };
}

/* 预览 */
$("#previewFileSel").onchange = renderPreview;
function renderPreview() {
  const f = S.files.find(x => x.id === $("#previewFileSel").value) || S.files[0];
  if (!f) { $("#previewTable").innerHTML = ""; return; }
  const rows = Array.isArray(f.preview) ? f.preview : Object.values(f.preview || {});
  $("#previewTable").innerHTML = makeTable(f.columns, rows);
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
  const opt = CHARTS.corr.build({ stats: st, fileLabel: baseName(f.name) }, defs, S.style.global || globalDefaults(), nameMap);
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
    disc_sample: +$("#discSample").value || 30000
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
  refreshFileUI();
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
    fileLabel: baseName(f.name),
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
    const g = S.style.global || globalDefaults();
    for (const id of ids) {
      const f = S.files.find(x => x.id === id);
      const label = baseName(f.name);
      const folder = zip.folder(label);
      const payload = { file: f, fileLabel: label, result: S.results[id].result, stats: S.stats[id] ? S.stats[id].stats : null };
      const ctx = { n: payload.result.all_x.length, nCont: payload.result.cont_vars.length };
      const types = ["factor", "interaction", "disc", "eco", "risk"].concat(payload.stats ? ["corr"] : []);
      for (const t of types) {
        const { st } = ensureStyles(t, ctx);
        const url = buildExportURL(t, payload, st, g);
        if (url) zipAddDataURL(folder, `${CHARTS[t].label}_${label}`, url, g);
        await sleep(20);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `地理探测器图表_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (e) {
    alert("导出失败：" + e.message);
  }
  btn.disabled = false; btn.textContent = "批量导出全部图 (ZIP)";
};

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
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}_${baseName(f.name)}.csv`);
};
$("#exportAllTablesBtn").onclick = async () => {
  const ids = Object.keys(S.results);
  if (!ids.length) { alert("没有已完成的探测结果"); return; }
  const zip = new JSZip();
  for (const id of ids) {
    const f = S.files.find(x => x.id === id);
    const folder = zip.folder(baseName(f.name));
    const T = buildTables(id);
    Object.entries(T).forEach(([name, t]) => {
      const csv = toCSV(t.headers, t.rows.map(r => r.map(c => String(c).replace(/<[^>]+>/g, ""))));
      folder.file(`${name}_${baseName(f.name)}.csv`, csv);
    });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `地理探测器结果表格_${new Date().toISOString().slice(0, 10)}.zip`);
};
