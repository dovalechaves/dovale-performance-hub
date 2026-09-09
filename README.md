# Dovale Performance Hub

Hub interno da Dovale: um único painel web (SSO, com controle de acesso por app/perfil) que reúne as ferramentas de gestão que hoje rodam sobre o ERP Microsys (Firebird) e sistemas paralelos (SQL Server, MySQL de parceiros, WhatsApp, marketplaces). Nasceu pra parar de espalhar planilha/script avulso e virar um só lugar onde vendas, estoque, cobrança, comissão e comunicação com cliente acontecem.

> Este documento é um retrato do que existe **hoje** no código, pra dar contexto rápido a quem não acompanha o dia a dia técnico. Feito para discussão de produto — pode (e deve) ficar desatualizado conforme o hub evolui.

---

## Como está montado

- **Frontend**: React + Vite + TypeScript, Tailwind + shadcn/ui, um SPA só (`src/pages/Hub.tsx` é a tela inicial com o catálogo de apps).
- **Backend**: Node + Express + TypeScript (`server/`), API REST em `/api/*`, mais WebSocket (Socket.io) pra eventos em tempo real (contagens de inventário, disparos, progresso de importação).
- **Bancos de dados**:
  - **SQL Server** — estado próprio do hub (usuários/permissões, sessões de inventário, metas, logs, cache de relatórios).
  - **Firebird (Microsys)** — o ERP em si, **uma base por loja física** (12 hoje: SJC, BH, Santana, RJ, Fast, Campinas, Rio Preto, MG, Fortaleza, Uberlândia, Goiânia, Bosque). Boa parte do hub existe pra consultar/gravar nessas bases sem precisar abrir o Microsys.
  - **MySQL** — sistemas de parceiros/franquias (Porto Alegre, Niterói) que não rodam Microsys.
- **Autenticação**: JWT próprio, com login também integrável a Active Directory (usado no Onboarding). Cada usuário tem um perfil (admin/gestor/vendedor) **por app** — dá pra alguém ser gestor no Painel de Comissões e só visualizar no Inventário, por exemplo.
- **Integrações externas**: Chatwoot (self-hosted `wpp.dovale.online` + nuvem `app.chatwoot.com`) para WhatsApp, Meta Graph API, OpenAI (bot de demandas e análises), Mercado Livre / Shopee / Amazon (ads e estoque FULL), Supabase Storage (mídia de disparo).
- **Jobs agendados** (cron, `server/jobs/`): sincronização multi-preço, cobrança automática, snapshot mensal de fechamento de estoque, checagem de estoque mínimo, monitor de primeira movimentação de produto.
- **Ambientes**: produção (branch `main`) e homologação (branch `homologacao`), ambos no Coolify.
- **Em andamento**: migração incremental do backend pra ASP.NET Core (.NET 10) rodando em paralelo ao Node, ainda não integrada ao fluxo principal.

---

## Os apps, hoje (19 no catálogo)

### Vendas & Relacionamento
| App | O que faz |
|---|---|
| **Painel de Vendas** | Acompanhamento de desempenho de vendedores e metas em tempo real. |
| **Sales Compass** | CRM de carteira de clientes: metas por vendedor, categorização A-D, histórico de contatos. |
| **Prospecção** | Cobertura da base por região — % de clientes já na base e oportunidades por estado/cidade. |
| **Painel de Comissões** | Metas, bônus e comissão por setor/vendedor, consolidando vendas de todas as lojas. |
| **Score de Crédito** | Histórico financeiro do cliente e limite de crédito ajustado por score. |

### Estoque & Compras
| App | O que faz |
|---|---|
| **Inventário** | Contagem de estoque por loja, com sessões, múltiplos locais, aprovação e auditoria. Grava o resultado de volta no Microsys. Acabou de ganhar separação Indústria/Ecommerce por local de estoque em 6 lojas. |
| **Inventário FULL API** | Estoque em programas FULL de marketplace (ML, Shopee, Amazon) — gera inventário a partir disso. |
| **Sugestão de Compras** | Sugestão de reposição por loja com base em histórico de vendas do Microsys. |
| **Estoque Mínimo** | Alerta de produtos da base SJC abaixo do estoque mínimo cadastrado. |
| **Fechamento Estoque** | Fechamento mensal de estoque, vendas e recebimentos por loja. |
| **Multi-Preço** | Sincroniza preço da loja SJC pras demais filiais (Firebird e MySQL). |

### Comunicação & Marketing
| App | O que faz |
|---|---|
| **Disparo em Massa** | Disparo de WhatsApp via Meta API + Chatwoot. |
| **Cobrança Automatizada** | WhatsApp automático pra cliente com boleto vencido ou a vencer. |
| **Primeira Movimentação** | Monitora produto com primeira venda no mês e notifica via Chatwoot. |
| **Relatórios Ecommerce** | KPIs de venda online, com envio diário/mensal simulado via WhatsApp. |
| **Relatório de Custos** | Custo de template de WhatsApp por setor, filtrado por mês (USD/BRL). |

### Ecommerce & Operações
| App | O que faz |
|---|---|
| **Calculadora de Marketplace** | Simulação de preço/taxa/margem pra Mercado Livre, Shopee etc. |
| **Notas Fiscais Amazon** | Importa ZIP do Faturador Amazon FBA Classic e concilia NF com pedido. |
| **Onboarding** | Cria usuário no Active Directory automaticamente pra funcionário novo. |
| **Bot de Demandas** | Coleta requisito com IA e gera documento de especificação. |

*(Existe também o app "Palpite" — sorteio de placar por setor — e o "Painel de Comissão" tem uma visão de Gestor dedicada; não aparecem no catálogo principal por serem mais pontuais.)*

---

## Coisas que valem contexto pra conversa de produto

- **O hub cresceu de forma orgânica**: cada app começou como uma dor pontual de um setor (compras, cobrança, comissão...) e foi entrando no mesmo painel. Isso é força (tudo num lugar só, mesmo login) e também é a principal fonte de inconsistência — nem toda loja se comporta igual em todo app (ex.: nem toda loja Firebird tem local de estoque "Ecommerce"; os que têm, numeram esse local de forma diferente entre si).
- **12 lojas físicas + 2 sistemas de parceiro** são a "matriz" que se repete: quase todo relatório/sincronização existe multiplicado por essa lista, e adicionar/mudar uma loja é trabalho manual em vários arquivos.
- **Boa parte da lógica de negócio mora em consultas diretas ao Microsys** (Firebird), não em regras do hub — o hub principalmente lê/escreve no ERP com uma camada de UI e automação por cima.
- **WhatsApp é canal central**: cobrança, disparo em massa, aprovação de inventário e alertas de estoque passam por Chatwoot/Meta. Qualquer mudança nesse canal (token, inbox, limite de API) afeta vários apps ao mesmo tempo.
- **Existem partes do sistema com nomenclatura legada** (ex. "l2"/"l3" = Santana/RJ) que só quem já mexeu no código conhece — é uma fonte comum de confusão ao debugar ou explicar pra alguém novo.

## Ideias / perguntas em aberto pra explorar com o Product Owner

Estas não são decisões tomadas — são ganchos pra conversa, baseados no que apareceu enquanto o hub era mexido:

1. **Padronizar a config por loja.** Hoje cada app mantém sua própria lista de lojas/filiais/labels (vimos isso se repetir em pelo menos 5 arquivos diferentes). Uma fonte única de "cadastro de lojas" evitaria bugs como filial errada gravada num app novo.
2. **Visibilidade de custo operacional por canal.** Já existe Relatório de Custos (WhatsApp) e Relatórios Ecommerce — dá pra pensar num painel único de "quanto custa vender por canal" (ads + WhatsApp + frete FULL).
3. **Alertas proativos vs. painéis passivos.** Hoje tem uma mistura de apps que a pessoa precisa abrir pra ver (painéis) e apps que avisam sozinhos (estoque mínimo, primeira movimentação, cobrança). Vale mapear quais outros processos merecem virar alerta em vez de depender de alguém lembrar de olhar.
4. **Papel único vs. papel por app.** O modelo de permissão já é por app — dá pra aproveitar isso pra desenhar trilhas de acesso por cargo (ex: "gestor de loja" ganha automaticamente gestor em Inventário + Sugestão de Compras + Comissão daquela loja).
5. **O que migra pro backend .NET primeiro?** A migração está em andamento; priorizar por criticidade/erro atual pode valer mais que seguir ordem alfabética dos módulos.

---

## Rodando localmente

```bash
npm install
npm run dev:all   # sobe frontend (vite, :8080) e backend (tsx watch, :3001) juntos
```

Precisa de um `.env` com as credenciais de Firebird (por loja), SQL Server, MySQL de parceiros e as chaves de integração externa (Chatwoot, Meta, OpenAI, marketplaces).
