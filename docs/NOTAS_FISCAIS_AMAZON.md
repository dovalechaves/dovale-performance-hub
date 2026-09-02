# Notas Fiscais Amazon (FBA Classic)

Novo app do Hub para importar manualmente o ZIP de notas fiscais baixado do
**Faturador da Amazon** (Seller Central → Reports → Faturador), evitando
duplicidade por chave de acesso.

Contexto: a SP-API da Amazon exige a role restrita "Tax Invoicing" pra obter
essas notas por API, e essa role foi negada repetidas vezes. Este app existe
como caminho alternativo: a pessoa baixa o ZIP manualmente no Faturador e
arrasta aqui — sem depender de nenhuma API bloqueada.

## ⚠️ Antes de rodar — falta confirmar

**Número da área da tabela**: o script SQL usa `TI-FISCAL_900-...` como
placeholder, seguindo o padrão existente (`TI-FINANCEIRO_131-...`,
`TI-MARKETING_95-...`, `TI-COMERCIAL_45-...`). Ninguém confirmou qual
número é o correto para o setor Fiscal — troque `900` (find & replace) em
`database/2026-09-02_notas_fiscais_amazon.sql` **e** nas duas constantes
no topo de `server/services/notas-fiscais-amazon.service.ts`
(`TABELA_NOTAS`, `TABELA_ITENS`) antes de rodar em produção.

## Validado contra um ZIP real do Faturador (29 XMLs, ago/2026)

O parser foi testado contra um ZIP de exemplo baixado direto da conta.
Achados importantes que mudaram o desenho original:

- **O ZIP não traz só nota de venda.** Traz uma mistura de 4 tipos de
  documento, todos ligados ao ciclo fiscal do FBA: `VENDA` (venda ao
  consumidor final — a que interessa pra GNRE), `DEVOLUCAO`, `REMESSA`
  (remessa da DOVALE pro CD da Amazon) e `RETORNO_SIMBOLICO` (retorno
  simbólico do CD confirmando recebimento). O app importa e guarda todos,
  classificados no campo `TipoOperacao` (coluna "Tipo" na tela).
- **Não existe `xPed` nos XMLs da Amazon.** O número do pedido
  (`701-XXXXXXX-XXXXXXX`) vem como texto solto dentro de
  `infAdic.infCpl`, tipo "...Numero do pedido da compra: 701-...". O
  parser extrai isso por regex — já validado, bate certinho com o
  `AmazonOrderId` da Orders API.
- **Bug real encontrado e corrigido**: o `fast-xml-parser`, por padrão,
  converte texto numérico em `number` — isso destruía CPF/CNPJ/CEP com
  zero à esquerda (`08937521776` virava `8937521776`). Corrigido com
  `parseTagValue: false` no parser + conversão manual só nos campos que
  são de fato numéricos.
- **DIFAL e FCP já vêm calculados no XML** (bloco `ICMSUFDest` de cada
  item, só presente nas notas de `VENDA`/`DEVOLUCAO`) — gravados em
  `ValorDifal` e `ValorFcpUfDest` na tabela de itens. Isso simplifica
  bastante o futuro motor de GNRE: pra notas interestaduais, o valor já
  está pronto no próprio documento, não precisa recalcular do zero.

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
  nenhuma, e o `NumeroPedidoAmazon` já é extraído corretamente do XML
  (ver acima) — falta só o passo de fato ligar as duas tabelas
  (`AmazonOrderId = NumeroPedidoAmazon`) numa consulta/tela própria.
- **Motor de cálculo de GNRE**: a tabela de itens já guarda ICMS, ICMS-ST,
  FCP, DIFAL (`ValorDifal`/`ValorFcpUfDest`, já calculados pelo emissor),
  IPI, PIS, COFINS por item, filtrável por `TipoOperacao = 'VENDA'` — mas
  a consolidação num valor de guia GNRE por UF/período ainda não foi
  implementada.
- **Backfill automático**: para meses anteriores (ex: agosto), o ZIP
  precisa ser baixado manualmente no Faturador — não há automação
  retroativa por enquanto.
