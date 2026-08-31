{{- define "shift-o-mator.fullname" -}}
{{ .Chart.Name }}
{{- end -}}

{{- define "shift-o-mator.labels" -}}
app.kubernetes.io/part-of: {{ include "shift-o-mator.fullname" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "shift-o-mator.image" -}}
{{- $registry := .root.Values.image.registry -}}
{{- $repo := .repository -}}
{{- $tag := .tag | default .root.Chart.AppVersion -}}
{{- if $registry -}}
{{ $registry }}/{{ $repo }}:{{ $tag }}
{{- else -}}
{{ $repo }}:{{ $tag }}
{{- end -}}
{{- end -}}
