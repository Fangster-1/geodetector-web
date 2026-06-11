# ==============================================================
# 地理探测器网站 - 核心计算模块
# 包含：文件读取、数据清洗、统计检验(VIF/相关性/方差)、
#       地理探测(因子/交互/生态/风险) + 离散化寻优过程提取
# ==============================================================
suppressMessages({
  library(GD)
  library(readxl)
  library(jsonlite)
  library(car)
})

# ---------------- 文件读取（CSV 自动识别编码 / Excel） ----------------
read_table_file <- function(raw_bytes, filename) {
  ext <- tolower(tools::file_ext(filename))
  tmp <- tempfile(fileext = paste0(".", ext))
  writeBin(raw_bytes, tmp)
  on.exit(unlink(tmp), add = TRUE)

  if (ext %in% c("xlsx", "xls")) {
    df <- as.data.frame(readxl::read_excel(tmp, sheet = 1))
  } else {
    # CSV：先按 UTF-8 读，若出现乱码/失败则回退 GBK
    df <- tryCatch({
      d <- read.csv(tmp, stringsAsFactors = FALSE, fileEncoding = "UTF-8-BOM",
                    check.names = FALSE)
      # 检查是否产生无效多字节字符
      chk <- unlist(lapply(d, function(col) if (is.character(col)) col else NULL))
      if (length(chk) > 0 && any(is.na(iconv(chk, "UTF-8", "UTF-8")))) stop("bad utf8")
      if (any(is.na(iconv(names(d), "UTF-8", "UTF-8")))) stop("bad utf8 header")
      d
    }, error = function(e) {
      read.csv(tmp, stringsAsFactors = FALSE, fileEncoding = "GBK", check.names = FALSE)
    })
  }
  names(df) <- trimws(names(df))
  df
}

# ---------------- 数据清洗 ----------------
clean_data <- function(df, y, x_vars, remove_zero_y = FALSE, max_sample = 100000) {
  all_vars <- c(y, x_vars)
  missing_cols <- setdiff(all_vars, colnames(df))
  if (length(missing_cols) > 0) {
    stop(sprintf("数据缺少所选变量列: %s", paste(missing_cols, collapse = ", ")))
  }
  n_raw <- nrow(df)
  df[all_vars] <- lapply(df[all_vars], function(col) {
    if (is.character(col)) {
      col <- trimws(col)
      col[col %in% c("<空>", "<NULL>", "NULL", "")] <- NA
    }
    suppressWarnings(as.numeric(as.character(col)))
  })
  na_rows <- !complete.cases(df[all_vars])
  n_na <- sum(na_rows)
  df <- df[!na_rows, , drop = FALSE]

  n_zero_y <- 0L
  if (isTRUE(remove_zero_y)) {
    zero_rows <- df[[y]] == 0
    n_zero_y <- sum(zero_rows)
    df <- df[!zero_rows, , drop = FALSE]
  }

  sampled <- FALSE
  if (nrow(df) > max_sample) {
    set.seed(42)
    df <- df[sample(nrow(df), max_sample), , drop = FALSE]
    sampled <- TRUE
  }

  list(
    data = df,
    report = list(
      n_raw = n_raw, n_na_removed = n_na, n_zero_y_removed = n_zero_y,
      sampled = sampled, n_final = nrow(df)
    )
  )
}

# ---------------- 统计检验：描述统计+方差 / 相关性 / VIF ----------------
stats_check <- function(df, y, x_vars) {
  all_vars <- c(y, x_vars)
  d <- df[all_vars]

  # 1. 描述统计与方差检测
  descriptive <- lapply(all_vars, function(v) {
    x <- d[[v]]
    m <- mean(x); s <- sd(x)
    list(
      variable = v,
      role = if (v == y) "Y" else "X",
      n = length(x),
      mean = m, sd = s, variance = stats::var(x),
      cv_pct = if (abs(m) > 1e-12) abs(s / m) * 100 else NA,
      min = min(x), q25 = unname(quantile(x, 0.25)),
      median = stats::median(x), q75 = unname(quantile(x, 0.75)), max = max(x),
      n_unique = length(unique(x)),
      zero_variance = isTRUE(s < 1e-12)
    )
  })

  # 2. 相关性分析（Pearson + Spearman，含显著性 p 值）
  cor_one <- function(method) {
    nv <- length(all_vars)
    rmat <- matrix(NA_real_, nv, nv); pmat <- matrix(NA_real_, nv, nv)
    for (i in 1:nv) for (j in 1:nv) {
      if (i == j) { rmat[i, j] <- 1; pmat[i, j] <- 0; next }
      ct <- suppressWarnings(stats::cor.test(d[[i]], d[[j]], method = method, exact = FALSE))
      rmat[i, j] <- unname(ct$estimate); pmat[i, j] <- ct$p.value
    }
    row_lists <- function(m) lapply(seq_len(nrow(m)), function(i) as.list(unname(m[i, ])))
    list(vars = all_vars, r = row_lists(rmat), p = row_lists(pmat))
  }
  correlation <- list(pearson = cor_one("pearson"), spearman = cor_one("spearman"))

  # 3. 共线性检测 VIF
  vif_res <- NULL; vif_note <- NULL
  if (length(x_vars) >= 2) {
    vif_try <- tryCatch({
      fml <- as.formula(paste0("`", y, "` ~ ", paste0("`", x_vars, "`", collapse = " + ")))
      vv <- car::vif(lm(fml, data = d))
      vnames <- gsub("`", "", names(vv))
      lapply(seq_along(vv), function(i) list(
        variable = vnames[i], vif = unname(vv[i]), tolerance = 1 / unname(vv[i]),
        level = if (vv[i] >= 10) "严重共线性" else if (vv[i] >= 5) "中度共线性" else "正常"
      ))
    }, error = function(e) e$message)
    if (is.character(vif_try)) vif_note <- paste("VIF 计算失败（可能存在完全共线性）:", vif_try)
    else vif_res <- vif_try
  } else {
    vif_note <- "自变量数量少于 2 个，无需进行共线性检测。"
  }

  # 4. 自动预警汇总
  warnings <- c()
  zv <- sapply(descriptive, function(x) x$zero_variance)
  if (any(zv)) warnings <- c(warnings, sprintf(
    "变量 %s 方差近似为 0（常数列），无法提供解释力，建议剔除。",
    paste(sapply(descriptive[zv], `[[`, "variable"), collapse = ", ")))
  pr <- correlation$pearson
  nv <- length(all_vars)
  for (i in 2:nv) for (j in 2:nv) {
    if (i < j) {
      r <- pr$r[[i]][[j]]
      if (!is.na(r) && abs(r) > 0.8) warnings <- c(warnings, sprintf(
        "自变量 %s 与 %s 高度相关 (r = %.3f)，交互探测结果解读需谨慎。",
        all_vars[i], all_vars[j], r))
    }
  }
  if (!is.null(vif_res)) {
    high <- Filter(function(x) x$vif >= 10, vif_res)
    if (length(high) > 0) warnings <- c(warnings, sprintf(
      "变量 %s 的 VIF ≥ 10，存在严重多重共线性。",
      paste(sapply(high, `[[`, "variable"), collapse = ", ")))
  }

  list(descriptive = descriptive, correlation = correlation,
       vif = vif_res, vif_note = vif_note, warnings = as.list(warnings))
}

# ---------------- 交互作用类型中文映射 ----------------
.interaction_cn <- function(type) {
  t <- tolower(type)
  if (grepl("enhance", t) && grepl("nonlinear", t)) return("非线性增强")
  if (grepl("enhance", t) && grepl("bi", t))        return("双因子增强")
  if (grepl("weaken", t)  && grepl("uni", t))       return("单因子非线性减弱")
  if (grepl("weaken", t)  && grepl("nonlinear", t)) return("非线性减弱")
  if (grepl("independent", t))                      return("独立")
  type
}

# ---------------- 地理探测主流程 ----------------
# disc_sample: 离散化寻优阶段的抽样上限。natural(Jenks) 等方法对大样本是
#   平方级耗时，超过该值时先抽样寻优断点，再将断点应用到全量数据做探测。
# progress_file: 子进程实时写入当前阶段，供前端轮询显示。
run_geodetector <- function(df, y, cont_vars, cat_vars,
                            methods = c("equal", "natural", "quantile", "geometric", "sd"),
                            intervals = 3:8,
                            disc_sample = 30000, progress_file = NULL) {
  note <- function(...) if (!is.null(progress_file)) {
    try(cat(sprintf(...), file = progress_file), silent = TRUE)
  }
  all_x <- c(cont_vars, cat_vars)
  if (length(all_x) == 0) stop("请至少选择一个自变量。")
  dd <- df[c(y, all_x)]
  names(dd)[1] <- ".y."

  # --- 1. 连续变量离散化寻优（提取完整寻优过程；大样本抽样加速） ---
  disc_results <- list()
  if (length(cont_vars) > 0) {
    dd_disc <- dd
    disc_sampled <- FALSE
    if (is.numeric(disc_sample) && disc_sample >= 500 && nrow(dd) > disc_sample) {
      set.seed(42)
      dd_disc <- dd[sample(nrow(dd), disc_sample), , drop = FALSE]
      disc_sampled <- TRUE
    }
    for (vi in seq_along(cont_vars)) {
      v <- cont_vars[vi]
      note("离散化寻优: %s (%d/%d)%s", v, vi, length(cont_vars),
           if (disc_sampled) sprintf("，抽样 %d 条加速", nrow(dd_disc)) else "")
      od_v <- optidisc(as.formula(paste(".y. ~", v)),
                       data = dd_disc[c(".y.", v)],
                       discmethod = methods, discitv = intervals)
      ov <- od_v[[v]]
      qm <- ov$qv.matrix   # 行=分级数, 列=方法
      # 寻优过程长表
      proc <- list()
      for (mi in seq_len(ncol(qm))) for (ii in seq_len(nrow(qm))) {
        proc[[length(proc) + 1]] <- list(
          method = colnames(qm)[mi],
          n_intervals = as.integer(rownames(qm)[ii]),
          q = if (is.na(qm[ii, mi])) NULL else unname(qm[ii, mi])
        )
      }
      # 扩展首尾断点以完全覆盖数据范围（防止浮点边界导致 cut 产生 NA）
      brk <- unique(as.numeric(ov$itv))
      brk[1] <- min(brk[1], min(dd[[v]], na.rm = TRUE))
      brk[length(brk)] <- max(brk[length(brk)], max(dd[[v]], na.rm = TRUE))
      cutf <- cut(dd[[v]], brk, include.lowest = TRUE)
      disc_results[[v]] <- list(
        variable = v,
        best_method = ov$method,
        best_n = as.integer(ov$n.itv),
        best_q = unname(max(qm, na.rm = TRUE)),
        breaks = unname(as.numeric(ov$itv)),
        interval_labels = levels(cutf),
        interval_counts = as.integer(table(cutf)),
        process = proc
      )
      dd[[v]] <- as.character(cutf)   # 替换为离散化后的层
    }
  }
  for (v in cat_vars) dd[[v]] <- as.character(dd[[v]])

  # --- 2. 四类探测 ---
  fml <- as.formula(paste(".y. ~", paste(all_x, collapse = " + ")))
  note("因子探测 (%d 个变量)", length(all_x))
  g_factor <- gd(fml, data = dd)$Factor
  factor_out <- lapply(seq_len(nrow(g_factor)), function(i) list(
    variable = g_factor$variable[i],
    q = unname(g_factor$qv[i]),
    p = unname(g_factor$sig[i])
  ))

  interaction_out <- list(); ecological_out <- list()
  if (length(all_x) >= 2) {
    note("交互探测 (%d 对组合)", choose(length(all_x), 2))
    g_inter <- gdinteract(fml, data = dd)$Interaction
    interaction_out <- lapply(seq_len(nrow(g_inter)), function(i) {
      q1 <- g_inter$qv1[i]; q2 <- g_inter$qv2[i]; q12 <- g_inter$qv12[i]
      list(
        var1 = g_inter$var1[i], var2 = g_inter$var2[i],
        q1 = unname(q1), q2 = unname(q2), q12 = unname(q12),
        type_en = g_inter$interaction[i],
        type_cn = .interaction_cn(g_inter$interaction[i]),
        relation = {
          qs <- q1 + q2; qmax <- max(q1, q2); qmin <- min(q1, q2)
          if (q12 > qs) "C > A+B"
          else if (q12 == qs) "C = A+B"
          else if (q12 > qmax) "Max(A,B) < C < A+B"
          else if (q12 > qmin) "Min(A,B) < C < Max(A,B)"
          else "C < Min(A,B)"
        }
      )
    })
    note("生态探测")
    g_eco <- gdeco(fml, data = dd)$Ecological
    ecological_out <- lapply(seq_len(nrow(g_eco)), function(i) list(
      var1 = g_eco$var1[i], var2 = g_eco$var2[i],
      significant = as.character(g_eco$eco[i])
    ))
  }

  # --- 3. 风险探测：各分区 Y 均值 + 分区间显著性差异矩阵 ---
  note("风险探测 (分区均值与 t 检验)")
  g_risk <- gdrisk(fml, data = dd)
  risk_out <- lapply(all_x, function(v) {
    # 分组均值（按区间自然顺序）
    if (v %in% cont_vars) {
      lvls <- disc_results[[v]]$interval_labels
    } else {
      uv <- unique(dd[[v]])
      num <- suppressWarnings(as.numeric(uv))
      lvls <- if (!any(is.na(num))) uv[order(num)] else sort(uv)
    }
    groups <- lapply(lvls, function(lv) {
      yy <- dd$.y.[which(dd[[v]] == lv)]
      list(label = lv, n = length(yy), mean = mean(yy, na.rm = TRUE),
           sd = if (length(yy) > 1) sd(yy, na.rm = TRUE) else 0)
    })
    sig_tab <- g_risk[[v]]
    sig_list <- if (is.data.frame(sig_tab)) lapply(seq_len(nrow(sig_tab)), function(i) list(
      itv1 = as.character(sig_tab$itv1[i]), itv2 = as.character(sig_tab$itv2[i]),
      t = unname(sig_tab$t[i]), p = unname(sig_tab$sig[i]),
      significant = as.character(sig_tab$risk[i])
    )) else list()
    list(variable = v, groups = groups, sig_matrix = sig_list)
  })
  names(risk_out) <- NULL

  note("整理结果并回传…")
  list(
    y = y, cont_vars = as.list(cont_vars), cat_vars = as.list(cat_vars),
    all_x = as.list(all_x),
    params = list(methods = as.list(methods), intervals = as.list(as.integer(intervals))),
    discretization = unname(disc_results),
    factor = factor_out,
    interaction = interaction_out,
    ecological = ecological_out,
    risk = risk_out
  )
}
