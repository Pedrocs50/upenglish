#!/usr/bin/env bash
# Prova que uma cópia pode ser recuperada: restaura num projeto de teste VAZIO e compara com o que estava na cópia.
# Recusa o projeto real e qualquer projeto que já tenha dados. Quem cria o projeto de teste é o projeto-de-teste.mjs. Veja docs/backup.md.
#
# Uso: testar-restauracao.sh <banco-DATA.tar.gz.gpg> <arquivos-DATA.tar.gz.gpg>
# Precisa de TESTE_SUPABASE_DB_URL, TESTE_SUPABASE_URL, TESTE_SUPABASE_SERVICE_KEY e SENHA_BACKUP, de psql, gpg e node.
# Nunca ligue "set -x" aqui: as senhas apareceriam no registro.
set -euo pipefail
umask 077

: "${TESTE_SUPABASE_DB_URL:?Defina TESTE_SUPABASE_DB_URL}"
: "${TESTE_SUPABASE_URL:?Defina TESTE_SUPABASE_URL}"
: "${TESTE_SUPABASE_SERVICE_KEY:?Defina TESTE_SUPABASE_SERVICE_KEY}"
: "${SENHA_BACKUP:?Defina SENHA_BACKUP}"
BANCO="$(realpath "${1:?Informe a cópia do banco}")"
ARQUIVOS="$(realpath "${2:?Informe a cópia dos arquivos}")"

PROJETO_REAL="txzjjmufcevisnsvtjwt"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

falhar() {
  echo "ERRO: $1" >&2
  exit 1
}
consulta() {
  psql "$TESTE_SUPABASE_DB_URL" --no-psqlrc --tuples-only --no-align --variable ON_ERROR_STOP=1 --command "$1"
}
abrir() { # arquivo, pasta
  mkdir -p "$2"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3< <(printf '%s' "$SENHA_BACKUP") | tar -xzf - -C "$2"
}

case "$TESTE_SUPABASE_DB_URL $TESTE_SUPABASE_URL" in
  *"$PROJETO_REAL"*) falhar "Os segredos TESTE_* apontam para o projeto REAL. Nada foi feito." ;;
esac
# Um projeto recém-criado demora um pouco para aceitar conexões.
for tentativa in $(seq 1 20); do
  if consulta 'select 1' >/dev/null 2>&1; then break; fi
  [ "$tentativa" -lt 20 ] || falhar "O projeto de teste não aceitou a conexão."
  sleep "${ESPERA_CONEXAO:-15}"
done
[ -z "$(consulta "select to_regclass('public.perfis')")" ] || falhar "O projeto de teste não está vazio. Crie outro projeto; nada foi feito."

echo "Abrindo a cópia..."
abrir "$BANCO" "$TEMP/banco"
abrir "$ARQUIVOS" "$TEMP/arquivos"

echo "Restaurando o banco..."
(
  cd "$TEMP/banco"
  psql --no-psqlrc --quiet --single-transaction --variable ON_ERROR_STOP=1 \
    --file roles.sql --file schema.sql \
    --command 'SET session_replication_role = replica' \
    --file data.sql \
    --dbname "$TESTE_SUPABASE_DB_URL" >/dev/null
)

echo "Comparando o banco..."
DIFERENCAS=0
TABELAS=0
while read -r esquema tabela esperado; do
  obtido="$(consulta "select count(*) from \"$esquema\".\"$tabela\"")"
  TABELAS=$((TABELAS + 1))
  if [ "$obtido" != "$esperado" ]; then
    echo "  DIFERENTE: $esquema.$tabela tinha $esperado e ficou com $obtido"
    DIFERENCAS=$((DIFERENCAS + 1))
  fi
done < <(awk '
  /^COPY "/ { split($2, p, "."); e = p[1]; t = p[2]; gsub(/"/, "", e); gsub(/"/, "", t); n = 0; dentro = 1; next }
  dentro && $0 == "\\." { if (e == "public" || (e == "auth" && t == "users") || (e == "storage" && (t == "objects" || t == "buckets"))) print e, t, n; dentro = 0; next }
  dentro { n++ }
' "$TEMP/banco/data.sql")

[ "$TABELAS" -gt 0 ] || falhar "A cópia não tem nenhuma tabela para comparar."
[ "$DIFERENCAS" = 0 ] || falhar "$DIFERENCAS tabela(s) ficaram diferentes da cópia."
SEM_RLS="$(consulta "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")"
[ "$SEM_RLS" = 0 ] || falhar "$SEM_RLS tabela(s) voltaram sem as regras de acesso."
CONTAS="$(consulta 'select count(*) from auth.users')"
PERFIS="$(consulta 'select count(*) from public.perfis')"

echo "Restaurando os arquivos..."
export SUPABASE_URL="$TESTE_SUPABASE_URL" SUPABASE_SERVICE_KEY="$TESTE_SUPABASE_SERVICE_KEY"
node "$AQUI/arquivos.mjs" enviar "$TEMP/arquivos"

echo "Comparando os arquivos, byte a byte..."
mkdir "$TEMP/conferencia"
node "$AQUI/arquivos.mjs" baixar "$TEMP/conferencia"
[ ! -f "$TEMP/conferencia/falhas.txt" ] || falhar "Alguns arquivos não voltaram do projeto de teste."
diff -r --exclude=arquivos.json --exclude=falhas.txt "$TEMP/arquivos" "$TEMP/conferencia" >/dev/null || falhar "Os arquivos restaurados são diferentes dos da cópia."
QTD="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$TEMP/conferencia/arquivos.json")"
if [ -f "$TEMP/arquivos/falhas.txt" ]; then echo "ATENÇÃO: esta cópia já estava incompleta:"; cat "$TEMP/arquivos/falhas.txt"; fi

echo "RESTAURAÇÃO OK"
echo "- Tabelas iguais à cópia: $TABELAS"
echo "- Contas de login: $CONTAS"
echo "- Perfis: $PERFIS"
echo "- Arquivos iguais à cópia: $QTD"
echo
