# ==============================================================
# 一次性：生成 Ed25519 授权密钥对
#   私钥 -> tools/keygen_private.txt   （供应商本地保管，绝不分发！）
#   公钥 -> license/pubkey.txt         （随软件分发，公开也安全）
# 用法: Rscript tools/gen_keys.R    （已存在则不覆盖，除非加 --force）
# ==============================================================
suppressMessages(library(sodium))
args <- commandArgs(trailingOnly = TRUE)
root <- dirname(dirname(normalizePath(sub("^--file=", "",
        grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))))
priv_path <- file.path(root, "tools", "keygen_private.txt")
pub_path  <- file.path(root, "license", "pubkey.txt")

if (file.exists(priv_path) && !("--force" %in% args)) {
  cat("密钥已存在，未覆盖。如确需重建请加 --force（会使旧激活码全部失效）。\n")
  quit(save = "no")
}
key <- sig_keygen()
pub <- sig_pubkey(key)
writeLines(bin2hex(key), priv_path)
writeLines(bin2hex(pub), pub_path)
cat("✓ 私钥已写入:", priv_path, "（保密！加入 .gitignore）\n")
cat("✓ 公钥已写入:", pub_path, "（随软件分发）\n")
cat("公钥指纹:", substr(bin2hex(pub), 1, 16), "...\n")
