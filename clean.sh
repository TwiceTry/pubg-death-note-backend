#!/bin/bash
# PUBG Death Note Backend - 项目清理脚本
# 用于清理编译产物、依赖、数据库和运行时数据，恢复到干净的初始状态

set -e

echo "=== PUBG Death Note Backend 清理脚本 ==="
echo ""

# 1. 清理编译产物
echo "[1/5] 清理编译产物 (dist/)..."
rm -rf dist
echo "  ✓ dist/ 已删除"

# 2. 清理依赖
echo "[2/5] 清理依赖 (node_modules/)..."
rm -rf node_modules
echo "  ✓ node_modules/ 已删除"

# 3. 清理数据库
echo "[3/5] 清理数据库 (*.db)..."
rm -f *.db
rm -f data/*.db 2>/dev/null || true
echo "  ✓ 数据库文件已删除"

# 4. 清理日志
echo "[4/5] 清理日志 (logs/)..."
rm -rf logs
echo "  ✓ logs/ 已删除"

# 5. 清理游戏数据
echo "[5/5] 清理游戏数据 (game-data/)..."
rm -rf game-data
echo "  ✓ game-data/ 已删除"

echo ""
echo "=== 清理完成 ==="
echo ""
echo "后续操作："
echo "  1. npm install          # 重新安装依赖"
echo "  2. npx prisma migrate deploy  # 初始化数据库"
echo "  3. npm run start:dev    # 启动服务"
