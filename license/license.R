# ==============================================================
# 授权核心模块（机器指纹 + Ed25519 离线节点锁定）
# 被 plumber.R 引用；依赖 sodium
# ==============================================================
suppressMessages(library(sodium))

# 公钥文件路径（与本脚本同目录）
.lic_dir <- function() {
  d <- tryCatch(dirname(sys.frame(1)$ofile), error = function(e) NA)
  if (is.na(d) || is.null(d)) d <- file.path(get0("APP_ROOT", ifnotfound = "."), "license")
  d
}
.LIC_PUBKEY_PATH <- file.path(get0("APP_ROOT", ifnotfound = "."), "license", "pubkey.txt")

# ---- 许可文件位置：放用户可写目录，便于 Program Files 只读安装 ----
lic_store_dir <- function() {
  base <- Sys.getenv("LOCALAPPDATA", unset = Sys.getenv("APPDATA", unset = tempdir()))
  d <- file.path(base, "GeoDetectorPro")
  if (!dir.exists(d)) dir.create(d, recursive = TRUE, showWarnings = FALSE)
  d
}
lic_file_path <- function() file.path(lic_store_dir(), "license.dat")

# ---- 机器指纹采集（Windows，PowerShell CIM；失败回退 wmic/registry） ----
.ps <- function(cmd) {
  out <- tryCatch(
    system2("powershell", c("-NoProfile", "-Command", shQuote(cmd)),
            stdout = TRUE, stderr = FALSE),
    error = function(e) character(0))
  trimws(paste(out, collapse = ""))
}
.fingerprint_parts <- function() {
  uuid <- .ps("(Get-CimInstance Win32_ComputerSystemProduct).UUID")
  guid <- .ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid")
  cpu  <- .ps("(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId")
  # 过滤无效占位值
  bad <- function(x) is.na(x) || x == "" || grepl("^(default string|to be filled|none|0+)$",
                                                   x, ignore.case = TRUE)
  parts <- c(UUID = uuid, GUID = guid, CPU = cpu)
  parts[!vapply(parts, bad, logical(1))]
}

# 规范机器码：sha256(指纹) 取前 24 hex 大写（96 位，足够防碰撞），无分隔
lic_machine_code <- function() {
  parts <- .fingerprint_parts()
  if (length(parts) < 2) return("UNAVAILABLE")
  raw <- paste(parts, collapse = "|")
  toupper(substr(bin2hex(sha256(charToRaw(raw))), 1, 24))
}
# 展示用：分组 XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
lic_machine_display <- function(mc = lic_machine_code()) {
  paste(substring(mc, seq(1, nchar(mc), 4), seq(4, nchar(mc), 4)), collapse = "-")
}
# 归一化用户输入（去分隔符、大写）
.canon <- function(s) toupper(gsub("[^0-9A-Za-z]", "", as.character(s)))

# ---- 公钥 ----
lic_pubkey <- function() {
  p <- .LIC_PUBKEY_PATH
  if (!file.exists(p)) return(NULL)
  tryCatch(hex2bin(trimws(readLines(p, warn = FALSE)[1])), error = function(e) NULL)
}

# ---- 验签：激活码(base16/base64) 对 机器码 的 Ed25519 签名 ----
.verify <- function(machine_code, activation_code) {
  pub <- lic_pubkey()
  if (is.null(pub)) return(FALSE)
  sig <- tryCatch(hex2bin(.canon_hex(activation_code)), error = function(e) NULL)
  if (is.null(sig) || length(sig) != 64) return(FALSE)
  isTRUE(tryCatch(
    sig_verify(charToRaw(.canon(machine_code)), sig, pub),
    error = function(e) FALSE))
}
# 激活码以 hex 传输（去分隔/空白）
.canon_hex <- function(s) tolower(gsub("[^0-9A-Fa-f]", "", as.character(s)))

# ---- 读/写许可文件 ----
.read_license <- function() {
  p <- lic_file_path()
  if (!file.exists(p)) return(NULL)
  tryCatch(jsonlite::fromJSON(readLines(p, warn = FALSE), simplifyVector = TRUE),
           error = function(e) NULL)
}
.write_license <- function(machine_code, activation_code) {
  obj <- list(machine_code = .canon(machine_code),
              activation_code = .canon_hex(activation_code),
              activated_at = format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
  writeLines(jsonlite::toJSON(obj, auto_unbox = TRUE), lic_file_path())
}

# ---- 对外：是否已激活（每次都用当前机器重新验签） ----
lic_is_activated <- function() {
  lf <- .read_license()
  if (is.null(lf)) return(FALSE)
  mc <- lic_machine_code()
  if (mc == "UNAVAILABLE") return(FALSE)
  # 许可中机器码必须等于本机当前机器码，且签名有效
  if (!identical(.canon(lf$machine_code), mc)) return(FALSE)
  .verify(mc, lf$activation_code)
}

# ---- 对外：授权状态 ----
lic_status <- function() {
  mc <- lic_machine_code()
  list(
    activated = lic_is_activated(),
    machine_code = mc,
    machine_display = if (mc == "UNAVAILABLE") "采集失败" else lic_machine_display(mc),
    has_pubkey = !is.null(lic_pubkey())
  )
}

# ---- 对外：执行激活 ----
lic_activate <- function(code) {
  mc <- lic_machine_code()
  if (mc == "UNAVAILABLE")
    return(list(ok = FALSE, error = "无法采集本机硬件指纹，请以管理员身份运行或联系作者。"))
  if (is.null(code) || nchar(.canon_hex(code)) < 16)
    return(list(ok = FALSE, error = "激活码为空或格式不正确。"))
  if (!.verify(mc, code))
    return(list(ok = FALSE, error = "激活码无效（与本机机器码不匹配，或激活码有误）。"))
  tryCatch({
    .write_license(mc, code)
    list(ok = TRUE, activated = TRUE)
  }, error = function(e) list(ok = FALSE, error = paste("写入许可失败:", conditionMessage(e))))
}
