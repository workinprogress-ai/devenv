# Diagnosis playbook — what-is-running-where, and why is it broken

The operate skill's bread and butter: an operator says "microservice X
not responding — find out why", and this lane owns it.

## The diagnosis flow

1. **What is running where**: resolve the environment (class from the
   registry — see [env-classes.md](./env-classes.md)), then inventory:
   pods (`kube-list-pods`), events (`kube-events`), recent history
   (`kube-rollout` history), resource pressure (`kube-top`). Read-only
   surface first; every fact lands in the session coordination file
   (durable across compaction — see [memory.md](./memory.md)).
2. **Hypothesis from evidence**: crash loops (restarts vs. events),
   resource starvation (top vs. requests), rollout stuck (rollout
   status), dependency failure (events upstream). State the hypothesis
   before touching it.
3. **Drill to the specific**: `kube-describe` on the suspect,
   `kube-logs` for the container's actual words, `kube-pod-select` to
   resolve a fragment to the exact pod. The evidence chain must be
   reproducible: anyone redoing this reaches the same conclusion.
4. **Verdict + fix path**: what is broken, what class of fix it needs,
   and whether the fix is a mutation (matrix applies) or a human
   escalation.

## The tool surface for diagnosis

The `kube-*` read family is the default lane: `kube-list-pods`,
`kube-logs`, `kube-pod-select`, `kube-deployment-select`,
`kube-set-context`, `kube-events`, `kube-describe`, `kube-top`,
`kube-rollout` (status/history only). Raw `kubectl` read verbs are open
through the curated grammar (`kubectl get/describe/logs/top/events/config`);
mutating verbs route to the confirm-guarded family. Note the mutating
surface adjacent to diagnosis: `kube-pod-exec` (arbitrary execution
inside a target — see the Mutation Lane's privileged-surface rules),
`kube-forward-ports` / `kube-intercept` (traffic rerouting — ladder
outside local class).

## Bugs in code vs. failures in environments

If the diagnosis converges on a code bug (not an environment state
problem), that hands off to `/devenv-hunt` — the operate session
delivered the environment half (what is running, what it said, where it
broke); the hunt session owns the code half. The handoff carries facts
(evidence, the pod, the log lines), not conclusions about the code.

## Observability

Loki/Grafana and their query surface (`logcli`) are the
beyond-cluster-tooling lane: where pod logs end but the request trace
continues. Detect the backends from the environment (registry + memory —
never assume an endpoint); if the environment carries no observability
stack, say so and stay on the k8s surface.
