# ==============================================================
# 地理探测器分析与制图平台 - 启动脚本
# 用法: Rscript run_app.R  （或双击 启动网站.bat）
# 启动后浏览器访问 http://127.0.0.1:8765
# ==============================================================
suppressMessages(library(plumber))

# 定位应用根目录（脚本所在文件夹）
args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
APP_ROOT <- if (length(file_arg) > 0) {
  dirname(normalizePath(sub("^--file=", "", file_arg[1])))
} else {
  normalizePath(".")
}
assign("APP_ROOT", APP_ROOT, envir = globalenv())

options(plumber.maxRequestSize = 500 * 1024^2)  # 允许上传大文件

pr <- plumber::pr(file.path(APP_ROOT, "api", "plumber.R"))
pr <- plumber::pr_static(pr, "/", file.path(APP_ROOT, "www"))

cat("\n==============================================\n")
cat("  地理探测器分析与制图平台已启动\n")
cat("  请在浏览器打开: http://127.0.0.1:8765/index.html\n")
cat("  (关闭本窗口即停止服务)\n")
cat("==============================================\n\n")

plumber::pr_run(pr, host = "127.0.0.1", port = 8765, quiet = TRUE)
