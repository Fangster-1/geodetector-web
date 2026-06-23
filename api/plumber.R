# ==============================================================
# 地理探测器网站 - plumber API 路由
# ==============================================================
`%||%` <- function(a, b) if (is.null(a)) b else a

# APP_ROOT 由 run_app.R 在启动时注入全局环境
source(file.path(APP_ROOT, "api", "core.R"), encoding = "UTF-8")
source(file.path(APP_ROOT, "license", "license.R"), encoding = "UTF-8")

# 计算类接口的授权守卫：未激活时拒绝
.require_license <- function() {
  if (!lic_is_activated())
    return(list(ok = FALSE, locked = TRUE, error = "软件未激活，请在激活页输入激活码。"))
  NULL
}

# 内存数据仓库：存放已上传解析的数据表 + 后台计算任务
STORE <- new.env()
STORE$files <- list()
STORE$jobs <- list()
STORE$last_hb <- NULL       # 最近一次浏览器心跳时间
STORE$hb_timeout <- 90      # 秒：超过此时长收不到心跳则自动停止后端
                            # （设 >60s 以兼容浏览器对后台标签页的 setInterval 节流）

# ---- 心跳看门狗：浏览器全部关闭后自动停止后端服务 ----
# 仅在「曾经收到过心跳」后才会触发，避免启动后还没打开浏览器就退出
.gd_watchdog <- function() {
  hb <- STORE$last_hb
  if (!is.null(hb) && as.numeric(difftime(Sys.time(), hb, units = "secs")) > STORE$hb_timeout) {
    cat("\n[自动关闭] 检测到浏览器已关闭，正在停止后端服务...\n")
    try(httpuv::stopAllServers(), silent = TRUE)
    quit(save = "no", status = 0)
  }
  later::later(.gd_watchdog, 4)
}
if (requireNamespace("later", quietly = TRUE)) later::later(.gd_watchdog, 5)

#* @apiTitle 地理探测器分析与制图平台 API

# ---- 全局过滤器：禁止缓存，确保每次加载都是最新前端 ----
#* @filter nocache
function(req, res) {
  res$setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  res$setHeader("Pragma", "no-cache")
  res$setHeader("Expires", "0")
  plumber::forward()
}

#* 首页（显式提供 index.html 并禁缓存，彻底避免浏览器加载旧页面）
#* @get /
#* @get /index.html
#* @serializer html
function(res) {
  res$setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  paste(readLines(file.path(APP_ROOT, "www", "index.html"), warn = FALSE, encoding = "UTF-8"),
        collapse = "\n")
}

#* 健康检查
#* @get /api/ping
#* @serializer unboxedJSON
function() list(ok = TRUE, time = format(Sys.time()))

#* 浏览器心跳：维持后端存活；停止心跳即触发自动关闭
#* @get /api/heartbeat
#* @serializer unboxedJSON
function() { STORE$last_hb <- Sys.time(); list(ok = TRUE) }

#* 授权状态（机器码 + 是否已激活）
#* @get /api/license
#* @serializer unboxedJSON
function() lic_status()

#* 提交激活码
#* @post /api/activate
#* @serializer unboxedJSON
function(req) {
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  lic_activate(body$code)
}

#* 上传文件（JSON: {files: [{name, b64}]}），解析并缓存
#* @post /api/upload
#* @serializer unboxedJSON
function(req) {
  g <- .require_license(); if (!is.null(g)) return(g)
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  out <- lapply(body$files, function(f) {
    tryCatch({
      raw_bytes <- jsonlite::base64_dec(f$b64)
      df <- read_table_file(raw_bytes, f$name)
      id <- paste0("f", format(Sys.time(), "%H%M%S"), "_",
                   paste(sample(c(letters, 0:9), 6, TRUE), collapse = ""))
      STORE$files[[id]] <- list(name = f$name, data = df)
      # 预览前 5 行（保证序列化为数组的数组）
      prev <- head(df, 5)
      prev[] <- lapply(prev, as.character)
      list(
        ok = TRUE, id = id, name = f$name,
        n_rows = nrow(df), columns = as.list(colnames(df)),
        preview = lapply(seq_len(nrow(prev)),
                         function(i) as.list(unname(unlist(prev[i, , drop = TRUE]))))
      )
    }, error = function(e) list(ok = FALSE, name = f$name, error = conditionMessage(e)))
  })
  list(files = out)
}

#* 基础统计检验：描述统计/方差、相关性、VIF
#* @post /api/stats
#* @serializer unboxedJSON
function(req) {
  g <- .require_license(); if (!is.null(g)) return(g)
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  f <- STORE$files[[body$id]]
  if (is.null(f)) return(list(ok = FALSE, error = "文件不存在，请重新上传。"))
  tryCatch({
    cleaned <- clean_data(f$data, body$y, unlist(body$x),
                          remove_zero_y = isTRUE(body$remove_zero_y),
                          max_sample = body$max_sample %||% 100000)
    res <- stats_check(cleaned$data, body$y, unlist(body$x))
    list(ok = TRUE, name = f$name, clean_report = cleaned$report, stats = res)
  }, error = function(e) list(ok = FALSE, error = conditionMessage(e)))
}

#* 运行地理探测（单文件；批量由前端循环调用）
#* @post /api/run
#* @serializer unboxedJSON
function(req) {
  g <- .require_license(); if (!is.null(g)) return(g)
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  f <- STORE$files[[body$id]]
  if (is.null(f)) return(list(ok = FALSE, error = "文件不存在，请重新上传。"))
  tryCatch({
    cont <- unlist(body$cont) %||% character(0)
    catv <- unlist(body$cat) %||% character(0)
    cleaned <- clean_data(f$data, body$y, c(cont, catv),
                          remove_zero_y = isTRUE(body$remove_zero_y),
                          max_sample = body$max_sample %||% 100000)
    if (cleaned$report$n_final < 10) stop("清洗后有效样本不足 10 条，无法计算。")
    res <- run_geodetector(
      cleaned$data, body$y, cont, catv,
      methods = unlist(body$methods),
      intervals = as.integer(unlist(body$intervals))
    )
    list(ok = TRUE, name = f$name, clean_report = cleaned$report, result = res)
  }, error = function(e) list(ok = FALSE, error = conditionMessage(e)))
}

#* 删除已上传文件缓存
#* @post /api/remove
#* @serializer unboxedJSON
function(req) {
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  STORE$files[[body$id]] <- NULL
  list(ok = TRUE)
}

#* 清空全部缓存（原始表、拆分数据集、运行中的任务）
#* @post /api/clear_all
#* @serializer unboxedJSON
function() {
  # 杀掉所有未结束的后台任务
  for (j in STORE$jobs) try(if (!is.null(j$proc) && j$proc$is_alive()) j$proc$kill(), silent = TRUE)
  STORE$files <- list()
  STORE$jobs <- list()
  list(ok = TRUE)
}

#* 按指定列拆分原始表为多个年度数据集（列选择/重命名逻辑由前端给出）
#* body: { id, datasets: [{ name, src_cols:[...], new_cols:[...] }] }
#* @post /api/split
#* @serializer unboxedJSON
function(req) {
  g <- .require_license(); if (!is.null(g)) return(g)
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  f <- STORE$files[[body$id]]
  if (is.null(f)) return(list(ok = FALSE, error = "原始文件不存在，请重新上传。"))
  raw <- f$data
  out <- lapply(body$datasets, function(ds) {
    tryCatch({
      src <- unlist(ds$src_cols); new <- unlist(ds$new_cols)
      missing <- setdiff(src, colnames(raw))
      if (length(missing) > 0) stop(sprintf("缺少列: %s", paste(missing, collapse = ", ")))
      df <- raw[, src, drop = FALSE]
      colnames(df) <- new
      id <- paste0("d", format(Sys.time(), "%H%M%S"), "_",
                   paste(sample(c(letters, 0:9), 6, TRUE), collapse = ""))
      STORE$files[[id]] <- list(name = ds$name, data = df)
      prev <- head(df, 5); prev[] <- lapply(prev, as.character)
      list(ok = TRUE, id = id, name = ds$name,
           n_rows = nrow(df), columns = as.list(colnames(df)),
           preview = lapply(seq_len(nrow(prev)),
                            function(i) as.list(unname(unlist(prev[i, , drop = TRUE])))))
    }, error = function(e) list(ok = FALSE, name = ds$name, error = conditionMessage(e)))
  })
  list(ok = TRUE, datasets = out)
}

#* 取回某个已存数据集的完整 CSV 文本（用于导出训练数据）
#* @get /api/get_csv
#* @serializer unboxedJSON
function(id = "") {
  g <- .require_license(); if (!is.null(g)) return(g)
  f <- STORE$files[[id]]
  if (is.null(f)) return(list(ok = FALSE, error = "数据集不存在。"))
  tmp <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp), add = TRUE)
  # write_excel_csv 带 UTF-8 BOM，Excel 可直接打开
  utils::write.csv(f$data, tmp, row.names = FALSE, fileEncoding = "UTF-8")
  txt <- paste(readLines(tmp, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  list(ok = TRUE, name = f$name, csv = txt)
}

# ==============================================================
# 可中断的后台计算任务（callr 子进程，支持停止）
# ==============================================================

#* 启动地理探测后台任务（立即返回 job_id，前端轮询获取结果）
#* @post /api/run_start
#* @serializer unboxedJSON
function(req) {
  g <- .require_license(); if (!is.null(g)) return(g)
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  f <- STORE$files[[body$id]]
  if (is.null(f)) return(list(ok = FALSE, error = "文件不存在，请重新上传。"))
  tryCatch({
    cont <- unlist(body$cont) %||% character(0)
    catv <- unlist(body$cat) %||% character(0)
    cleaned <- clean_data(f$data, body$y, c(cont, catv),
                          remove_zero_y = isTRUE(body$remove_zero_y),
                          max_sample = body$max_sample %||% 100000)
    if (cleaned$report$n_final < 10) stop("清洗后有效样本不足 10 条，无法计算。")

    job_id <- paste0("job", format(Sys.time(), "%H%M%S"), "_",
                     paste(sample(c(letters, 0:9), 6, TRUE), collapse = ""))
    core_path <- file.path(APP_ROOT, "api", "core.R")
    prog_file <- tempfile(pattern = paste0(job_id, "_prog"), fileext = ".txt")
    # 子进程 stdout/stderr 重定向到文件：避免管道缓冲写满导致子进程永久阻塞
    px <- callr::r_bg(
      function(core_path, data, y, cont, catv, methods, intervals,
               disc_sample, progress_file) {
        source(core_path, encoding = "UTF-8")
        run_geodetector(data, y, cont, catv, methods = methods, intervals = intervals,
                        disc_sample = disc_sample, progress_file = progress_file)
      },
      args = list(core_path = core_path, data = cleaned$data, y = body$y,
                  cont = cont, catv = catv,
                  methods = unlist(body$methods),
                  intervals = as.integer(unlist(body$intervals)),
                  disc_sample = body$disc_sample %||% 50000,
                  progress_file = prog_file),
      stdout = paste0(prog_file, ".out"),
      stderr = paste0(prog_file, ".err"),
      supervise = TRUE
    )
    STORE$jobs[[job_id]] <- list(proc = px, name = f$name,
                                 clean_report = cleaned$report,
                                 progress = prog_file,
                                 started = Sys.time(), killed = FALSE)
    list(ok = TRUE, job_id = job_id, clean_report = cleaned$report)
  }, error = function(e) list(ok = FALSE, error = conditionMessage(e)))
}

#* 轮询任务状态：running / done / error / stopped（running 时附当前计算阶段）
#* @get /api/run_poll
#* @serializer unboxedJSON
function(job_id = "") {
  j <- STORE$jobs[[job_id]]
  if (is.null(j)) return(list(ok = FALSE, error = "任务不存在或已被清理。"))
  read_stage <- function() {
    if (!is.null(j$progress) && file.exists(j$progress)) {
      tryCatch(paste(readLines(j$progress, warn = FALSE), collapse = " "),
               error = function(e) "")
    } else ""
  }
  if (j$proc$is_alive()) {
    return(list(ok = TRUE, status = "running",
                stage = read_stage(),
                elapsed = round(as.numeric(difftime(Sys.time(), j$started, units = "secs")), 1)))
  }
  STORE$jobs[[job_id]] <- NULL
  cleanup <- function() try(unlink(c(j$progress, paste0(j$progress, ".out"),
                                     paste0(j$progress, ".err"))), silent = TRUE)
  if (isTRUE(j$killed)) { cleanup(); return(list(ok = TRUE, status = "stopped")) }
  res <- tryCatch(j$proc$get_result(), error = function(e) e)
  if (inherits(res, "error")) {
    # 附上子进程 stderr 末尾，便于定位真实报错
    errfile <- paste0(j$progress, ".err")
    detail <- if (file.exists(errfile)) {
      tl <- tryCatch(readLines(errfile, warn = FALSE), error = function(e) character(0))
      paste(utils::tail(tl, 5), collapse = " | ")
    } else ""
    cleanup()
    return(list(ok = TRUE, status = "error",
                message = paste0(conditionMessage(res),
                                 if (nzchar(detail)) paste0("（子进程输出: ", detail, "）") else "")))
  }
  cleanup()
  list(ok = TRUE, status = "done", clean_report = j$clean_report, result = res)
}

#* 停止任务（杀掉计算子进程，立即释放资源）
#* @post /api/run_stop
#* @serializer unboxedJSON
function(req) {
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  j <- STORE$jobs[[body$job_id]]
  if (is.null(j)) return(list(ok = TRUE, status = "not_found"))
  try(j$proc$kill(), silent = TRUE)
  try(unlink(c(j$progress, paste0(j$progress, ".out"), paste0(j$progress, ".err"))), silent = TRUE)
  STORE$jobs[[body$job_id]] <- NULL
  list(ok = TRUE, status = "stopped")
}
