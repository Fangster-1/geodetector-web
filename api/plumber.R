# ==============================================================
# 地理探测器网站 - plumber API 路由（含面板宽表拆分）
# ==============================================================
`%||%` <- function(a, b) if (is.null(a)) b else a

# APP_ROOT 由 run_app.R 在启动时注入全局环境
source(file.path(APP_ROOT, "api", "core.R"), encoding = "UTF-8")

# 内存数据仓库：存放已上传解析的数据表 + 后台计算任务
STORE <- new.env()
STORE$files <- list()
STORE$jobs <- list()

#* @apiTitle 地理探测器分析与制图平台 API

#* 健康检查
#* @get /api/ping
#* @serializer unboxedJSON
function() list(ok = TRUE, time = format(Sys.time()))

#* 上传文件（JSON: {files: [{name, b64}]}），解析并缓存
#* @post /api/upload
#* @serializer unboxedJSON
function(req) {
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
      # 面板宽表自动识别（变量_年份 表头，如 GDP_2015 / pop2020）
      panel <- detect_panel(df)
      panel_info <- if (isTRUE(panel$is_panel)) {
        list(years = as.list(panel$years),
             dynamic_vars = as.list(panel$dynamic_vars),
             static_vars = as.list(panel$static_vars))
      } else NULL
      list(
        ok = TRUE, id = id, name = f$name,
        n_rows = nrow(df), columns = as.list(colnames(df)),
        panel = panel_info,
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

#* 面板宽表按年份拆分：选择 Y / X 变量与年份，拆分为各年份数据集并缓存
#* body: {id, years:[...], y:{kind,name}|null, x:[{kind,name},...]}
#* @post /api/panel_split
#* @serializer unboxedJSON
function(req) {
  body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
  f <- STORE$files[[body$id]]
  if (is.null(f)) return(list(ok = FALSE, error = "文件不存在，请重新上传。"))
  tryCatch({
    panel <- detect_panel(f$data)
    years <- unlist(body$years)
    if (length(years) == 0) stop("请至少选择一个年份。")
    x_sels <- body$x %||% list()
    if (is.null(body$y) && length(x_sels) == 0) stop("请至少选择一个变量。")
    sp <- split_panel(f$data, panel, years, body$y, x_sels)
    if (length(sp$datasets) == 0) {
      stop(paste0("没有任何年份可拆分。",
                  paste(sprintf("%s 年: %s", names(sp$skipped), unlist(sp$skipped)),
                        collapse = "；")))
    }
    base <- sub("\\.(csv|xlsx|xls)$", "", f$name, ignore.case = TRUE)
    out_files <- lapply(names(sp$datasets), function(yr) {
      d <- sp$datasets[[yr]]
      id <- paste0("f", format(Sys.time(), "%H%M%S"), "_",
                   paste(sample(c(letters, 0:9), 6, TRUE), collapse = ""))
      nm <- sprintf("%s_%s.csv", base, yr)
      STORE$files[[id]] <- list(name = nm, data = d)
      prev <- head(d, 5)
      prev[] <- lapply(prev, as.character)
      list(ok = TRUE, id = id, name = nm,
           n_rows = nrow(d), columns = as.list(colnames(d)),
           preview = lapply(seq_len(nrow(prev)),
                            function(i) as.list(unname(unlist(prev[i, , drop = TRUE])))))
    })
    skipped <- if (length(sp$skipped))
      lapply(names(sp$skipped), function(yr) list(year = yr, reason = sp$skipped[[yr]]))
    else list()
    list(ok = TRUE, files = out_files, skipped = skipped)
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

# ==============================================================
# 可中断的后台计算任务（callr 子进程，支持停止）
# ==============================================================

#* 启动地理探测后台任务（立即返回 job_id，前端轮询获取结果）
#* @post /api/run_start
#* @serializer unboxedJSON
function(req) {
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
                  disc_sample = body$disc_sample %||% 30000,
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
