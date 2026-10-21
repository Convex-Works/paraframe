# Deploying the showcase

The showcase (`src/routes` + `src/demo`) is published at
<https://paraframe.convex.works>. It is the adapter-static build with comments
off: about 380 KB of prerendered HTML and assets, served by nginx. Every frame
is prerendered, so `/play/<frame>` and `/frame/<frame>` are plain files.

## How convex.works is hosted

- `*.convex.works` is one proxied Cloudflare record pointing at the cluster's
  ingress (ingress-nginx). Any subdomain already resolves there, so
  paraframe.convex.works needs no DNS change.
- Cloudflare checks the origin certificate. The ingress presents the
  `*.convex.works` Cloudflare origin certificate only for hosts that have an
  Ingress with a TLS entry; any other host gets the ingress's fake default
  certificate, which is why the domain answered 526 before this Ingress
  existed.
- Sites are images built by Forgejo Actions and pushed to the registry named
  by the `REGISTRY_URL`, `REGISTRY_USER` and `REGISTRY_TOKEN` secrets, the same
  way tide (and its documentation site at tide.convex.works) is built.

## Build

The image comes from `deploy/Dockerfile`, built from this repository:

```sh
docker build -f deploy/Dockerfile -t paraframe-showcase .
docker run --rm -p 8080:8080 paraframe-showcase   # http://localhost:8080/play/inbox
```

`.forgejo/workflows/showcase.yml` does the same on every pull request and, on
main, pushes `<REGISTRY_URL>/paraframe-showcase:<commit>` when the registry
secrets are set.

Without Docker, the static site is `pnpm exec vite build` (output in `build/`)
with `VITE_COMMENTS_SERVER` unset. `@convex-works/sign-in` and
`visual-comments/server` are only loaded when `VITE_COMMENTS_SERVER` is set
(`src/hooks.server.ts`), so the static build doesn't need them.

## Run

`deploy/k8s` is a kustomize base: a Deployment (unprivileged nginx, read-only
root filesystem), a Service and an Ingress for paraframe.convex.works. In an
overlay, set every `# OVERLAY:` value:

- the image, by commit, from the registry;
- the ingress class that serves tide.convex.works;
- the TLS secret holding the `*.convex.works` origin certificate. A secret is
  namespaced, so copy it into the showcase's namespace if it lives elsewhere.

Then `kubectl apply -k <overlay>` and check:

```sh
curl -sI https://paraframe.convex.works/            # 200
curl -sI https://paraframe.convex.works/play/inbox  # 200
```

To take the site down, `kubectl delete -k <overlay>`; nothing else depends on
it.
