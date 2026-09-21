# syntax=docker/dockerfile:1

# ---------- 依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 构建/测试（verify 一次性服务复用此阶段） ----------
FROM node:22-alpine AS builder
WORKDIR /app
ENV CI=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 镜像构建期即产出静态文件，确保交付物经过类型检查
RUN npm run build

# verify 服务入口：类型检查 + 性质测试 + 对 web 服务做健康/资源探活，完成后退出
CMD ["node", "scripts/verify.mjs"]

# ---------- 静态 Web（nginx） ----------
FROM nginx:1.27-alpine AS web
# 清掉默认站点配置
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
# 容器内健康检查（Compose 的 depends_on 与编排均据此判定）
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=10 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz | grep -q ok || exit 1
