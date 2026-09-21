# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY verify ./verify
RUN npm run build
# 预打包一次性验收脚本（数学 + HTTP 验收共用同一产物）
RUN npx esbuild verify/acceptance.ts --bundle --platform=node --format=esm --outfile=/tmp/acceptance.mjs

# ---------- 静态 Web 阶段 ----------
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# ---------- 一次性验收阶段：完成后自行退出，退出码即验收结果 ----------
FROM node:22-alpine AS verify
# /tmp/acceptance.mjs 已由 esbuild 自包含打包（含 fetch），无需源码或依赖。
COPY --from=build /tmp/acceptance.mjs /tmp/acceptance.mjs
# BASE_URL 由 compose 指向 web 服务；直接 docker run 时可覆盖。
ENV BASE_URL=http://web
CMD ["node", "/tmp/acceptance.mjs"]
