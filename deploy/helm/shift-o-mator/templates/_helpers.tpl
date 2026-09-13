{{/*
The application's own name — what every object is labelled `part-of`. Deliberately the
chart name and not the release: two installs are two releases of the *same* application.
*/}}
{{- define "shift-o-mator.fullname" -}}
{{ .Chart.Name }}
{{- end -}}

{{/*
The prefix every resource *name* is built from. The release name, because names collide
where labels merely mismatch: `shift-o-mator-api-config` is one ConfigMap per namespace
however careful the selectors are, and a second release would adopt the first one's. With
the documented release name (`shift-o-mator`) this renders exactly the names the README
uses, so nothing has to be migrated to gain the property.
*/}}
{{- define "shift-o-mator.instance" -}}
{{ .Release.Name }}
{{- end -}}

{{- define "shift-o-mator.labels" -}}
app.kubernetes.io/part-of: {{ include "shift-o-mator.fullname" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector labels for one component. A Deployment used to select on `component: api` alone,
which is not unique to a release: two installs of this chart in one namespace would each
match the other's pods, and a Service would round-robin across both. The release name is
what makes it unique, and `matchLabels` is immutable after creation — so this is worth
getting right before anything is deployed, not after.
*/}}
{{- define "shift-o-mator.selectorLabels" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/part-of: {{ include "shift-o-mator.fullname" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "shift-o-mator.image" -}}
{{- /* Both halves are required, and for the same reason: a value that is merely absent
       turns into a pull of something that does not exist, and the failure surfaces minutes
       later as ImagePullBackOff on a pod rather than immediately as a bad deploy command.
       A forgotten tag used to fall back to Chart.AppVersion (:0.1.0, an image nothing
       publishes); a blank registry used to resolve to Docker Hub, which will happily
       answer for `shift-o-mator/api` and has never held it. */ -}}
{{- $registry := required "image.registry is required — set it in the environment's values file (e.g. ghcr.io/<owner>)" .root.Values.image.registry -}}
{{- $tag := required "image tag is required — pass --set image.api.tag=<tag> and --set image.web.tag=<tag>" .tag -}}
{{ $registry }}/{{ .repository }}:{{ $tag }}
{{- end -}}

{{/*
Pod-level hardening, applied to both deployments with the uid each image actually has.

That uid is NOT the same for the two of them, and the mismatch is invisible until something
tries to write: the web image creates its own `app` user at 1000, while the .NET runtime
image ships one at **1654** (`APP_UID=1654`, and `/home/app` is mode 0750 owned by it) — so
pinning the API to 1000 leaves the process with no access to its own $HOME and ASP.NET Core
cannot persist DataProtection keys. Pinning it at all is still worth it: an image rebuilt
without its USER line, or swapped for another repository's, would otherwise come up as root
unnoticed.

`readOnlyRootFilesystem` is deliberately absent. nginx writes its pid and proxy temp paths,
and ASP.NET Core writes DataProtection keys under $HOME, so switching it on needs emptyDir
mounts for both — worth doing, but it changes what the pods do, and neither has been run on
a cluster yet. Turning it on is the right first task after the sandbox comes up green.
*/}}
{{- define "shift-o-mator.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "shift-o-mator.containerSecurityContext" -}}
allowPrivilegeEscalation: false
privileged: false
capabilities:
  drop: ["ALL"]
{{- end -}}
