#!/usr/bin/env bash
# Cópia de segurança: banco (com as contas) e arquivos, criptografados. Só grava no destino depois de conferir o resultado.
#
# Uso: fazer-backup.sh <pasta de saída>
# Precisa de SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY e SENHA_BACKUP, da CLI do Supabase (com Docker), node e gpg.
# Veja docs/backup.md. Nunca ligue "set -x" aqui: as senhas apareceriam no registro.
set -euo pipefail
umask 077

: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL}"
: "${SUPABASE_URL:?Defina SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?Defina SUPABASE_SERVICE_KEY}"
: "${SENHA_BACKUP:?Defina SENHA_BACKUP}"
SAIDA="${1:?Informe a pasta de saída}"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIMITE_BYTES=$((1900 * 1024 * 1024)) # Cada arquivo de uma release do GitHub vai até 2 GB.
DATA="$(date -u +%F)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$SAIDA" "$TEMP/banco" "$TEMP/arquivos"

falhar() {
  echo "ERRO: $1" >&2
  exit 1
}

# Quantas linhas uma tabela tem no dump. Tabela vazia ou ausente pode indicar uma cópia incompleta.
linhas_da_tabela() {
  awk -v inicio="COPY \"$1\".\"$2\" " 'index($0, inicio) == 1 { dentro = 1; next } dentro && $0 == "\\." { exit } dentro { n++ } END { print n + 0 }' "$TEMP/banco/data.sql"
}

criptografar() { # origem (pasta), destino
  tar -C "$1" -czf - . | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --compress-algo none --output "$2" 3< <(printf '%s' "$SENHA_BACKUP")
}

# Prova que o arquivo final abre com a senha e tem tudo o que entrou.
conferir_criptografado() { # origem (pasta), arquivo
  local esperado obtido
  esperado="$(tar -C "$1" -cf - . | tar -tf - | wc -l)"
  obtido="$(gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$2" 3< <(printf '%s' "$SENHA_BACKUP") | tar -tzf - | wc -l)"
  [ "$esperado" = "$obtido" ] || falhar "$(basename "$2") não abriu direito: $obtido de $esperado itens."
  [ "$(stat -c %s "$2")" -le "$LIMITE_BYTES" ] || falhar "$(basename "$2") passou de 1,9 GB, o limite por arquivo do GitHub. Veja docs/backup.md."
}

echo "Copiando o banco..."
cd "$TEMP/banco"
supabase db dump --remote="$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --remote="$SUPABASE_DB_URL" -f schema.sql
supabase db dump --remote="$SUPABASE_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
cd - >/dev/null

grep -q '"public"."perfis"' "$TEMP/banco/schema.sql" || falhar "A estrutura do banco veio sem a tabela de perfis."
PERFIS="$(linhas_da_tabela public perfis)"
CONTAS="$(linhas_da_tabela auth users)"
[ "$PERFIS" -gt 0 ] || falhar "A cópia do banco veio sem nenhum perfil."
[ "$CONTAS" -gt 0 ] || falhar "A cópia do banco veio sem nenhuma conta de login."

echo "Copiando os arquivos..."
node "$AQUI/arquivos.mjs" baixar "$TEMP/arquivos"
QTD_ARQUIVOS="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$TEMP/arquivos/arquivos.json")"

echo "Criptografando..."
criptografar "$TEMP/banco" "$SAIDA/banco-$DATA.tar.gz.gpg"
criptografar "$TEMP/arquivos" "$SAIDA/arquivos-$DATA.tar.gz.gpg"
conferir_criptografado "$TEMP/banco" "$SAIDA/banco-$DATA.tar.gz.gpg"
conferir_criptografado "$TEMP/arquivos" "$SAIDA/arquivos-$DATA.tar.gz.gpg"

{
  echo "Cópia de $DATA"
  echo "- Contas de login: $CONTAS"
  echo "- Perfis: $PERFIS"
  echo "- Arquivos: $QTD_ARQUIVOS"
  echo "- Banco: $(du -h "$SAIDA/banco-$DATA.tar.gz.gpg" | cut -f1)"
  echo "- Arquivos: $(du -h "$SAIDA/arquivos-$DATA.tar.gz.gpg" | cut -f1)"
} >"$SAIDA/resumo.txt"

if [ -f "$TEMP/arquivos/falhas.txt" ]; then
  {
    echo
    echo "ATENÇÃO: estes arquivos NÃO foram copiados:"
    cat "$TEMP/arquivos/falhas.txt"
  } >>"$SAIDA/resumo.txt"
  touch "$SAIDA/INCOMPLETA"
fi

cat "$SAIDA/resumo.txt"
