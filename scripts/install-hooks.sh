#!/bin/sh
# 安装 git 钩子（克隆仓库后运行一次）：sh scripts/install-hooks.sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cp "$DIR/scripts/git-hooks/pre-commit" "$DIR/.git/hooks/pre-commit"
chmod +x "$DIR/.git/hooks/pre-commit"
echo "✅ 已安装 pre-commit 防泄露钩子"
