# ==============================================================
# 激活码生成器（供应商专用，绝不随软件分发）
# 用私钥对客户机器码签名，生成激活码。
# 用法:
#   Rscript tools/keygen.R <客户的机器码>
#   或不带参数则交互式输入
# ==============================================================
suppressMessages(library(sodium))
root <- dirname(dirname(normalizePath(sub("^--file=", "",
        grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))))
priv_path <- file.path(root, "tools", "keygen_private.txt")
if (!file.exists(priv_path)) stop("找不到私钥 tools/keygen_private.txt，请先运行 gen_keys.R")
key <- hex2bin(trimws(readLines(priv_path, warn = FALSE)[1]))

args <- commandArgs(trailingOnly = TRUE)
mc_in <- if (length(args) >= 1) args[1] else {
  cat("请粘贴客户提供的机器码（可带分隔符）：\n")
  readLines(con = "stdin", n = 1)
}
mc <- toupper(gsub("[^0-9A-Za-z]", "", mc_in))
if (nchar(mc) < 16) stop("机器码长度异常，请检查。")

sig <- sig_sign(charToRaw(mc), key)        # 64 字节签名
act <- bin2hex(sig)                         # 128 hex 激活码
# 分组便于抄写：每 8 个一组
grp <- paste(substring(act, seq(1, nchar(act), 8), seq(8, nchar(act), 8)), collapse = "-")

cat("\n========== 激活码（发给客户） ==========\n")
cat("机器码 :", mc, "\n")
cat("激活码 :\n", grp, "\n", sep = "")
cat("（客户输入时分隔符可有可无）\n")
cat("=======================================\n")
