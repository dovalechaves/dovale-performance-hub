# Manual de Uso — Dovale Performance Hub

Este documento explica como utilizar o **Dovale Performance Hub**, sistema interno de gestão e acompanhamento de vendas da Dovale.

---

## Sumário

1. [Acesso ao Sistema](#1-acesso-ao-sistema)
2. [Hub Principal](#2-hub-principal)
3. [Painel de Vendas](#3-painel-de-vendas)
4. [Gestão de Metas e Usuários](#4-gestão-de-metas-e-usuários)
5. [Calculadora de Preços](#5-calculadora-de-preços)
6. [Disparo em Massa (WhatsApp)](#6-disparo-em-massa-whatsapp)
7. [Fechamento](#7-fechamento)
8. [Multi-Preço](#8-multi-preço)
9. [Inventário](#9-inventário)
10. [Score de Crédito](#10-score-de-crédito)
11. [Cobrança Automatizada](#11-cobrança-automatizada)
12. [Bot de Demandas (TI)](#12-bot-de-demandas-ti)
13. [Onboarding (RH)](#13-onboarding-rh)
14. [Perfis de Acesso](#14-perfis-de-acesso)
15. [Perguntas Frequentes](#15-perguntas-frequentes)

---

## 1. Acesso ao Sistema

1. Abra o navegador e acesse o endereço fornecido pela TI.
2. Na tela de login, informe seu **usuário** e **senha** corporativos.
3. Clique em **Entrar**.

> **Dica:** Caso não consiga fazer login ou não veja um aplicativo que deveria ter acesso, fale com o administrador do sistema.

---

## 2. Hub Principal

Após o login você é direcionado ao **Hub**, que é a tela central com todos os aplicativos disponíveis.

![Hub]

### O que você vê no Hub

| Elemento | Descrição |
|---|---|
| Saudação personalizada | Exibe seu nome no topo da tela |
| Cards de aplicativos | Cada card representa um app. Clique nele para abrir |
| Ícone de tema | Alterna entre modo claro e escuro (canto superior direito) |
| Botão de logout | Encerra sua sessão |
| Gerenciamento de usuários *(admin)* | Painel para criar/editar permissões de usuários |

> Apenas os aplicativos para os quais você tem permissão são exibidos.

---

## 3. Painel de Vendas

**Rota:** `/dashboard`  
**Quem acessa:** Gerentes, analistas e administradores

O Painel de Vendas mostra em tempo real o desempenho dos vendedores em relação às metas mensais e diárias.

---

### 3.1 Navegando pelo Painel

Ao abrir o app, você verá:

- **Barra de controles** no topo
- **Barra de estatísticas** (para quem tem permissão `view:stats`)
- **Classificação de vendedores** com cards individuais

---

### 3.2 Barra de Controles

| Controle | Descrição | Quem vê |
|---|---|---|
| ← Hub | Volta para o Hub principal | Todos |
| Seletor de Loja | Troca entre as lojas (BH, Campinas, Fortaleza, etc.) | Administradores |
| Seletor de Mês | Consulta meses anteriores | Loja Rio Preto |
| Última atualização | Timestamp da última carga de dados | Todos |
| Atualizar | Força nova busca dos dados | Todos |
| Modo TV | Oculta os valores exatos de venda para exibição em telão | Gerentes/Admin |
| Tema | Alterna claro/escuro | Todos |
| Logout | Encerra sessão | Todos |

---

### 3.3 Visualização Mensal x Diária

Use os botões **Mensal** e **Hoje** para alternar a visão:

- **Mensal:** Exibe o total de vendas do mês e a meta mensal de cada vendedor.
- **Hoje:** Exibe as vendas do dia e a meta diária (calculada automaticamente: meta mensal ÷ dias úteis do mês).

Os dados são atualizados **automaticamente a cada 1 minuto**.

---

### 3.4 Cards de Vendedores

Cada card representa um vendedor e mostra:

- **Posição no ranking** (1º, 2º, 3º…)
- **Nome e iniciais** do vendedor
- **Loja** vinculada
- **Valor vendido** (oculto no Modo TV para não-admins)
- **Percentual da meta** atingido
- **Barra de progresso** colorida:
  - 🔴 Vermelho — abaixo da meta
  - 🟡 Amarelo — próximo da meta
  - 🟢 Verde — meta atingida

> Quando um vendedor **atinge 100%** da meta, uma animação de celebração é exibida com som.

---

### 3.5 Modal de Detalhe do Vendedor

Clique em qualquer card de vendedor para abrir o painel de detalhes, que mostra:

- Vendas por **canal/origem**
- Histórico de **transações** (quando disponível)

---

## 4. Gestão de Metas e Usuários

**Rota:** `/gestao`  
**Quem acessa:** Administradores e Gerentes

---

### 4.1 Gestão de Metas

1. Selecione a **loja** (admins podem trocar; gerentes veem apenas sua loja).
2. Selecione o **mês e ano** desejados.
3. Informe os **dias úteis** do mês no campo correspondente (influencia o cálculo da meta diária).
4. Na tabela, localize o vendedor e edite o valor da **meta**.
5. Clique em **Salvar** na linha do vendedor para confirmar.

> Gerentes só podem editar metas da própria loja. Admins editam qualquer loja.

---

### 4.2 Gestão de Usuários (Admin)

1. A lista exibe apenas usuários com acesso ao Painel de Vendas.
2. Para **alterar o perfil** de um usuário, use o seletor de papel (viewer / manager / admin).
3. Para **Gerentes**, é obrigatório atribuir uma loja específica.
4. Clique em **Salvar** para aplicar as alterações.

---

## 5. Calculadora de Preços

**Rota:** `/calculadora`  
**Quem acessa:** Administradores, gerentes e visualizadores configurados

---

### 5.1 Modos

| Modo | Descrição |
|---|---|
| **Loja** | Calcula preço de venda para a loja física a partir do custo e margem desejada |
| **Marketplace** | Calcula preço para plataformas como Mercado Livre e Shopee, considerando as taxas da plataforma |

> Admins podem alternar entre os dois modos. Gerentes têm acesso apenas ao modo Loja.

---

### 5.2 Aba Calculadora

1. Informe o **custo** do produto.
2. Informe a **margem desejada** (%).
3. O sistema calcula automaticamente o **preço de venda** e o **lucro**.

---

### 5.3 Aba Produtos

- Exibe uma base de produtos com histórico de preços.
- Permite operações em lote.
- Exportação e importação de dados disponíveis para admins.

---

## 6. Disparo em Massa (WhatsApp)

**Rota:** `/disparo`  
**Quem acessa:** Usuários autorizados

Permite enviar mensagens em massa via WhatsApp usando a API do Meta integrada ao Chatwoot.

---

### 6.1 Fluxo de Uso

1. **Faça upload** de um arquivo CSV com a lista de contatos.
2. **Selecione o template** de mensagem desejado.
3. **Escolha o inbox** do Chatwoot.
4. Clique em **Disparar** e acompanhe o progresso em tempo real.

---

### 6.2 Templates

- Os templates ficam listados com nome, categoria (MARKETING / SERVICE) e pré-visualização da mensagem.
- Para criar um novo template, clique em **Criar Template** e preencha:
  - Tipo de cabeçalho (texto, imagem, vídeo, documento ou nenhum)
  - Corpo da mensagem (com variáveis, ex: `{{1}}`)
  - Rodapé e categoria
  - Label do Chatwoot vinculada

---

### 6.3 Logs

O painel de logs exibe em tempo real:
- Horário do envio
- Contato destinatário
- Status (enviado / falhou)

---

## 7. Fechamento

**Rota:** `/fechamento`  
**Quem acessa:** Administradores e gerentes

Gera e consulta o **relatório mensal de fechamento** com estoque, vendas e lucro por loja.

---

### 7.1 Consultando Histórico

1. Selecione o **período** no filtro (mês/ano ou "todos").
2. A tabela exibe por loja: Estoque, Vendas Recebidas, Vendas (Lojas + Indústria), CAR, Lucro Bruto e Lucro Real.

> Gerentes visualizam apenas os dados de sua loja.

---

### 7.2 Executando o Fechamento Manualmente

1. Clique no botão **Executar Fechamento**.
2. Aguarde o processamento — o painel mostra o status (sucesso ou erro).
3. Quando concluído, os dados aparecem na tabela de histórico.

---

## 8. Multi-Preço

**Rota:** `/multi-preco`  
**Quem acessa:** Usuários autorizados

Sincroniza os preços da loja SJC (origem) para todas as filiais nos bancos Firebird e MySQL.

---

### 8.1 Iniciando a Sincronização

1. Clique em **INICIAR SINCRONIZAÇÃO**.
2. Acompanhe o percentual de progresso no indicador central.
3. Use **Pausar / Retomar** se necessário.

---

### 8.2 Acompanhando o Status

- Cada loja tem um **card de status** indicando sucesso ou erro na última sincronização.
- O **terminal ao vivo** exibe linha a linha as operações:
  - `[HH:MM:SS] — Loja — Código — Preço Antigo → Preço Novo`

---

### 8.3 Exportando Resultados

Clique em **Exportar CSV** para baixar o relatório com todas as operações (data, status, loja, código, preços, mensagem).

---

## 9. Inventário

**Rota:** `/inventario`  
**Quem acessa:** Contadores, aprovadores e administradores

Gerencia contagens de estoque com fluxo de aprovação.

---

### 9.1 Ciclo de Vida de uma Sessão

```
RASCUNHO → EM ANDAMENTO → CONCLUÍDO → ENVIADO → APROVADO / REJEITADO
```

---

### 9.2 Criando uma Sessão

1. Clique em **Nova Sessão**.
2. Defina os **locais** atribuídos para a contagem.
3. Inicie a contagem item a item.

---

### 9.3 Contando Itens

- Use os filtros para ver: **Todos / Contados / Não Contados / Divergentes**.
- Informe a **quantidade contada** para cada item.
- O sistema compara com a quantidade do sistema e indica divergências.

---

### 9.4 Submetendo para Aprovação

1. Finalize a contagem e clique em **Concluir**.
2. Envie para aprovação clicando em **Submeter**.
3. O aprovador analisa e clica em **Aprovar** ou **Rejeitar** (com justificativa).

---

## 10. Score de Crédito

**Rota:** `/score`  
**Quem acessa:** Usuários autorizados

Consulta o score de crédito e histórico financeiro de clientes.

---

### 10.1 Consultando um Cliente

1. Digite o **código do cliente** no campo de busca.
2. O sistema exibe:
   - **Gauge visual** do score (0–100)
   - Limite de crédito atual e ajustado
   - Atraso médio de pagamento (dias)
   - Dados cadastrais (CNPJ, endereço)

---

### 10.2 Interpretando o Score

| Faixa | Cor | Significado |
|---|---|---|
| 0 – 30 | 🔴 Vermelho | Ruim |
| 31 – 60 | 🟠 Laranja | Regular |
| 61 – 75 | 🟡 Amarelo | Bom |
| 76 – 100 | 🟢 Verde | Excelente |

---

### 10.3 Histórico de Compras

A tabela exibe: Data, Descrição, Pedido, Valor, Vencimento, Pagamento, Forma, Atraso e Status (Pago / Pendente / Vencido).

---

## 11. Cobrança Automatizada

**Rota:** `/cobranca`  
**Quem acessa:** Usuários autorizados

Envia mensagens automáticas de cobrança via WhatsApp para clientes com faturas próximas ao vencimento ou em atraso.

---

### 11.1 Aba Painel

Exibe métricas gerais:
- Total de cobranças pendentes
- Mensagens enviadas com sucesso
- Mensagens com falha
- Clientes que pagaram após a notificação

A lista de faturas mostra: cliente, número da fatura, vencimento, valor, status de vencimento (**VENCE EM X DIAS** / **VENCIDO HÁ X DIAS**) e status do envio.

---

### 11.2 Aba Histórico

Exibe todas as tentativas de cobrança anteriores com filtros e paginação.

---

### 11.3 Aba Bônus

Mostra o resumo mensal de cobranças bem-sucedidas e o valor total de bônus gerado.

---

## 12. Bot de Demandas (TI)

**Rota:** `/ai-assistant`  
**Quem acessa:** Todos os usuários com acesso ao app

Automatiza o levantamento de requisitos de novos projetos via conversa com IA, gerando um **PRD (Product Requirements Document)**.

---

### 12.1 Criando uma Nova Demanda

1. Acesse o app e inicie uma nova conversa.
2. Responda às perguntas do bot (8 etapas guiadas).
3. Ao final, o bot gera automaticamente o **PRD**.
4. Você pode **copiar** o PRD para a área de transferência ou **baixar** como documento.

---

### 12.2 Acompanhando Projetos

Na aba **Projetos**, você vê todos os seus pedidos com o status atual:

| Status | Significado |
|---|---|
| `em_analise_ti` | Aguardando análise da TI |
| `feedback_ti` | A TI adicionou feedback |
| `aprovado` | Projeto aprovado para desenvolvimento |

---

## 13. Onboarding (RH)

**Rota:** `/onboarding`  
**Quem acessa:** Equipe de RH e administradores

Automatiza a criação de contas no Active Directory para novos colaboradores.

---

### 13.1 Criando um Novo Usuário

1. Informe o **nome completo** do colaborador.
2. Selecione o **cargo**.
3. Escolha a **unidade/filial**.
4. Selecione o **departamento/setor** (muda conforme a unidade).
5. *(Opcional)* Escolha um usuário existente para **copiar permissões**.
6. Clique em **Criar**.

O sistema gera automaticamente o nome de usuário e cria a conta no AD.

---

### 13.2 Histórico de Criações

Na aba **Histórico** você vê todos os usuários criados, com data, cargo, departamento e logs de operação.

---

## 14. Perfis de Acesso

O sistema usa dois níveis de permissão: **Hub** e **por App**.

### 14.1 Perfis do Hub

| Perfil | Descrição |
|---|---|
| `admin` | Acesso total ao hub, incluindo gerenciamento de usuários e apps |
| `analyst` | Acesso aos apps permitidos, sem acesso ao gerenciamento |

### 14.2 Perfis por App (ex: Painel de Vendas)

| Perfil | Descrição |
|---|---|
| `admin` | Acesso total, todas as lojas, pode editar metas e papéis |
| `manager` | Acesso à sua loja, pode editar metas da própria loja |
| `viewer` | Somente visualização |

> A atribuição de perfis é feita pelo administrador na tela de Gestão (`/gestao`).

---

## 15. Perguntas Frequentes

**P: Não consigo ver um aplicativo no Hub.**  
R: Você não tem permissão para aquele app. Solicite acesso ao administrador.

**P: Os dados do Painel de Vendas estão desatualizados.**  
R: Clique no botão **Atualizar** na barra de controles. Os dados também são recarregados automaticamente a cada 1 minuto.

**P: Como alterar a meta de um vendedor?**  
R: Acesse `/gestao`, selecione a loja e o mês, e edite o valor na coluna da meta do vendedor desejado.

**P: O que é o Modo TV?**  
R: É uma visualização para exibição em televisores ou telões. Oculta os valores exatos de venda para que clientes ou visitantes não vejam os números. Apenas gerentes e admins podem ativar.

**P: Como faço para mudar entre tema claro e escuro?**  
R: Clique no ícone de lua/sol localizado no canto superior direito de qualquer tela.

**P: Esqueci minha senha.**  
R: Entre em contato com a TI para redefinição de senha.

---

*Documento interno — Dovale Performance Hub*  
*Última atualização: Maio de 2026*
