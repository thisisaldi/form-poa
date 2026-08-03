{{/*
Expand the name of the chart.
*/}}
{{- define "k8s.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "k8s.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end }}
{{- end }}

{{/*
Create job name based on the chart name.
*/}}
{{- define "k8s.jobName" -}}
{{- $name := default .Chart.Name .Values.nameOverride | trimSuffix "-" -}}
{{- $contextName:= .Context.name | trimSuffix "-" -}}
{{- printf "%s-%s" $name $contextName | trunc 63 -}}
{{- end }}

{{/*
Create service name based on the release namespace.
*/}}
{{- define "k8s.serviceName" -}}
{{- if or (contains "development" .Release.Namespace) (contains "staging" .Release.Namespace) }}
{{- printf "%s-%s" (include "k8s.name" .) "master" }}
{{- else }}
{{- include "k8s.name" . }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "k8s.chart" -}}
{{- printf "%s-%s" .Chart.Name (.Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-") }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "k8s.labels" -}}
chart: {{ printf "%s-%s" (include "k8s.name" .) (.Chart.Version | replace "+" "_") }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "k8s.selectorLabels" -}}
app: {{ include "k8s.name" . }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "k8s.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "k8s.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the http scaled object host
*/}}
{{- define "k8s.httpScaledObjectExposedHost" -}}
{{- if (contains "production" .Release.Namespace) }}
{{- .Values.httpScaledObject.exposedHost }}
{{- else }}
{{- $namespace := ternary "dev" "staging" (contains "development" .Release.Namespace) }}
{{- printf "%s-%s" $namespace .Values.httpScaledObject.exposedHost }}
{{- end }}
{{- end }}

{{/*
Create deployment tolerations
*/}}
{{- define "k8s.deploymentTolerations" -}}
{{- if contains "production" .Release.Namespace }}
{{- toYaml .Values.tolerations.deployment.production }}
{{- end }}
{{- if contains "staging" .Release.Namespace }}
{{- toYaml .Values.tolerations.deployment.staging }}
{{- end }}
{{- if contains "development" .Release.Namespace }}
{{- toYaml .Values.tolerations.deployment.development }}
{{- end }}
{{- end }}


{{/*
Create vault agent inject config template for .env.staging file
*/}}
{{- define "k8s.vaultAgentInjectConfigTemplate.env.staging" }}
{{- printf "{{- with secret \"%s/staging\" -}}" .Values.vault.secretBasePath }}
{{ `{{- range $key, $value := .Data.data }}` }}
{{ `{{ $key }}="{{ $value }}"` }}
{{ `{{- end -}}` }}
{{ `{{- end -}}` }}
{{- end }}

{{/*
Create vault agent inject config template for .env.production file
*/}}
{{- define "k8s.vaultAgentInjectConfigTemplate.env.production" }}
{{- printf "{{- with secret \"%s/production\" -}}" .Values.vault.secretBasePath }}
{{ `{{- range $key, $value := .Data.data }}` }}
{{ `{{ $key }}="{{ $value }}"` }}
{{ `{{- end -}}` }}
{{ printf "{{ with secret \"%s\" }}" .Values.vault.databaseSecretPath }}
{{ `DATABASE_URL="postgresql://{{ .Data.username }}:{{ .Data.password }}@10.220.34.3:5432/form_poa"` }}
{{ `{{- end -}}` }}
{{ `{{- end -}}` }}
{{- end }}


{{/*
Create vault agent inject pod annotations
*/}}
{{- define "k8s.vaultAgentInjectPodAnnotations" -}}
vault.hashicorp.com/agent-inject: "{{ .Values.vault.agentInject.enabled }}"
vault.hashicorp.com/kv-version: "{{ .Values.vault.kvVersion }}"
vault.hashicorp.com/role: "{{ .Values.vault.roleName }}"
vault.hashicorp.com/auth-path: "{{ .Values.vault.authPath }}"
vault.hashicorp.com/tls-secret: "{{ .Values.vault.tls.secret }}"
vault.hashicorp.com/tls-server-name: "{{ .Values.vault.tls.serverName }}"
vault.hashicorp.com/ca-cert: "{{ .Values.vault.tls.caCert }}"
vault.hashicorp.com/ca-key: "{{ .Values.vault.tls.caKey }}"
vault.hashicorp.com/agent-requests-cpu: "{{ .Values.vault.agentInject.resources.requests.cpu }}"
vault.hashicorp.com/agent-limits-cpu: "{{ .Values.vault.agentInject.resources.limits.cpu }}"
vault.hashicorp.com/agent-requests-mem: "{{ .Values.vault.agentInject.resources.requests.memory }}"
vault.hashicorp.com/agent-limits-mem: "{{ .Values.vault.agentInject.resources.limits.memory }}"
vault.hashicorp.com/agent-init-first: "{{ .Values.vault.agentInject.initFirst }}"
vault.hashicorp.com/agent-pre-populate-only: "{{ .Values.vault.agentInject.prePopulateOnly }}"
vault.hashicorp.com/agent-inject-status: "{{ .Values.vault.agentInject.reRenderOnStatus }}"
vault.hashicorp.com/agent-revoke-on-shutdown: "{{ .Values.vault.agentInject.revoke.enabled }}"
vault.hashicorp.com/agent-revoke-grace: "{{ .Values.vault.agentInject.revoke.gracePeriodInSec }}"
vault.hashicorp.com/agent-inject-secret-env-staging: "{{ .Values.vault.agentInject.secret }}"
vault.hashicorp.com/agent-inject-file-env-staging: ".env.staging"
vault.hashicorp.com/agent-inject-template-env-staging: |
  {{- include "k8s.vaultAgentInjectConfigTemplate.env.staging" . | nindent 4 }}
vault.hashicorp.com/agent-inject-secret-env-production: "{{ .Values.vault.agentInject.secret }}"
vault.hashicorp.com/agent-inject-file-env-production: ".env.production"
vault.hashicorp.com/agent-inject-template-env-production: |
  {{- include "k8s.vaultAgentInjectConfigTemplate.env.production" . | nindent 4 }}
{{- end }}
