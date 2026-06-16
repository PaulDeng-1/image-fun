#!/usr/bin/env bash
# ============================================================
# image-fun 一键部署脚本（OpenCloudOS / CentOS / RHEL 衍生版）
# 用法：在 OrcaTerm 终端里 bash deploy.sh
# ============================================================

set -e
LOG=/tmp/image-fun-deploy.log
exec > >(tee -a "$LOG") 2>&1

banner() {
  echo ""
  echo "=================================================="
  echo "$1"
  echo "=================================================="
}

# 1. 检测
banner "[1/8] 环境检测"
echo "系统: $(cat /etc/os-release | grep PRETTY_NAME | head -1)"
if [ "$EUID" -ne 0 ]; then
  echo "❌ 需要 root 权限，请 sudo bash deploy.sh"
  exit 1
fi
echo "✓ root OK"

# 2. 装基础工具
banner "[2/8] 装基础工具（git / nginx / firewalld）"
dnf install -y git nginx firewalld curl 2>&1 | tail -3

# 3. 装 Node.js 20（OpenCloudOS 不被 NodeSource 识别，改用 tarball）
banner "[3/8] 装 Node.js 20"
if ! command -v node &>/dev/null || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo 0)" -lt 20 ]; then
  echo "下载 Node.js 20 官方 tarball..."
  cd /tmp
  # 国内 mirror（npmmirror 同步了 nodejs.org 全部版本）；如不通自动 fallback 官方
  if curl -fsSL --max-time 60 https://registry.npmmirror.com/-/binary/node/v20.19.0/node-v20.19.0-linux-x64.tar.gz -o node.tar.gz; then
    echo "✓ 从 npmmirror 下载成功"
  elif curl -fsSL --max-time 60 https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.gz -o node.tar.gz; then
    echo "✓ 从 nodejs.org 下载成功"
  else
    echo "❌ Node.js 下载失败，请检查网络"
    exit 1
  fi
  tar -xzf node.tar.gz -C /opt
  mv /opt/node-v20.19.0-linux-x64 /opt/nodejs20
  ln -sf /opt/nodejs20/bin/node /usr/local/bin/node
  ln -sf /opt/nodejs20/bin/npm /usr/local/bin/npm
  ln -sf /opt/nodejs20/bin/npx /usr/local/bin/npx
  echo 'export PATH=/opt/nodejs20/bin:$PATH' > /etc/profile.d/nodejs.sh
  chmod +x /etc/profile.d/nodejs.sh
  rm node.tar.gz
fi
node -v
npm -v
echo "✓ Node.js 就绪"

# 4. 装 PM2（用国内 mirror）
banner "[4/8] 装 PM2"
npm install -g pm2 --registry=https://registry.npmmirror.com 2>&1 | tail -3
pm2 -v

# 5. 防火墙（系统层；腾讯云安全组要在 Web 面板另开 80）
banner "[5/8] 防火墙（firewalld）"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --reload
firewall-cmd --list-services | grep -q http && echo "✓ 80 端口已开放" || echo "⚠️ 80 没开，请检查"

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
npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5

# sharp 在 OpenCloudOS 上需要 gcc + make（如果 sharp 失败会自己编译）
echo ""
echo "Build（Next.js prod）..."
NODE_OPTIONS="--max-old-space-size=1536" npm run build 2>&1 | tail -10

# PM2 启动（限制 Node 内存 1.5G，留 500MB 给系统）
pm2 delete image-fun 2>/dev/null || true
NODE_OPTIONS="--max-old-space-size=1536" pm2 start npm --name image-fun -- start
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
rm -f /etc/nginx/conf.d/default.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# 完成
banner "✅ 部署完成"
echo ""
echo "🌐 公网访问: http://49.234.58.150"
echo ""
echo "📋 常用命令："
echo "  pm2 status                # 看进程状态"
echo "  pm2 logs image-fun        # 看 Next.js 日志"
echo "  pm2 restart image-fun     # 重启应用"
echo "  tail -f /tmp/image-fun-deploy.log  # 看部署日志"
echo ""
echo "⚠️  别忘了：腾讯云轻量云控制台 → 防火墙 → 添加规则 → 放通 80 端口"
echo ""
echo "测一下："
echo "  curl -I http://127.0.0.1:3000   # 测本地"
echo "  curl -I http://49.234.58.150    # 测公网（如果不通 = 安全组没放 80）"
echo ""
echo "📝 完整日志: $LOG"