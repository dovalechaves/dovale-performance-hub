# Notas Fiscais Amazon (FBA Classic)

Novo app do Hub para importar manualmente o ZIP de notas fiscais baixado do
**Faturador da Amazon** (Seller Central → Reports → Faturador), evitando
duplicidade por chave de acesso.

Contexto: a SP-API da Amazon exige a role restrita "Tax Invoicing" pra obter
essas notas por API, e essa role foi negada repetidas vezes. Este app existe
como caminho alternativo: a pessoa baixa o ZIP manualmente no Faturador e
arrasta aqui — sem depender de nenhuma API bloqueada.

## ⚠️ Antes de rodar — 2 coisas para confirmar

1. **Número da área da tabela**: o script SQL usa `TI-FISCAL_900-...` como
   placeholder, seguindo o padrão existente (`TI-FINANCEIRO_131-...`,
   `TI-MARKETING_95-...`, `TI-COMERCIAL_45-...`). Ninguém confirmou qual
   número é o correto para o setor Fiscal — troque `900` (find & replace) em
   `database/2026-09-02_notas_fiscais_amazon.sql` **e** nas duas constantes
   no topo de `server/services/notas-fiscais-amazon.service.ts`
   (`TABELA_NOTAS`, `TABELA_ITENS`) antes de rodar em produção.

2. **Campo do número do pedido no XML**: o parser assume que o número do
   pedido Amazon vem no campo padrão `xPed` (grupo `det/prod` do layout
   NF-e, usado por marketplaces para referenciar o pedido de origem). Isso
   ainda não foi validado contra uma nota real do Faturador Amazon — ao
   testar com o primeiro ZIP real, confirme se `NumeroPedidoAmazon` está
   vindo preenchido corretamente na tabela. Se não vier, ajuste
   `parseNfe()` em `notas-fiscais-amazon.service.ts`.

## Setup

1. Rode o script SQL em `database/2026-09-02_notas_fiscais_amazon.sql`
   contra o banco `DOVALE` (mesmo SQL Server já usado pelo hub —
   `DB_SQLSERVER_HOST` no `.env`). Cria duas tabelas:
   - `TI-FISCAL_900-NotasFiscaisAmazon` (uma linha por nota, com o XML
     completo guardado em `XmlConteudo` para auditoria).
   - `TI-FISCAL_900-NotasFiscaisAmazonItens` (itens/tributos por nota —
     base para o futuro motor de cálculo de GNRE).
2. **Nenhuma credencial nova é necessária** — o backend reaproveita o pool
   de conexão SQL Server já configurado (`server/db/sqlserver.ts`), o mesmo
   usado por todo o resto do hub.
3. `npm install` (já feito neste worktree — instala `adm-zip` e
   `fast-xml-parser`, que foram adicionados ao `package.json`).
4. Rodar local: `npm run dev:all` (sobe frontend Vite + backend Express
   juntos, como o resto do hub).
5. No Hub, um admin precisa liberar o acesso ao app **"Notas Fiscais
   Amazon"** para os usuários que forem usar (Gerenciamento de Usuários e
   Apps → coluna "NF Amazon"), do mesmo jeito que os outros apps.

## Como usar

1. No Seller Central: **Reports → Faturador** → filtra o período → baixa o
   ZIP com os XMLs.
2. No Hub: abre o app "Notas Fiscais Amazon" → arrasta o ZIP (ou clica pra
   selecionar) na área de upload.
3. O backend extrai os `.xml` de dentro do ZIP, faz parse de cada nota e
   grava — **ignorando automaticamente qualquer nota cuja `ChaveAcesso` já
   exista no banco** (dedupe real, não é só por nome de arquivo).
4. Eventos de cancelamento (`procEventoNFe`, tipo `110111`) dentro do
   mesmo ZIP atualizam `Situacao = 'CANCELADA'` na nota já importada, sem
   duplicar nada.
5. A tela mostra um resumo (novas / já existiam / com erro) depois de cada
   upload, e uma lista com busca por chave, pedido ou número da nota.

## O que NÃO está incluso ainda

- **Reconciliação com o pedido Amazon**: a Orders API (`AmazonOrderId`,
  `FulfillmentChannel=AFN`) já foi validada e funciona sem restrição
  nenhuma, mas a ligação pedido ↔ nota aqui depende do campo `xPed` do
  item 2 acima. Isso é o próximo passo natural depois que o campo for
  confirmado.
- **Motor de cálculo de GNRE**: a tabela de itens já guarda ICMS, ICMS-ST,
  FCP, IPI, PIS, COFINS por item — mas o cálculo do valor da guia em si
  (regras por UF/NCM/CFOP) ainda não foi implementado.
- **Backfill automático**: para meses anteriores (ex: agosto), o ZIP
  precisa ser baixado manualmente no Faturador — não há automação
  retroativa por enquanto.
