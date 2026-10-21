# syntax=docker/dockerfile:1.7

# The showcase at paraframe.convex.works: the prerendered site (build/) behind
# nginx, with comments off. The build context is this repository:
#   docker build -f deploy/Dockerfile -t paraframe-showcase .
# @convex-works/sign-in and visual-comments/server are only loaded when
# VITE_COMMENTS_SERVER is set (src/hooks.server.ts), so the static build
# doesn't need them.
FROM node:24-alpine AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /src

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build

FROM nginxinc/nginx-unprivileged:1.29.8-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
COPY --chmod=644 deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/build /usr/share/nginx/html
EXPOSE 8080
