# syntax=docker/dockerfile:1.7

# The showcase at paraframe.convex.works: the prerendered site (build/) behind
# nginx. Its comments stay in each visitor's browser (src/service-worker). The
# build context is this repository:
#   docker build -t paraframe-showcase .
# @convex-works/sign-in and visual-comments/server are only loaded when
# VITE_COMMENTS_SERVER is set (src/hooks.server.ts), so the static build
# doesn't need them.
FROM node:24-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec vite build

# Served at /version; CI passes the commit SHA.
ARG REVISION
RUN printf '{"revision":"%s"}\n' "${REVISION:-unknown}" > build/version

FROM nginxinc/nginx-unprivileged:1.29.8-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
COPY --chmod=644 nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/build /usr/share/nginx/html
EXPOSE 8080
