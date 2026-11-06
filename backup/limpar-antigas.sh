#!/usr/bin/env bash
# Mantém as cópias mais recentes e apaga as outras. Só mexe em releases cujo nome começa com "copia-".
# Uso: limpar-antigas.sh <quantas manter>
set -euo pipefail
MANTER="${1:?Informe quantas cópias manter}"
gh release list --limit 200 --json tagName,createdAt --jq 'map(select(.tagName | startswith("copia-"))) | sort_by(.createdAt) | reverse | .[].tagName' \
  | tail -n "+$((MANTER + 1))" \
  | while read -r nome; do
      echo "Apagando a cópia antiga $nome"
      gh release delete "$nome" --yes --cleanup-tag
    done
