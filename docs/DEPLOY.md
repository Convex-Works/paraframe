# Deploying the showcase

The showcase (`src/routes` + `src/demo`) is published at
<https://paraframe.convex.works>. It is the adapter-static build with comments
off, served by unprivileged nginx. Every frame is prerendered, so
`/play/<frame>` and `/frame/<frame>` are plain files.

## Build

The `Dockerfile` at the repository root builds the image, and `nginx.conf`
configures its server:

```sh
docker build -t paraframe-showcase .
docker run --rm -p 8080:8080 paraframe-showcase   # http://localhost:8080/play/inbox
```

Without Docker, run `pnpm exec vite build` with `VITE_COMMENTS_SERVER` unset.
The output is in `build/`. `@convex-works/sign-in` and `visual-comments/server`
load only when `VITE_COMMENTS_SERVER` is set (`src/hooks.server.ts`), so the
static build doesn't need them.

The image serves `/healthz` and `/version`. `/version` returns the commit the
image was built from, taken from the `REVISION` build argument.

## Release

Every push to `main` deploys the showcase:

1. `.forgejo/workflows/publish.yml` publishes
   `registry.asergo.com/62198-bob/paraframe-showcase:main-<UTC commit time>-<short sha>`.
2. Flux, in the Convex Works cluster, picks up the new tag and rolls it out.
3. The workflow waits until `/version` reports the commit, then checks
   `/play/inbox`.

The Kubernetes manifests live in `ConvexWorks/infrastructure` under
`clusters/production/paraframe`. To roll back, revert the commit on `main`.

`.forgejo/actions/` is a copy of `ConvexWorks/ci-actions`. Don't edit it;
update it with that repository's `vendor.sh`.
