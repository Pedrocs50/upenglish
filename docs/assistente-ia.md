# Assistente UP (IA dentro da plataforma)

O professor pede os exercícios em uma frase, no editor da lista, e recebe a lista pronta no padrão da escola para revisar. Funciona com a conta de professor da própria plataforma: ninguém precisa de conta de IA.

## Como funciona
```
Editor (chat)  ──►  Edge Function "assistente"  ──►  Gemini (grátis) ou Groq
                     │ confere login e papel (professor/admin)
                     │ confere a cota do dia (config_ia.limite_diario)
                     │ monta a "base sólida":
                     │   regras de ensino da escola
                     │   + exemplos fixos tirados das aulas da Monique
                     │   + as 2 listas publicadas mais recentes do mesmo idioma
                     │ conserta e valida o JSON (pede de novo uma vez se vier errado)
                     └ registra a geração em geracoes_ia (tempo, tokens, erro)
```
- **Conversa:** a resposta do assistente volta para ele como JSON, então dá para pedir ajustes ("troque as lacunas por lacunas com opções").
- **Qual IA:** o provedor e o modelo ficam na tabela `config_ia`, que o admin muda em **Usuários → Assistente de IA**. Padrão: Gemini, `gemini-flash-latest`, 30 pedidos por professor por dia.
- **Código** (sem dependências), em `supabase/functions/`:

  | Arquivo | O que tem |
  |---|---|
  | `assistente/regras.ts` | As regras de ensino da escola e os exemplos. **É aqui que se muda o estilo dos exercícios.** |
  | `assistente/provedores.ts` | Gemini e Groq, o modelo de reserva e o ajuste de "pensamento" |
  | `assistente/resposta.ts` | Leitura do JSON do modelo e conversão das listas publicadas em exemplos |
  | `assistente/index.ts` | O atendimento: login, cota, chamada e registro |
  | `_shared/http.ts` | Partes comuns com a função de áudio (erros, Supabase, registro em `geracoes_ia`) |
  | `testes.ts` | Testes das duas funções com o Supabase e o Gemini simulados (`deno test testes.ts`) |

  A tabela de configuração e o histórico estão na migração [`0004_assistente_ia.sql`](../supabase/migrations/0004_assistente_ia.sql).

## Velocidade (26/10/2026)
- **Menos "pensamento":** os modelos Flash do Gemini raciocinam bastante antes de responder, e essa era a maior parte da espera de 15 a 40 s. O pedido agora vai com `thinkingLevel: "low"`. Se o modelo configurado não aceitar esse ajuste, a função manda de novo sem ele, sozinha.
- **Reserva sem espera:** se o modelo principal estiver sobrecarregado (503) ou sem cota (429), a função vai direto para o `gemini-3.5-flash-lite`. Antes, ela esperava e tentava o mesmo modelo de novo.
- **Prazo para cada modelo:** o principal tem 35 s; se não responder, a função passa para o reserva, que tem 60 s. Antes não havia prazo: um Gemini travado prendia o professor até o Supabase cortar a função (150 s), sem resposta e sem registro (26/10/2026). Os prazos mudam pelos segredos `LIMITE_PRINCIPAL_S` e `LIMITE_RESERVA_S`, sem mexer no código. A coluna `segundos` de `geracoes_ia` soma o tempo dos dois modelos.
- **Consultas juntas:** login, papel, configuração, cota e listas de exemplo saem num lote só ao banco, em vez de cinco consultas em fila.
- **No editor:** enquanto a lista é criada, aparece um contador de segundos.
- **Medir:** o tempo de cada geração fica em `geracoes_ia.segundos`. Para comparar antes e depois, rode no SQL Editor:
  ```sql
  select modelo, count(*), round(avg(segundos), 1) as media_s, round(max(segundos), 1) as max_s
  from public.geracoes_ia where habilidade = 'gerar_lista' and ok and criado_em > now() - interval '14 days'
  group by modelo order by 2 desc;
  ```

## Testes feitos (18/10/2026)
- **Modelos do Gemini com o pedido da escola**, cada lista validada pelo conversor da plataforma:
  - `gemini-flash-latest`: ~30 s, 15 questões, zero pendências.
  - `gemini-3.8-flash`: ~40 s, mesma qualidade.
  - `gemini-3.5-flash-lite`: ~6 s, mas gerou uma questão com o verbo faltando.
- **Espanhol** (demonstrativos e advérbios de lugar): acentos corretos e contexto profissional.
- **Função completa**, com o Supabase simulado e o Gemini de verdade:
  - pedido e ajuste em dois turnos, 16 s e 10 s, sem pendências;
  - registro das gerações;
  - bloqueio de quem não é professor.
- **Migração 0004:** testada no PGlite (cota, permissões, aluno sem acesso).

## Como publicar (uma vez)

### 1. Rodar a migração
No Supabase: **SQL Editor** → colar `supabase/migrations/0004_assistente_ia.sql` → **Run**.

### 2. Cadastrar a chave do Gemini como segredo
No Supabase: **Edge Functions → Secrets** (ou **Project Settings → Edge Functions**) → **Add new secret**:
- Name: `GEMINI_API_KEY`
- Value: a chave criada no Google AI Studio

A chave fica só no Supabase. Ela nunca vai para o site nem para o GitHub.

> A chave usada nos testes apareceu no histórico do chat. Por segurança, gere uma nova no AI Studio, cadastre a nova aqui e apague a antiga.

### 3. Publicação automática (GitHub Actions)
As funções `assistente` e `audio` são testadas e publicadas sozinhas a cada push na `main` que mexa em `supabase/functions/` (workflow `.github/workflows/funcoes.yml`). Não é mais preciso colar o código no painel. A publicação já sai com o "Verify JWT with legacy secret" desligado, como estava no painel: a própria função confere o login.

Configuração, uma vez:
1. No Supabase: avatar (canto superior direito) → **Account preferences → Access Tokens → Generate new token**. Dê um nome (ex.: "GitHub upenglish") e copie o token.
2. No GitHub: repositório **upenglish → Settings → Secrets and variables → Actions → New repository secret**. Name: `SUPABASE_ACCESS_TOKEN`; Value: o token.
3. Em **Actions → Funções do Supabase → Run workflow**, publique pela primeira vez (ou faça um push que mexa nas funções).

Pelo terminal também funciona:
```bash
npx supabase functions deploy assistente --project-ref txzjjmufcevisnsvtjwt --no-verify-jwt
```

### 4. Usar
**Exercícios → Nova lista →** painel **Assistente UP**. O idioma e o nível vêm do topo da lista.

## Groq (opcional)
1. Crie uma chave em console.groq.com e cadastre o segredo `GROQ_API_KEY`.
2. Em **Usuários → Assistente de IA**, troque o provedor para Groq. Modelo sugerido: `openai/gpt-oss-120b`.

O adaptador do Groq usa a API compatível com OpenAI e ainda não foi testado com uma chave real.

## Limites e cuidados
- O plano grátis do Gemini tem limites por minuto e por dia, que aparecem no AI Studio. Quando estoura, a função tenta de novo duas vezes e depois avisa o professor.
- No plano grátis, o Google pode usar o conteúdo para melhorar os modelos. Por isso só mandamos o pedido do professor e exemplos de exercícios, **nunca** respostas ou dados de alunos.
- Para trocar por um modelo pago depois (Claude, por exemplo), basta um adaptador novo na função e uma linha em `config_ia`.
