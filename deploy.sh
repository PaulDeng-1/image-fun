#!/usr/bin/env bash
# ============================================================
# image-fun 一键部署脚本（Ubuntu 22.04 / Debian 12）
# 用法：bash deploy.sh
# ============================================================

set -e
set -o pipefail  # pipe 里任意命令失败就停
# 用 /var/log 而不是 /tmp —— OrcaTerm Web 终端会把 /tmp 映射到用户 Windows 本机的 Temp，写入会失败
LOG=/var/log/image-fun-deploy.log
exec > >(tee -a "$LOG") 2>&1

banner() {
  echo ""
  echo "=================================================="
  echo "$1"
  echo "=================================================="
}

# 0. PATH 刷新（如果脚本开头 Node.js 刚装好，PATH 可能还没包含 /opt/nodejs20/bin）
export PATH=/opt/nodejs20/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 1. 检测
banner "[1/8] 环境检测"
echo "系统: $(cat /etc/os-release | grep PRETTY_NAME | head -1)"
if [ "$EUID" -ne 0 ]; then
  echo "❌ 需要 root 权限，请 sudo bash deploy.sh"
  exit 1
fi
echo "✓ root OK"

# 2. 装基础工具
banner "[2/8] 装基础工具（git / nginx / curl）"
apt-get update -qq 2>&1 | tail -3
apt-get install -y git nginx curl 2>&1 | tail -3

# 3. 装 Node.js 20（如果 /opt/nodejs20 不存在，下载官方 tarball）
banner "[3/8] 装 Node.js 20"
if [ ! -x /opt/nodejs20/bin/node ]; then
  echo "下载 Node.js 20 官方 tarball..."
  cd /opt
  # 国内 mirror（npmmirror 同步了 nodejs.org 全部版本）；如不通自动 fallback 官方
  if curl -fsSL --max-time 60 https://registry.npmmirror.com/-/binary/node/v20.19.0/node-v20.19.0-linux-x64.tar.gz -o node.tar.gz; then
    echo "✓ 从 npmmirror 下载成功"
  elif curl -fsSL --max-time 60 https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.gz -o node.tar.gz; then
    echo "✓ 从 nodejs.org 下载成功"
  else
    echo "❌ Node.js 下载失败，请检查网络"
    exit 1
  fi
  tar -xzf node.tar.gz
  mv node-v20.19.0-linux-x64 nodejs20
  rm node.tar.gz
  # 软链到 /usr/local/bin 让 PATH 能找到
  ln -sf /opt/nodejs20/bin/node /usr/local/bin/node
  ln -sf /opt/nodejs20/bin/npm /usr/local/bin/npm
  ln -sf /opt/nodejs20/bin/npx /usr/local/bin/npx
  echo 'export PATH=/opt/nodejs20/bin:$PATH' > /etc/profile.d/nodejs.sh
  chmod +x /etc/profile.d/nodejs.sh
fi
node -v
npm -v
echo "✓ Node.js 就绪"

# 4. 装 PM2（如果还没装）
banner "[4/8] 装 PM2"
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --registry=https://registry.npmmirror.com 2>&1 | tail -3
  ln -sf /opt/nodejs20/bin/pm2 /usr/local/bin/pm2 2>/dev/null || true
fi
pm2 -v

# 5. 防火墙（Ubuntu 用 ufw；腾讯云轻量云安全组要在 Web 面板另开 80）
banner "[5/8] 防火墙（ufw）"
if command -v ufw &>/dev/null; then
  ufw allow 80/tcp 2>&1 | tail -2
  ufw allow OpenSSH 2>&1 | tail -2
  echo "✓ ufw 80 端口已放通"
else
  echo "ℹ️ ufw 不存在（腾讯云轻量云常见），由安全组管控"
fi

# 6. 拉代码
banner "[6/8] 拉代码（GitHub）"
mkdir -p /opt
if [ ! -d /opt/image-fun ]; then
  echo "需要 GitHub PAT（Personal Access Token，repo 权限）"
  echo "到 https://github.com/settings/tokens/new 生成，粘贴到这里："
  read -s GITHUB_PAT
  echo ""
  if [ -z "$GITHUB_PAT" ]; then
    echo "❌ PAT 不能为空"
    exit 1
  fi
  git clone "https://PaulDeng-1:${GITHUB_PAT}@github.com/PaulDeng-1/image-fun.git" /opt/image-fun
else
  echo "代码已存在，跳过 clone"
  cd /opt/image-fun
  git pull
fi
cd /opt/image-fun

# 7. .env.local（粘贴本地 .env.local 内容）
banner "[7/8] 配置 .env.local"
if [ ! -f .env.local ]; then
  echo "请把本地 .env.local 内容贴进来（一整坨），按 Ctrl+D 结束："
  echo "（去本地 F:\\生图网站\\.env.local 全选复制）"
  echo ""
  cat > .env.local
  echo "✓ .env.local 已写入"
  echo "内容预览（前 3 行）："
  head -3 .env.local
fi

# 8. 装依赖 + build + 启服务
banner "[8/8] npm install + build + PM2 + Nginx"
echo "（这一步 5-10 分钟）"

# 内存预警：Ubuntu 22.04 默认有 2GB，build 期间峰值可能 1.8GB+
AVAIL_MEM_MB=$(free -m | awk '/^Mem:/ {print $7}')
echo "可用内存: ${AVAIL_MEM_MB}MB"
if [ "$AVAIL_MEM_MB" -lt 600 ]; then
  echo "⚠️ 内存严重不足（<600MB），建议先 swap 或升级配置"
fi

npm install --registry=https://registry.npmmirror.com 2>&1 | tail -8 || { echo "❌ npm install 失败"; exit 1; }

# 验证 next 真的装上了（之前 deploy.sh 漏了 pipefail，install 失败 build 也继续）
if [ ! -x node_modules/.bin/next ]; then
  echo "❌ next 没装上，检查 npm install 输出（被 tail 截断）"
  echo "手动跑: cd /opt/image-fun && npm install --registry=https://registry.npmmirror.com"
  exit 1
fi

# sharp 在 Linux 上通常自带预编译 binary，不需要 gcc；如果失败会自己编译
echo ""
echo "Build（Next.js prod，可能 3-5 分钟）..."
NODE_OPTIONS="--max-old-space-size=1400" npm run build 2>&1 | tail -20 || { echo "❌ build 失败"; exit 1; }

# PM2 启动：用绝对路径避免 PM2 fork mode 不继承 PATH
pm2 delete image-fun 2>/dev/null || true
cd /opt/image-fun
NODE_OPTIONS="--max-old-space-size=1400" pm2 start /opt/nodejs20/bin/npm --name image-fun -- start
pm2 save
pm2 startup systemd -u root --hp /root | tail -3 || true

# Nginx
cat > /etc/nginx/conf.d/image-fun.conf <<'NGINX_EOF'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 25M;  # i2i 允许上传最大 25MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 生成 API 单次最长 180s
        proxy_read_timeout 200s;
        proxy_send_timeout 200s;
    }
}
NGINX_EOF
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# 9. 注册 cleanup cron（P1 修复）
# 背景：/api/cron/cleanup-generations 本来给 Vercel Cron 用，
# 但部署在腾讯云轻量云上 Vercel Cron 不会触发 → deleted_at 30 天前的行
# 永远不删 → Storage 持续涨。
# 修法：用系统 crontab 每天 3:30 AM 调一次本机端点。
# 选 3:30（不是整点）避开各种整点跑批的高峰。
banner "[9/9] 注册 cleanup cron"
if [ -z "${CRON_SECRET:-}" ]; then
  # 没传 CRON_SECRET 就从 .env.local 拿（部署时常会从环境传进来）
  if [ -f /opt/image-fun/.env.local ]; then
    CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/image-fun/.env.local | head -1 | cut -d= -f2- | tr -d '"' "'" )
  fi
fi
if [ -z "$CRON_SECRET" ] || [ "$CRON_SECRET" = "replace-me-with-random-32-byte-hex" ]; then
  echo "⚠️  CRON_SECRET 未配置或还是占位值，跳过 cron 注册"
  echo "    手动设置后跑：bash deploy.sh 重试，或手动 crontab -e 加："
  echo "    30 3 * * * curl -fsS -H 'Authorization: Bearer \$CRON_SECRET' http://127.0.0.1:3000/api/cron/cleanup-generations"
else
  CRON_LINE="30 3 * * * curl -fsS -H 'Authorization: Bearer ${CRON_SECRET}' http://127.0.0.1:3000/api/cron/cleanup-generations >> /var/log/image-fun-cleanup.log 2>&1"
  # 幂等：检查是否已存在
  EXISTING=$(crontab -l 2>/dev/null | grep -F "/api/cron/cleanup-generations" || true)
  if [ -n "$EXISTING" ]; then
    echo "✓ cleanup cron 已存在，跳过注册"
    echo "  当前条目：$EXISTING"
  else
    # 保留现有 crontab，追加新行
    ( crontab -l 2>/dev/null || true; echo "$CRON_LINE" ) | crontab -
    echo "✓ cleanup cron 已注册（每天 3:30 AM）"
    echo "  条目：$CRON_LINE"
  fi
  echo "  日志：tail -f /var/log/image-fun-cleanup.log"
fi

# 完成
banner "✅ 部署完成"
echo ""
echo "🌐 公网访问: http://49.234.58.150"
echo ""
echo "📋 常用命令："
echo "  pm2 status                # 看进程状态"
echo "  pm2 logs image-fun        # 看 Next.js 日志"
echo "  pm2 restart image-fun     # 重启应用"
echo "  tail -f $LOG              # 看部署日志"
echo ""
echo "⚠️ 别忘了：腾讯云轻量云控制台 → 防火墙 → 添加规则 → 放通 80 端口"
echo ""
echo "测一下："
echo "  curl -I http://127.0.0.1:3000   # 测本地"
echo "  curl -I http://49.234.58.150    # 测公网（如果不通 = 安全组没放 80）"
echo ""
echo "📝 完整日志: $LOG"