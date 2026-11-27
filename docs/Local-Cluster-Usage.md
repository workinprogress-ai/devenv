# Local Kubernetes Clusters (k3d)

This note covers the local-cluster workflow inside the dev container: what
devenv provides, what lives in the app/devops repos, and how the pieces fit
together. For remote clusters (staging, prod), the same `kube-*` tools and
`k9s`/`telepresence` work unchanged — only the kubeconfig context differs.

## What ships where

devenv is **org-neutral by design**: it provides the tooling layer only.

| Layer | Lives in | Examples |
|---|---|---|
| Tooling (binaries, wrappers, docs) | devenv | `install-extras kubernetes-tools` (k3d, k9s, telepresence), the `kube-*` wrapper family, this doc |
| Cluster lifecycle scripts (create/delete with app-specific args) | app/devops repos (`devops.<app>.infra`, `template.devops.infra`) | cluster-create wrappers with the kubelet gate flag, app namespaces, pull secrets, `host.k3d.internal` wiring |

If your repo has no cluster scripts yet, `template.devops.infra` is the starting
point — do not add app-specific cluster bootstrap to devenv.

## Prerequisites (host)

k3s inside k3d node containers hard-requires the **cpuset cgroup controller**.
The container warns loudly at every start when it is missing, and
`install-extras kubernetes-tools` re-checks before installing k3d. The fix is
host-side and one-time per machine:
[Dev-container-environment.md — Host preparation: cpuset delegation](Dev-container-environment.md#host-preparation-cpuset-delegation-for-local-kubernetes).

The one non-default create flag that matters on this stack (k3d v5.9.0 /
k3s v1.35.x):

```bash
k3d cluster create smoke \
  --k3s-arg '--kubelet-arg=feature-gates=KubeletInUserNamespace=true@server:0'
```

Without the `KubeletInUserNamespace` gate the kubelet refuses to start in the
dev container's unprivileged-cgroup environment. A repo's cluster-create
wrapper normally passes this flag for you.

## Lifecycle

```bash
k3d cluster list                    # what exists
k3d cluster delete smoke            # tear down (kubeconfig context goes with it)
k3d cluster delete -a               # nuke all local clusters
k3d kubeconfig get smoke > /dev/null  # context is written to the default kubeconfig on create
```

Clusters are disposable by design — state you care about belongs in the app's
persistence layer, not in a local cluster. Deleting and recreating is the
standard reset.

## Working with a cluster

- `kube-set-context` lists/switches contexts — k3d contexts appear as
  `k3d-<cluster>` and are selected like any other context.
- `k9s` opens the terminal dashboard over the current context; point it at any
  context directly with `k9s --context k3d-smoke` (or `kube-set-context` first).
  Launching k9s from a non-interactive shell (script, agent) traps the terminal
  in the alternate screen buffer — wrap in `script`/`timeout` with output
  redirected, or prefer the `kube-*` read wrappers in scripted contexts.
- Port access: k3d's load balancer maps cluster ports to the container's
  localhost (`-p 8080:80@loadbalancer` at create time). For ad-hoc access to
  a specific pod, use `kube-forward-ports` — forward when you need one pod,
  create-time LB mappings when a service needs a stable local port.
- Traffic interception (route cluster traffic to a local listener) is
  `kube-intercept` — see the Kubernetes Tools section of
  [Additional-Tooling.md](Additional-Tooling.md).
- Read surface for diagnosis: `kube-events` (event stream — all namespace
  events, or one resource's via a name fragment: `kube-events myapp -n prod`),
  `kube-describe` (detailed object state; `-k pod|deployment|statefulset`),
  `kube-top pods|nodes` (resource usage), and `kube-rollout
  status|history <deployment>` — all single-match by name fragment, all
  forwarding trailing kubectl flags verbatim. `kube-rollout` is read-only by
  design: restart/undo are mutations and are refused (use the mutation
  wrappers, which carry confirm-guards).

## Troubleshooting

- **Cluster create hangs / nodes never Ready** — almost always missing
  cpuset delegation (see Prerequisites); the container-start warning names
  the same fix.
- **Privileged containers fail with `mount src ... ENOENT`** — stale `/dev`
  bind-mounts; `container-start.sh` sweeps them automatically, a container
  restart applies the sweep (see
  [Dev-container-environment.md — Troubleshooting](Dev-container-environment.md#troubleshooting)).
- **Intercepts need a Service** — telepresence intercepts a *deployment* and
  require a named container port plus a Service in front of it; see
  `kube-intercept --help`.
