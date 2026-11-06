# Cópia de segurança

No plano Free, o Supabase não faz backup. No Pro, faz só do banco: PDFs e áudios ficam de fora nos dois casos. Por isso, toda semana uma automação copia banco, contas e arquivos, criptografa e guarda num repositório **privado** do GitHub.

| | |
|---|---|
| **Quando** | Domingo, 3h da manhã em Brasília, ou à mão em **Actions → Cópia de segurança → Run workflow** |
| **O que entra** | Banco inteiro, contas de login e todos os arquivos do Storage |
| **Onde fica** | Nas **Releases** do repositório privado, as 8 mais recentes (cerca de 2 meses) |
| **Se falhar** | O GitHub avisa por e-mail e nenhuma cópia antiga é apagada |

**O que não entra:** a chave `GEMINI_API_KEY`, as configurações de login (Google, e-mail, endereços permitidos) e as variáveis do Cloudflare. O código das funções e as migrações já estão no GitHub.

**Quanto se pode perder:** até uma semana de dados, porque a cópia é semanal.

As cópias têm dados pessoais dos alunos e as senhas das contas (em forma embaralhada). Por isso são criptografadas e nunca podem ir para este repositório, que é público. Quem saiu da plataforma continua nas cópias antigas até elas serem apagadas, em cerca de 2 meses.

## Como ligar (uma vez só)

**1. Crie o repositório privado.** Em [github.com/new](https://github.com/new): nome `upenglish-backups`, marque **Private** e **Add a README file**.

**2. Coloque a automação nele.** No repositório novo, **Add file → Create new file**, com o nome `.github/workflows/backup.yml`. Cole o conteúdo de [`backup/workflow-do-repositorio-privado.yml`](../backup/workflow-do-repositorio-privado.yml) e salve.

**3. Crie a senha das cópias.** Use uma senha longa, de pelo menos 6 palavras, e guarde num gerenciador de senhas. **Sem ela, nenhuma cópia abre e não há como recuperar:** o GitHub não deixa ler de volta um segredo salvo.

**4. Cadastre os segredos.** No repositório privado: **Settings → Secrets and variables → Actions → New repository secret**.

| Nome | Onde pegar |
|---|---|
| `SUPABASE_URL` | `https://txzjjmufcevisnsvtjwt.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → **Project Settings → API Keys**: a chave `secret` (ou `service_role`) |
| `SUPABASE_DB_URL` | Supabase → botão **Connect** → **Session pooler**. Troque `[YOUR-PASSWORD]` pela senha do banco |
| `SENHA_BACKUP` | A senha do passo 3 |

Use o **Session pooler**: o GitHub não alcança a conexão direta do Supabase. Se a senha do banco tiver símbolos, a ligação pode falhar; o mais simples é trocá-la por uma só com letras e números em **Project Settings → Database**.

Essas chaves dão acesso total aos dados. Nunca as coloque neste repositório nem as cole em conversas.

**5. Rode a primeira cópia.** **Actions → Cópia de segurança → Run workflow**. Ao terminar, a cópia aparece em **Releases**, com o resumo de contas, perfis e arquivos. Confira se os números fazem sentido.

**6. Faça um teste de restauração** (seção abaixo), num projeto novo do Supabase. Só depois disso dá para confiar nas cópias.

## Como restaurar

Isto restaura num projeto **novo**: o projeto atual não é tocado. Precisa de `gpg`, `psql` e Node instalados.

**1. Baixe e abra a cópia** (nas Releases do repositório privado):

```bash
mkdir banco arquivos
gpg --decrypt banco-DATA.tar.gz.gpg | tar -xzf - -C banco
gpg --decrypt arquivos-DATA.tar.gz.gpg | tar -xzf - -C arquivos
```

**2. Crie um projeto novo no Supabase** e copie a conexão do **Session pooler** dele.

**3. Restaure o banco:**

```bash
cd banco
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname 'CONEXAO_DO_PROJETO_NOVO'
cd ..
```

**4. Restaure os arquivos:**

```bash
cd backup && npm install && cd ..
SUPABASE_URL='URL_DO_PROJETO_NOVO' SUPABASE_SERVICE_KEY='CHAVE_DO_PROJETO_NOVO' \
  node backup/arquivos.mjs enviar arquivos
```

**5. Para confirmar um teste:** veja no SQL Editor do projeto novo se os números batem com o resumo da cópia, e se um PDF aparece em **Storage**. Depois, apague o projeto de teste, porque ele guarda dados reais dos alunos.

**6. Numa restauração de verdade**, aponte o site para o projeto novo:
- No Cloudflare: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, e publique de novo.
- No GitHub: troque `PROJETO` em `.github/workflows/funcoes.yml`, para publicar as funções no projeto novo.
- No Supabase novo: `GEMINI_API_KEY` nos segredos, e as configurações de login (Google, e-mail e endereços permitidos, veja [login-google.md](login-google.md)).
- Nos segredos do repositório privado: os novos `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e `SUPABASE_DB_URL`.

Se algo der errado no meio, o projeto original continua como estava.

## Quando algo muda

- **Cópia marcada como incompleta:** o e-mail do GitHub leva ao registro, e o resumo nomeia os arquivos que faltaram. Banco e demais arquivos foram guardados.
- **Trocou a senha do banco ou a chave do Supabase:** atualize o segredo correspondente, ou a próxima cópia falha.
- **Trocou `SENHA_BACKUP`:** as cópias antigas continuam abrindo só com a senha antiga.
- **Arquivos passaram de 1,9 GB comprimidos:** o limite por arquivo das Releases é 2 GB, e a cópia falha avisando. No plano Free isso não deve acontecer, porque o limite de arquivos é 1 GB.
