# UP English — plataforma de ensino de idiomas

Plataforma da escola **UP English** (Teacher Monique Barros) para dar aulas e exercícios de **inglês, espanhol e francês**. A professora monta cursos e turmas com os slides em PDF e os exercícios; o aluno entra pelo convite da turma, estuda, pratica com correção na hora e entra na aula ao vivo. Substitui os exercícios em Google Forms.

**No ar:** https://upenglish.pages.dev

> O repositório se chama `eegen` porque o projeto começou como um gerador de exercícios de listening. Esse gerador continua aqui (veja o fim deste arquivo), mas hoje é só uma parte pequena.

## O que a plataforma faz

**Aluno**
- Entra numa turma pelo link de convite e espera a professora aprovar.
- Vê cada turma em um bloco, com as abas **Início**, **Aulas**, **Exercícios** e **Ao vivo**.
- Lê o PDF da aula dentro do site e faz os exercícios do fim dela, com correção e dicas na hora (pode refazer; vale a melhor nota).
- Faz exercícios de listening, com áudio e transcrição, e exercícios **extras** que a professora libera para a turma.
- Entra na aula ao vivo (Google Meet) por um botão que aparece em destaque perto da hora.
- Recebe notificações (aula nova, extra novo, entrada aprovada) e escolhe quais quer receber.

**Professora**
- **Biblioteca de aulas em PDF:** envia vários PDFs de uma vez, organiza por idioma e nível, e reaproveita o mesmo PDF em vários cursos.
- **Cursos:** monta as aulas (PDF da biblioteca + exercícios), arrasta para reordenar e cria exercícios já dentro da aula.
- **Exercícios:** editor com vários formatos (múltipla escolha, verdadeiro ou falso, lacunas, resposta curta), listening com áudio e o **Assistente UP** (IA que escreve a lista a partir de um pedido).
- **Turmas:** convite com mensagem pronta para o grupo, aprovação de alunos, liberação aula por aula, exercícios extras (inclusive por nível) e o link da aula ao vivo.
- **Resultados:** notas, quem fez o quê e em quais questões os alunos mais erram, por turma, lista e aluno.

**Admin**
- Promove professoras, bloqueia usuários e configura as IAs (limites por dia).
- Vê o registro de tudo o que foi apagado (curso, turma, aula, matrícula), com quem pediu e quando.

## Como as peças se encaixam

```
BIBLIOTECA (montada uma vez)
├─ Aulas em PDF   → os slides, com título, idioma e nível
└─ Exercícios     → as listas de exercícios

CURSOS
└─ Curso "Inglês · Beginner"
   └─ Aula 1, 2, 3...   → um PDF da biblioteca + os exercícios do fim da aula

TURMAS
└─ Turma "Beginner · terça 19h" → segue um curso
   ├─ Alunos     → convite, pedidos e aprovação
   ├─ Aulas      → a professora libera uma a uma
   ├─ Extras     → exercícios avulsos
   └─ Ao vivo    → link do Meet e horários
```

**O que o aluno enxerga:** nada, até a professora aprovar a entrada. Depois, só as aulas **liberadas** para a turma dele (com o PDF e os exercícios publicados delas) e os extras da turma. O acesso é aplicado no banco (RLS), não só nas telas. A plataforma é fechada: o cadastro exige o código de uma turma.

Detalhes e regras de cada parte em [docs/cursos-e-turmas.md](docs/cursos-e-turmas.md).

## Tecnologia

| Camada | O que usamos |
|---|---|
| Site | React 19, Vite, TypeScript, Tailwind CSS v4, React Router |
| Banco, login e arquivos | Supabase: Postgres com regras de acesso por linha (RLS), Auth, Storage (áudios e PDFs) e Edge Functions |
| IA | Google Gemini (plano grátis): texto do Assistente UP e voz dos listenings, chamado só pelas Edge Functions |
| Publicação | Cloudflare Pages, a cada envio para a `main` |
| Testes e CI | Banco testado num Postgres local (PGlite) e build, tudo no GitHub Actions |

## Mapa do repositório

```
plataforma/             o site
├─ src/paginas/         as telas (turmas, cursos, biblioteca, resultados...)
├─ src/componentes/     peças reutilizáveis (menu, gráficos, questões...)
├─ src/lib/             regras e acesso a dados
└─ testes/banco.mjs     testes do banco (todas as migrações + regras de acesso)
supabase/
├─ migrations/          o banco, em ordem (0001 a 0020)
├─ functions/           assistente (IA das listas) e audio (voz dos listenings)
└─ exemplos/            listas e cursos de exemplo, com gerador
docs/                   documentação de cada parte
backup/                 cópia de segurança semanal (roda em um repositório privado)
.github/workflows/      plataforma.yml (build e testes) e gerar.yml (gerador de áudios)
gerador.py, roteiros/…  o gerador de listening original (veja o fim)
.claude/skills/         skills de UX/UI usadas no desenvolvimento (só no computador do Pedro)
```

## Rodar no computador

1. No Supabase: **SQL Editor** → cole e rode, em ordem, cada arquivo de [`supabase/migrations/`](supabase/migrations/) (`0001_...` a `0017_...`).
2. Copie `plataforma/.env.example` para `plataforma/.env.local` e preencha a publishable key.
3. Rode:

```bash
npm --prefix plataforma install
npm --prefix plataforma run dev
```

Outros comandos:

```bash
npm --prefix plataforma run build        # confere os tipos e gera o site
npm --prefix plataforma run test:banco   # roda todas as migrações num Postgres local e confere as regras de acesso
```

Papéis: todo cadastro novo entra como **aluno**; um **admin** promove professoras na tela *Usuários*.

## O banco (migrações)

| Migração | O que traz |
|---|---|
| `0001` | Perfis e papéis (admin, professor, aluno) |
| `0002` | Cursos, aulas, turmas, matrículas e aulas liberadas |
| `0003` | Listas de exercícios, questões, gabaritos e a correção no servidor |
| `0004` | Assistente de IA: configuração e limite diário |
| `0005`, `0006` | Áudios dos listenings (bucket e leitura pela equipe) |
| `0007` | Bloqueio de usuários |
| `0008` | Francês |
| `0009` | PDF nas aulas e exercícios de cada aula |
| `0010` | Funções dos Resultados |
| `0011` | Entrada na turma com aprovação, exercícios extras e quem vê cada lista |
| `0012` | Notificações e preferências |
| `0013` | Aula ao vivo (link e horários por turma) |
| `0014` | Ajustes para a professora montar tudo de uma vez (e avisos em lote) |
| `0015` | Biblioteca de aulas em PDF |
| `0016` | Registro de exclusões |
| `0017` | Nome vindo do Google no cadastro |
| `0018` | Exercícios do curso |
| `0019` | Exercício adicionado ao curso já fica liberado para as turmas |
| `0020` | Monitor de erros: erros do site para o admin ver, e verificações do banco ([docs](docs/monitor-de-erros.md)) |

## Assistente de IA e áudio

Duas Edge Functions do Supabase, publicadas pelo painel (com *Verify JWT* desligado, porque o projeto usa tokens ES256):
- **assistente:** escreve listas de exercícios (inclusive listening) a partir de um pedido da professora. Veja [docs/assistente-ia.md](docs/assistente-ia.md).
- **audio:** gera a voz dos listenings com Gemini TTS. Veja [docs/audio.md](docs/audio.md).

A chave do Gemini existe **só** como segredo `GEMINI_API_KEY` das funções no Supabase. Nunca vai para o repositório nem para o site.

## Publicação (Cloudflare Pages)

O site é publicado sozinho a cada envio para a `main`: o Cloudflare Pages baixa o repositório, roda o build e troca a versão no ar. Se o build falhar, a versão anterior continua no ar. Às vezes a fila do Cloudflare demora alguns minutos.

| Configuração no Cloudflare | Valor |
|---|---|
| Projeto | `upenglish` (Workers & Pages) |
| Production branch | `main` |
| Root directory | `plataforma` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variáveis | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `NODE_VERSION=24` |

- As variáveis entram no build. Se mudar alguma, faça um novo deploy (**Deployments** → **Retry deployment**).
- Só a chave **publishable** vai para o site. A chave secret/service_role nunca entra aqui nem no repositório.
- [`plataforma/public/_redirects`](plataforma/public/_redirects) faz os links internos (`/praticar/...`, `/aulas/...`) abrirem direto.
- No Supabase, em **Authentication → URL Configuration**, o *Site URL* e as *Redirect URLs* precisam apontar para `https://upenglish.pages.dev`, senão os e-mails de confirmação e de nova senha levam para `localhost`.
- **Migração antes do código:** quando uma mudança depende de uma migração nova, rode a migração no Supabase **antes** de enviar o código, senão o site publicado quebra.

## Conteúdo de exemplo

[`supabase/exemplos/`](supabase/exemplos/) tem 25 listas prontas, todas com listening: 10 de inglês, 10 de espanhol e 5 de francês, do nível 1 ao 6. O conteúdo fica em `ingles.json`, `espanhol.json` e `frances.json`, no mesmo formato do assistente.

1. `py supabase/exemplos/montar.py` confere o conteúdo, gera os MP3 em `supabase/exemplos/audios/` (edge-tts, sem gastar a cota do Gemini) e escreve `listas_de_exemplo.sql` e `cursos_de_exemplo.sql`.
2. No Supabase, em **Storage → audios → Upload**, envie os 25 MP3.
3. No **SQL Editor**, rode `listas_de_exemplo.sql` (pode rodar de novo sem duplicar).
4. Opcional, só para testar: `cursos_de_exemplo.sql` cria um curso e uma "Turma de teste" por idioma. Eles têm uma aula por lista e **sem PDF**, então não servem como curso real. Para o conteúdo de verdade, monte os cursos pela biblioteca (apague os de exemplo com o comando em [docs/cursos-e-turmas.md](docs/cursos-e-turmas.md)).

Para apagar as listas de exemplo: `delete from public.listas where origem = 'exemplo';`.

## Documentação

| Arquivo | Assunto |
|---|---|
| [docs/cursos-e-turmas.md](docs/cursos-e-turmas.md) | Biblioteca, cursos, turmas, convite e aprovação, aula ao vivo, notificações, registro de exclusões |
| [docs/exercicios.md](docs/exercicios.md) | Formatos de exercício, correção, resultados e o desenho do assistente |
| [docs/assistente-ia.md](docs/assistente-ia.md) | Assistente UP: como funciona e como publicar |
| [docs/audio.md](docs/audio.md) | Áudio dos listenings (Gemini TTS) |
| [docs/backup.md](docs/backup.md) | Cópia de segurança semanal: como ligar e como restaurar |
| [docs/monitor-de-erros.md](docs/monitor-de-erros.md) | Aba "Erros e testes": o que é registrado, privacidade e verificações |
| [docs/interface.md](docs/interface.md) | Convenções de acessibilidade e usabilidade da interface |

## Próximos passos

- **E-mail próprio para os cadastros:** hoje a confirmação usa o envio padrão do Supabase, que só alcança e-mails da equipe e manda poucos por hora. É preciso configurar um SMTP (por exemplo, o Gmail da escola com senha de app) antes de abrir para os alunos.
- **Interface:** menu do celular, diálogo de confirmação próprio e filtros na URL (lista em [docs/interface.md](docs/interface.md)).
- **Speaking:** exercícios com gravação da voz do aluno.
- **Uma turma com mais de um curso**, hoje cada turma segue um só.
- **Domínio próprio.**

---

## O gerador de listening (onde tudo começou)

Script em Python que transforma roteiros de diálogo (`roteiros/*.txt`) em **áudios MP3** com vozes neurais diferentes para cada falante (edge-tts) e em uma **planilha** `planilhas/exercicios.xlsx` com exercícios de verdadeiro ou falso e múltipla escolha. Ainda é usado pelo gerador de exemplos, mas a plataforma não depende dele.

**Instalação:** Python 3.10 ou mais novo, FFmpeg no PATH (ou `ffmpeg.exe` na pasta do projeto) e `py -m pip install -r requirements.txt`.

```bash
py gerador.py                  # valida, gera áudios e planilha
py gerador.py --validar        # só confere os roteiros
py gerador.py --so-planilha    # não chama o TTS
py gerador.py --so-audio --forcar --rate=-10% --pausa 600
py gerador.py --seed 2         # outro sorteio das alternativas
py gerador.py --paralelo 10    # mais falas ao mesmo tempo no TTS
```

Os áudios só são refeitos quando as falas, vozes, velocidade ou pausa mudam.

**Formato do roteiro:**

```
TITLE: Greetings at the Cafe
LEVEL: Below Beginner (Pre-A1)
VOICE MIA: en-GB-SoniaNeural

AUDIO SCRIPT
MIA: Hello.
SAM: Hello.

TRUE OR FALSE
[T] Sam orders a small coffee.
[F] Sam does not want milk.
> Explicação opcional.

MULTIPLE CHOICE
? What does Sam order?
* Coffee
- Tea
- Juice
```

- `TITLE`, `LEVEL` e `VOICE` são opcionais (título e nível saem do nome `A1_02_Titulo.txt`).
- `*` marca a alternativa correta; `-` as erradas (2 a 5 alternativas).
- `>` logo abaixo de uma questão define a explicação dela.

**Geração automática (GitHub Actions):** a cada push na `main` que altere `roteiros/`, `gerador.py` ou `requirements.txt`, o workflow [`gerar.yml`](.github/workflows/gerar.yml) valida os roteiros e gera áudios e planilha. Só os áudios de roteiros alterados são refeitos. Para baixar: aba **Actions** → execução mais recente → **Artifacts** → `materiais`.
