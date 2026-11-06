# Monitor de erros

Aba **Administração → Erros e testes** (`/admin/erros`), só para o admin. Mostra o que quebrou no navegador de quem usa o site e tem um botão para conferir as partes principais. Não depende de serviço externo: os erros ficam na tabela `erros_do_site` (migração `0020`).

## O que é registrado

| Origem na tela | O que é | De onde vem |
|---|---|---|
| Tela quebrou | Uma tela deu erro ao aparecer. A pessoa vê "Algo deu errado nesta tela" em vez da página em branco. | `componentes/LimiteDeErro.tsx` |
| Erro na página / em segundo plano | Erro de programa que ninguém tratou. | `iniciarMonitor` em `lib/monitor.ts` |
| Banco de dados | Permissão negada, coluna ou tabela inexistente, falha interna do banco. | `fetchVigiado` em `lib/monitor.ts` |
| Arquivos, Função de IA, Login | Falhas internas desses serviços (e permissão negada, nos arquivos). | `fetchVigiado` |
| Leitor de PDF | PDF ou página que não abriu. | `componentes/LeitorPdf.tsx` |
| Teste | O botão "Enviar um erro de teste". | `paginas/Monitor.tsx` |

A tela costuma mostrar uma mensagem simples, como "Você não tem permissão para fazer isso". O monitor guarda o motivo técnico por trás dela, que é o que serve para corrigir.

**O que fica de fora de propósito** (`classificarFalha` e `RUIDO`, em `lib/monitor.ts`): senha errada, sessão vencida, limite diário de IA, mensagens das regras do banco ("esse convite não existe"), internet da pessoa caída, pedidos cancelados, erros de extensões do navegador.

## Como os erros são tratados

- **Agrupados:** erros iguais ficam numa linha só, com quantas vezes aconteceram e quantas pessoas pegaram. Ids, números e nomes de arquivo não contam para diferenciar.
- **Reabrem sozinhos:** um erro resolvido que acontecer de novo volta para os abertos, com a marca "Voltou depois de resolvido". Confira a versão: uma aba antiga ainda aberta também pode fazê-lo voltar.
- **Versão:** cada erro guarda o commit publicado (`CF_PAGES_COMMIT_SHA`, do Cloudflare Pages). Fora de lá aparece `local`.
- **Limpeza:** erro parado há mais de 90 dias é apagado quando chega um erro novo.
- **Depois de publicar:** quem está com o site aberto pode pedir arquivos que não existem mais. O site recarrega sozinho uma vez; só registra erro se o problema continuar.

## Privacidade e abuso

Visitantes também podem relatar, porque as telas de login e cadastro podem quebrar. Como a chave do site é pública, `registrar_erro` é tratada como entrada não confiável:

- ninguém grava direto na tabela, nem o admin; só a função grava;
- quem pegou o erro vem do login, nunca do que o navegador diz;
- os textos são cortados, e e-mails, tokens, chaves e senhas em links são retirados;
- o link é guardado sem parâmetros, e o código de convite não é guardado;
- entram no máximo 200 erros novos por hora e 2.000 no total. Passou disso, erros novos são ignorados até a tabela esvaziar. Erros já conhecidos continuam contando;
- cada página aberta envia no máximo 20 relatos.

Alguém mal-intencionado consegue inventar erros falsos na lista, mas não consegue ler nem alterar nada. Os dados de quem pegou o erro (id, navegador) só o admin vê.

## Verificações

O botão **Rodar verificações** confere o sistema de verdade, neste navegador, com o seu login. Só lê: não muda nada e não gasta cota de IA.

| Verificação | O que uma falha costuma significar |
|---|---|
| O banco de dados responde | Projeto do Supabase pausado ou fora do ar |
| Todas as migrações foram rodadas | O site foi publicado e faltou rodar uma migração |
| Regras de acesso em todas as tabelas | Tabela nova criada sem RLS: dados expostos |
| Toda conta tem perfil | Pessoas vendo "Perfil não encontrado" |
| As pastas de arquivos existem | Bucket `audios` ou `materiais` faltando |
| Um PDF enviado pode ser baixado | Problema no Storage ou no link temporário |
| O leitor consegue desenhar um PDF | Problema no PDF.js, testado com um PDF real e neste navegador |
| Os arquivos do leitor foram publicados | Build sem `scripts/copiar-pdfjs.mjs`: imagens e fontes somem dos slides |
| As funções de IA estão publicadas | Função fora do ar ou publicação falhou |
| Listas e áudios das últimas 24 horas | Só avisa: mostra quantos pedidos falharam e o último motivo |

**Limites:** a verificação da chave do Gemini é indireta (só olha os pedidos reais das últimas 24 horas), e o resultado do PDF vale para o seu navegador, não para o de cada aluno.

**Ao criar uma migração nova,** acrescente em `MARCAS_DAS_MIGRACOES` (`lib/diagnostico.ts`) o nome de algo que só ela cria. Se ela não criar nada com nome próprio, como a `0017`, deixe de fora.

**Testes automáticos:** `npm run test:banco` e os testes das funções precisam de um banco de teste e rodam no GitHub Actions a cada publicação, não dentro do site. A tela tem um link para lá.

## O que o monitor não vê

- Site que não chega a carregar (Cloudflare fora do ar, erro antes do JavaScript começar).
- Erro de quem estava sem internet naquela hora: o relato não é guardado para depois.
- Erros dentro das funções de IA que não chegam a virar resposta de erro 500. Os registros completos ficam no painel do Supabase.
- Telas que tratam o próprio erro e só mostram um aviso, sem falha técnica por trás. Essas não geram relato: se uma delas for importante, chame `relatarErro` nela.
