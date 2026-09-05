{{- define "shift-o-mator.fullname" -}}
{{ .Chart.Name }}
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
{{- $registry := .root.Values.image.registry -}}
{{- $repo := .repository -}}
{{- /* No fallback to Chart.AppVersion: a forgotten --set image.*.tag used to resolve to
       :0.1.0, an image nothing publishes, and the failure arrived minutes later as
       ImagePullBackOff on a pod rather than immediately as a bad deploy command. */ -}}
{{- $tag := required "image tag is required — pass --set image.api.tag=<tag> and --set image.web.tag=<tag>" .tag -}}
{{- if $registry -}}
{{ $registry }}/{{ $repo }}:{{ $tag }}
{{- else -}}
{{ $repo }}:{{ $tag }}
{{- end -}}
{{- end -}}

{{/*
Pod-level hardening applied to both deployments. Both images already run as uid 1000, but
nothing enforced it: an image rebuilt without its USER line, or swapped for another
repository's, would have come up as root unnoticed.

`readOnlyRootFilesystem` is deliberately absent. nginx writes its pid and proxy temp paths,
and ASP.NET Core writes DataProtection keys under $HOME, so switching it on needs emptyDir
mounts for both — worth doing, but it changes what the pods do, and neither has been run on
a cluster yet. Turning it on is the right first task after the sandbox comes up green.
*/}}
{{- define "shift-o-mator.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "shift-o-mator.containerSecurityContext" -}}
allowPrivilegeEscalation: false
privileged: false
capabilities:
  drop: ["ALL"]
{{- end -}}
