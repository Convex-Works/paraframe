# syntax=docker/dockerfile:1.7

# The showcase at paraframe.convex.works: the prerendered site (build/) behind
# nginx, with comments off. paraframe depends on visual-comments through
# `link:../visual-comments/packages/client`, so the build context is the
# directory holding both checkouts side by side:
#   <context>/paraframe/        this repository
#   <context>/visual-comments/  git@ssh.git.convex.works:convexworks/visual-comments.git
# and the image is built from there:
#   docker build -f paraframe/deploy/Dockerfile -t paraframe-showcase <context>
# @convex-works/sign-in (`link:../sign-in`) is only loaded when
# VITE_COMMENTS_SERVER is set, so the static build doesn't need it.
FROM node:24-alpine AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /src

COPY visual-comments visual-comments
RUN cd visual-comments \
	&& pnpm install --frozen-lockfile \
	&& pnpm --filter visual-comments build

COPY paraframe paraframe
RUN cd paraframe \
	&& pnpm install --frozen-lockfile \
	&& pnpm exec vite build

FROM nginxinc/nginx-unprivileged:1.29.8-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
COPY paraframe/deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/paraframe/build /usr/share/nginx/html
EXPOSE 8080
