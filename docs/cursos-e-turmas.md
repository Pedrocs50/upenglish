# Turmas, cursos e aulas

**Status (19/10/2026):** ativo. É a espinha da plataforma: o aluno só vê o que foi liberado para a turma dele.

## Exercícios do curso (migrações `0018` e `0019`)
Os exercícios ficam **no curso**, numa lista própria e em ordem, separados das aulas. Ao entrar no curso, o exercício **já fica liberado em todas as turmas dele**, sem etapa de aprovação. Cada turma ainda pode recolher o que quiser segurar.

- **No curso** (`/cursos/:id`, seção "Exercícios do curso"):
  - "Adicionar vários exercícios de uma vez": marca o nível (ex.: Elementary) e entram todos de uma vez;
  - publicados vêm marcados e rascunhos desmarcados;
  - a ordem é automática: primeiro os que combinam com uma aula pelo nome, na ordem das aulas, e depois o resto em ordem natural;
  - depois dá para subir, descer, tirar do curso ou usar "Organizar na ordem das aulas";
  - "Criar exercício novo neste curso" abre o editor em `/exercicios/nova?curso=ID`, e a lista entra no curso no primeiro salvamento.
- **Na turma** (`/turmas/:id`, aba **Exercícios**):
  - tudo que entra no curso aparece já liberado, e turma nova nasce com os exercícios do curso;
  - "Recolher" esconde da turma; o recolhido só volta com "Liberar" (um a um ou "Liberar todos");
  - o aluno recebe um aviso só por comando ("5 exercícios novos");
  - "Copiar aviso para o grupo" traz os links.
- **Para o aluno:** em Exercícios, o filtro "Do curso" aparece ao lado de "Das aulas" e "Extras". O "Próximo exercício" passa pelos do curso depois das aulas.
- **Regra:** o aluno vê o exercício se ele estiver publicado, no curso da turma e não recolhido na turma. Tirar do curso esconde de novo.
- **Rascunhos:** podem entrar no curso, mas ficam escondidos até serem publicados, porque podem estar incompletos. Ao publicar, o exercício aparece e o aluno recebe o aviso.
- **Exercícios que já estavam no curso antes da `0019`:** continuam como estavam. Eles podem ter sido segurados de propósito; para abrir, use "Liberar todos" na turma.
- **Diferença dos extras:** o extra é escolhido turma por turma. O exercício do curso é montado uma vez e serve a todas as turmas do curso.

## Colocar PDFs e aulas mais rápido
- **PDFs nas aulas que já existem** (página do curso, "Colocar os PDFs nas aulas"):
  - aparece quando alguma aula está sem material;
  - para cada aula, o site sugere o PDF da biblioteca pelo nome (ex.: "Regular and Irregular Plurals" ↔ `ENGLISH CLASS - REGULAR AND IRREGULAR PLURALS.pdf`);
  - a professora confere e salva tudo de uma vez;
  - "Enviar PDFs do computador" manda vários de uma vez para a biblioteca, já com o idioma e o nível do curso, e eles entram nas sugestões.
- **Nova aula pela turma:** o botão "Nova aula" na aba Aulas abre o formulário no curso (`/cursos/:id?nova=aula`). A aula entra no curso e fica bloqueada em todas as turmas até cada uma liberar.
- **Escolher exercício numa aula ou nos extras:** o menu mostra só o idioma do curso, agrupado por nível, com o nível do curso primeiro.
- **Página Exercícios:** filtros por idioma, nível e "Fora dos cursos" (listas que nenhum aluno vê).

## Registro de exclusões (migração `0016`)
Tudo o que for apagado de **cursos, turmas, aulas e matrículas** fica anotado: o que era (com uma cópia do conteúdo), quando, quem pediu e por onde. Só o admin vê, em **Configurações → Exclusões recentes**.

- **Por onde:** "DELETE /cursos" quando o pedido veio do site, e "SQL direto" (sem usuário) quando veio do SQL Editor do Supabase.
- **Cascata:** apagar um curso também apaga as aulas e as turmas dele; cada linha que sumiu junto tem o seu registro.
- **Restaurar:** a cópia fica em `registro_exclusoes.linha` (JSON), então dá para recriar a linha a partir dela.
- Foi criado para investigar turmas e cursos que "sumiam" sem ninguém ter apagado.

## Biblioteca de aulas em PDF (migração `0015`)
Os slides das aulas ficam guardados **uma vez**, na **Biblioteca → Aulas em PDF**, com título, idioma e nível. Qualquer curso pode usar o mesmo PDF numa aula, sem enviar de novo e sem procurar no Drive.

- **Enviar em lote:** escolha o idioma (e o nível, se todos forem do mesmo), arraste vários PDFs ou uma pasta, e envie. O título sai do nome do arquivo (`ENGLISH CLASS - REGULAR AND IRREGULAR PLURALS (1).pdf` vira "Regular and Irregular Plurals"; `1° CLASE DE ESPAÑOL.pdf` vira "1° Clase de Español"). Se o nome tiver o nível (Beginner, Elementary, A2...), ele é reconhecido. PDFs repetidos (mesmo nome e tamanho) e arquivos acima de 50 MB são pulados, com o motivo.
- **Organizar:** como os nomes costumam não trazer o nível, marque vários PDFs e use "Definir nível" (ou "Definir idioma"). Dá para editar o título e o nível de cada um na própria linha, filtrar por idioma, nível, busca ou "só os que nenhuma aula usa", e ver em quantas aulas cada PDF está.
- **Na aula:** o material pode ser **Da biblioteca** (busca; os do nível do curso aparecem primeiro e o tema da aula é preenchido com o título do PDF), **Enviar novo PDF** (vai para a biblioteca também) ou **Colar link**.
- **Montar o curso pela biblioteca:** na página do curso, "Montar aulas com os PDFs da biblioteca" cria uma aula para cada PDF marcado (nível do curso e "sem nível"), em ordem natural (1°, 2°, 10°), pulando os que o curso já usa. Depois, em cada aula, a professora coloca os exercícios.
- **Segurança:** os arquivos continuam no bucket privado `materiais`. Só a equipe vê a biblioteca. O aluno só abre o PDF pela aula liberada para a turma dele, com a mesma regra de antes (a aula guarda o caminho do arquivo). O banco **não deixa apagar** um PDF que alguma aula usa, e excluir uma aula **não apaga** o arquivo (outras aulas podem usá-lo).
- **PDFs que já estavam nas aulas** entram sozinhos na biblioteca ao rodar a migração, com o idioma e o nível do curso.

Os cursos de exemplo (`cursos_de_exemplo.sql`) foram criados com uma aula para cada lista de exercícios e **sem PDF**, só para testar. Para o conteúdo real, apague-os e monte os cursos pela biblioteca:
```sql
delete from public.cursos where descricao = 'Curso de demonstração: uma aula por lista de exemplo, do nível 1 ao 6.';
```

## A ideia
O conteúdo (**biblioteca**) fica separado de para quem e quando (**turma**):

```
BIBLIOTECA (montada uma vez)
├─ Aulas em PDF   → os slides, com título, idioma e nível
└─ Exercícios     → as listas (banco em /exercicios)

CURSOS
└─ Curso "Inglês · Beginner"
   └─ Aula 1, 2, 3...   → um PDF da biblioteca (ou link) + os exercícios do fim da aula

TURMAS (o dia a dia da professora)
└─ Turma "Beginner · Terça 19h" → segue um curso
   ├─ Aulas      → a professora libera depois de dar a aula
   ├─ Extras     → listas avulsas só desta turma (revisão, prática, prova)
   ├─ Alunos     → link de convite + aprovação de quem pediu para entrar
   └─ Resultados → /resultados?turma=...
```

Um curso pode servir a várias turmas, e cada turma libera as aulas no próprio ritmo.

## Quem vê o quê
- **Aluno sem turma ou com o pedido pendente:** não vê nenhum exercício, só "Entre na sua turma" ou "Pedido enviado".
- **Aluno aprovado:** vê as aulas liberadas para a turma dele, com o material e os exercícios publicados de cada uma, os exercícios publicados do curso (menos os recolhidos na turma) e os extras publicados da turma.
- **Lista publicada fora de qualquer aula e de qualquer turma:** ninguém de fora da equipe vê. A página Exercícios mostra "Fora das turmas" nesses casos.
- **Equipe:** vê tudo. Em "Visão do aluno" (`/aluno`), escolhe uma turma e vê exatamente o que os alunos dela veem.

## Entrada do aluno
1. A professora copia a mensagem de convite na aba **Alunos** da turma. Ela traz o link `/convite/CÓDIGO`.
2. O aluno abre o link, e o cadastro já vem com o código preenchido. Sem um código válido, o cadastro não é enviado.
3. O pedido fica **pendente**. A professora vê o aviso no início e na turma, e então aprova ou recusa. "Aprovar todos" também existe.
4. Aprovado, o aluno passa a ver a turma em **Minhas turmas**.

Quem já tem conta abre o mesmo link (ou digita o código em Minha turma) e o pedido é criado do mesmo jeito. "Encerrar entradas" faz o código parar de aceitar pedidos.

## Telas
| Rota | Quem | O que faz |
|---|---|---|
| `/turmas` | professor, admin | Turmas com alunos, aulas liberadas e selo de pedidos |
| `/turmas/:id` | professor, admin | Abas Aulas (liberar e "Nova aula"), Exercícios (os do curso, já liberados; recolher ou liberar de novo), Extras (listas avulsas, salva sozinho) e Alunos (pedidos, alunos e convite). Atalhos para Resultados e "Ver como aluno" |
| `/cursos`, `/cursos/:id` | professor, admin | Biblioteca: cursos e aulas, com PDF ou link e os exercícios de cada aula, e os exercícios do curso. Mostra as turmas que seguem o curso |
| `/aluno` | aluno (e a equipe, como visão do aluno) | **Minhas turmas**: um bloco por turma, com curso, progresso, a próxima aula ao vivo e os selos "Aula nova" e "extras novos". Pedidos pendentes aparecem como blocos à parte. Embaixo, entrar em outra turma |
| `/aluno/turmas/:id` | aluno (e equipe) | Página da turma: topo com o progresso e "Entrar na aula", e as abas **Início** (aula ao vivo, próximo exercício, atalhos, aula mais recente), **Aulas**, **Exercícios** ("Das aulas", agrupados por aula, "Do curso" e "Extras", com filtro e busca) e **Ao vivo** |
| `/aulas/:id` | aluno, equipe | Capa, PDF dentro do site e "Hora de praticar!" |
| `/convite/:codigo` | todos | Cadastro com o código (sem login) ou pedido de entrada (logado) |

Cada turma fica separada: o aluno escolhe o bloco e tudo o que vê dentro é daquela turma. Os links de aula e de exercício levam `?turma=`, então o "voltar" leva de volta à turma certa. Os endereços antigos `/praticar` e `/aluno?turma=` redirecionam para a página nova.

## Banco
Migrações `0002` (cursos, aulas, turmas, matrículas, aulas liberadas), `0009` (PDF e exercícios da aula), `0011` (aprovação, extras e a nova regra de visibilidade) e `0018` (exercícios do curso).

| Tabela | Para que serve |
|---|---|
| `cursos` | Idioma (`ingles`/`espanhol`/`frances`), nível (1 a 6), título e descrição |
| `aulas` | Aulas de um curso: número, tema, frase de abertura e o material (PDF enviado em `material_arquivo`/`material_nome`, ou link em `material_url`) |
| `aula_listas` | Exercícios de cada aula, na ordem |
| `turmas` | Turma de um professor, ligada a um curso, com código de 6 caracteres e "entradas abertas" (`ativa`) |
| `matriculas` | Aluno na turma, com `situacao` (`pendente`/`aprovada`) e `aprovada_em` |
| `aulas_liberadas` | Aulas que cada turma já vê |
| `turma_listas` | Exercícios extras de cada turma, na ordem |
| `curso_listas` | Exercícios do curso, na ordem |
| `curso_listas_liberadas` | Exercícios do curso que cada turma já liberou |

**Funções:**
- `entrar_na_turma(codigo)` cria o pedido.
- `conferir_codigo_turma(codigo)` pode ser chamada sem login e mostra a turma no cadastro.
- O gatilho de cadastro lê `codigo_turma` dos dados do cadastro e já cria o pedido.
- `lista_visivel` aplica a regra de visibilidade (usada também pelo envio de respostas).

**Regras de acesso:**
- A professora só gerencia as próprias turmas; o admin, todas.
- Só ela aprova ou recusa: o aluno não consegue mudar a própria matrícula.

Os PDFs ficam no bucket **privado** `materiais` (até 50 MB) e abrem por um link assinado que vale 1 hora.

## Exemplos
`supabase/exemplos/cursos_de_exemplo.sql` (gerado pelo `montar.py`) cria um curso de exemplo por idioma:
- uma aula por lista de exemplo;
- uma "Turma de teste";
- as primeiras aulas já liberadas e as listas restantes como extras.

Rode depois de `listas_de_exemplo.sql`.

## Atalhos para a professora
- **Criar exercício dentro da aula:**
  - o botão "+ Exercício" em cada aula do curso (ou no formulário da aula) abre o editor em `/exercicios/nova?aula=ID`;
  - idioma, nível e tema já vêm da aula, e o Assistente UP já traz o pedido com o tema;
  - no primeiro salvamento, a lista entra na aula;
  - no editor, a faixa "Aparece em" mostra em quais aulas e turmas cada lista está.
- **Mensagens prontas para o grupo** (WhatsApp), em `plataforma/src/lib/turmas.ts`:
  - **convite:** link `/convite/CÓDIGO`, passo a passo e o código. Fica na aba Alunos, com prévia, e no ícone de cada card em Turmas;
  - **aviso de aula liberada:** aparece logo depois de liberar e no ícone de cada aula liberada;
  - **aviso dos extras:** um link para cada lista.
- **Reordenar aulas:** arraste pela alça (no computador) ou use as setas. Os números são regravados na ordem nova.

## Montar tudo de uma vez (migração `0014`)
Para a professora criar todos os cursos e turmas antes de chamar os alunos:
- **Criar e já abrir:** ao criar um curso ou uma turma, o site abre a página do que foi criado (o curso, para adicionar as aulas; a turma, com o código e o convite). Se já existir um curso ou uma turma com o mesmo nome, avisa antes de criar outro.
- **Exercícios do curso em lote:** veja "Exercícios do curso" acima. Substituiu o antigo "montar aulas com os exercícios", que criava uma aula por exercício.
- **Adicionar vários exercícios por nível** (aba Extras da turma): marca os níveis (ex.: Beginner e Elementary) e entram de uma vez todas as listas publicadas deles. Rascunhos ficam de fora e as que já estão na turma não repetem.
- **Liberar todas as aulas** (aba Aulas da turma): para turmas que já estão adiantadas.
- **Um aviso só por aluno:** liberar várias aulas ou vários extras no mesmo comando gera uma notificação ("5 exercícios extras novos"), não uma por item.
- **Banco:** a professora passa a ler a turma que acabou de criar no mesmo comando de criar (antes só o admin lia). O admin vê "Turma de ..." nas turmas das outras professoras.

## Aula ao vivo
Migração `0013`. Cada turma pode ter:
- um **link fixo da reunião** (Google Meet; outras plataformas também funcionam, desde que o link comece com `https://`);
- os **horários semanais**, no horário de Brasília;
- um **aviso do dia** opcional, com a data até quando fica visível.

**Professora:** aba **Ao vivo** da turma. Tem o atalho "Criar reunião no Google Meet", o passo a passo para criar um link fixo no Google Agenda, o botão "testar o link" e "Copiar link e horários para o grupo". O campo aceita o link sem `https://` ou no meio do convite inteiro do Meet.

**A reunião é criada na conta Google da própria professora:** a plataforma guarda só o link, sem pedir acesso à conta dela.

**Aluno:** cartão "Aula ao vivo" no Início e na aba Ao vivo da turma, e o botão compacto no topo da turma:
- **verde**, "Acontecendo agora", durante a aula;
- **azul-marinho**, "Começa em X minutos", a partir de 15 minutos antes;
- **discreto**, com "Próxima aula: amanhã às 19:00", no resto do tempo.

O cálculo usa o horário de Brasília (`plataforma/src/lib/aoVivo.ts`), então funciona mesmo com o aluno em outro fuso.

**Segurança:** o link fica numa tabela própria (`turma_encontros`) e só os alunos **aprovados** leem. Quem está com o pedido pendente vê o nome da turma, mas não o link.

**Depois, com e-mail próprio:** lembrete por e-mail antes da aula e, se fizer sentido, gerar o Meet automaticamente pela API do Google Agenda. Isso exige pedir ao Google a permissão de agenda no login e passar pela verificação do app.

**Cuidado no código:** esta tabela só permite alterar as colunas de conteúdo, então `upsert` não funciona nela. O PostgREST regrava também a chave (`turma_id`) e o banco recusa. Use `salvarEncontros` (`plataforma/src/lib/aoVivo.ts`).

## Notificações
Migração `0012`. São criadas por gatilhos no banco, então não dependem de ninguém estar com o site aberto. Ficam no sininho do menu, com o número de não lidas, e na página `/notificacoes`. O menu também mostra quantos pedidos de entrada estão pendentes em **Turmas**.

| Tipo | Para quem | Padrão |
|---|---|---|
| `pedido_entrada`: aluno pediu para entrar | professora da turma | ligada |
| `nota_baixa`: aluno da turma tirou menos de 60% | professoras das turmas do aluno | ligada |
| `exercicio_feito`: aluno enviou um exercício | professoras das turmas do aluno | desligada |
| `entrada_aprovada` | aluno | ligada |
| `aula_liberada` | alunos aprovados da turma | ligada |
| `extra_liberado`: lista publicada nos extras | alunos aprovados da turma | ligada |

**Detalhes:**
- Cada pessoa liga e desliga os tipos na própria página de notificações. As escolhas ficam em `perfis.preferencias_notificacao`, e o que não estiver lá segue o padrão da função `quer_notificacao`.
- Tentativas da equipe não geram aviso.
- Ninguém cria notificação pela API, só os gatilhos.
- Próximos tipos possíveis: aluno parado há X dias, extra com prazo chegando e resumo semanal por e-mail (quando o e-mail próprio estiver configurado).

## Pendente
- Datas de liberação: abrir a aula sozinha num dia marcado.

- Prazo de entrega nos extras.
- Confirmar os nomes dos níveis com a escola.
