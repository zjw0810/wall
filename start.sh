#!/bin/sh
# 六味情书表白墙 · Linux 云服务器启动脚本
# 用法: ./start.sh          (默认 3000 端口)
#       PORT=80 ./start.sh  (80 端口,需 root/sudo)
cd "$(dirname "$0")"
exec node server.js
