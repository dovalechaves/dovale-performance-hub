import swaggerUi from "swagger-ui-express";
import type { Express } from "express";

const spec: object = {
  openapi: "3.0.3",
  info: {
    title: "Dovale Performance Hub — API",
    version: "1.0.0",
    description:
      "Documentação completa da API do Dovale Performance Hub, organizada por aplicação.",
    contact: { name: "TI Dovale" },
  },
  servers: [
    { url: "/api", description: "Backend local / produção" },
  ],
  tags: [
    { name: "Health", description: "Status do servidor" },
    { name: "Auth", description: "Autenticação e gerenciamento de usuários do Hub" },
    { name: "Dashboard — Vendas", description: "Vendas do dia (Firebird)" },
    { name: "Dashboard — Metas", description: "Metas de vendedores (SQL Server)" },
    { name: "Dashboard — Sync", description: "Sincronização Firebird → SQL Server" },
    { name: "Dashboard — Representantes", description: "Listagem de vendedores ativos" },
    { name: "Calculadora — Ecommerce", description: "Produtos, simulação ML e custo operacional" },
    { name: "Disparo em Massa", description: "WhatsApp bulk messaging via Meta + Chatwoot" },
    { name: "Fechamento Estoque", description: "Snapshot mensal de estoque, vendas e recebimentos" },
    { name: "AI Assistant", description: "Chatbot de coleta de requisitos e geração de PRD" },
    { name: "Multi-Preço", description: "Sincronização de preços SJC → filiais (Firebird + MySQL)" },
  ],

  paths: {
    // ══════════════════════════════════════════════════════════════════════════
    //  HEALTH
    // ══════════════════════════════════════════════════════════════════════════
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          200: {
            description: "Servidor operacional",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
          },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  AUTH
    // ══════════════════════════════════════════════════════════════════════════
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login (AD ou teste local)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["usuario", "senha"],
                properties: {
                  usuario: { type: "string", example: "kevin.silva" },
                  senha: { type: "string", example: "****" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Login bem-sucedido", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
          400: { description: "Dados ausentes" },
          401: { description: "Credenciais inválidas" },
          403: { description: "Acesso ao Hub não liberado" },
        },
      },
    },
    "/auth/users": {
      get: {
        tags: ["Auth"],
        summary: "Listar usuários (admin)",
        parameters: [
          { name: "actor_usuario", in: "query", required: true, schema: { type: "string" }, description: "Usuário admin que solicita" },
        ],
        responses: {
          200: { description: "Lista de usuários com permissões", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ManagedUser" } } } } },
          403: { description: "Apenas admins" },
        },
      },
    },
    "/auth/role": {
      put: {
        tags: ["Auth"],
        summary: "Atualizar acesso e roles de um usuário (admin)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["usuario", "actor_usuario"],
                properties: {
                  actor_usuario: { type: "string" },
                  usuario: { type: "string" },
                  can_access_hub: { type: "boolean" },
                  role: { type: "string", enum: ["admin", "manager", "viewer"] },
                  loja: { type: "string", nullable: true },
                  can_access_dashboard: { type: "boolean" },
                  apps: { $ref: "#/components/schemas/AppsPayload" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Atualizado" },
          403: { description: "Apenas admins" },
        },
      },
    },
    "/auth/seed": {
      post: {
        tags: ["Auth"],
        summary: "Criar usuários de teste (dev only)",
        responses: { 200: { description: "Usuários criados" } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  DASHBOARD — VENDAS
    // ══════════════════════════════════════════════════════════════════════════
    "/vendas": {
      get: {
        tags: ["Dashboard — Vendas"],
        summary: "Vendas do dia por vendedor (Firebird)",
        parameters: [
          { name: "loja", in: "query", schema: { type: "string", enum: ["bh", "l2", "l3"], default: "bh" } },
        ],
        responses: {
          200: { description: "Lista de vendas", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/VendaDia" } } } } },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  DASHBOARD — METAS
    // ══════════════════════════════════════════════════════════════════════════
    "/metas": {
      get: {
        tags: ["Dashboard — Metas"],
        summary: "Listar metas de vendedores",
        parameters: [
          { name: "loja", in: "query", schema: { type: "string", default: "bh" } },
          { name: "mes", in: "query", schema: { type: "integer" } },
          { name: "ano", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Lista de metas", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Meta" } } } } },
        },
      },
      post: {
        tags: ["Dashboard — Metas"],
        summary: "Criar ou atualizar meta",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rep_codigo", "loja", "meta_valor", "mes", "ano"],
                properties: {
                  rep_codigo: { type: "string" },
                  rep_nome: { type: "string" },
                  loja: { type: "string" },
                  meta_valor: { type: "number" },
                  dias_uteis: { type: "integer", nullable: true },
                  mes: { type: "integer" },
                  ano: { type: "integer" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Meta salva" } },
      },
    },
    "/metas/dias-uteis": {
      patch: {
        tags: ["Dashboard — Metas"],
        summary: "Atualizar dias úteis de todos vendedores de um mês/loja",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["loja", "mes", "ano", "dias_uteis"],
                properties: {
                  loja: { type: "string" },
                  mes: { type: "integer" },
                  ano: { type: "integer" },
                  dias_uteis: { type: "integer" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Atualizado" } },
      },
    },
    "/metas/{id}": {
      delete: {
        tags: ["Dashboard — Metas"],
        summary: "Excluir meta por ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Excluída" } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  DASHBOARD — SYNC
    // ══════════════════════════════════════════════════════════════════════════
    "/sync": {
      post: {
        tags: ["Dashboard — Sync"],
        summary: "Sincronizar vendas Firebird → SQL Server",
        parameters: [{ name: "loja", in: "query", schema: { type: "string", default: "bh" } }],
        responses: {
          200: { description: "Resultado da sincronização", content: { "application/json": { schema: { type: "object", properties: { sincronizados: { type: "integer" }, loja: { type: "string" } } } } } },
        },
      },
    },
    "/sync/vendas": {
      get: {
        tags: ["Dashboard — Sync"],
        summary: "Vendas do mês direto do Firebird (sem cache)",
        parameters: [
          { name: "loja", in: "query", schema: { type: "string", default: "bh" } },
          { name: "mes", in: "query", schema: { type: "integer" } },
          { name: "ano", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Vendas agrupadas por vendedor", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/VendaSync" } } } } },
        },
      },
    },
    "/sync/vendas-hoje": {
      get: {
        tags: ["Dashboard — Sync"],
        summary: "Vendas de hoje direto do Firebird",
        parameters: [{ name: "loja", in: "query", schema: { type: "string", default: "bh" } }],
        responses: {
          200: { description: "Vendas do dia", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/VendaSync" } } } } },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  DASHBOARD — REPRESENTANTES
    // ══════════════════════════════════════════════════════════════════════════
    "/representantes": {
      get: {
        tags: ["Dashboard — Representantes"],
        summary: "Listar vendedores ativos (Firebird)",
        parameters: [{ name: "loja", in: "query", schema: { type: "string", default: "bh" } }],
        responses: {
          200: {
            description: "Lista de representantes",
            content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { rep_codigo: { type: "string" }, rep_nome: { type: "string" } } } } } },
          },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  CALCULADORA — ECOMMERCE
    // ══════════════════════════════════════════════════════════════════════════
    "/ecommerce/produto/{codigo}": {
      get: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Buscar produto por código",
        parameters: [{ name: "codigo", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Produto encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Produto" } } } },
          404: { description: "Produto não encontrado" },
        },
      },
    },
    "/ecommerce/produtos": {
      get: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Listar todos os produtos (custo + preço + peso)",
        responses: {
          200: { description: "Lista de produtos", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ProdutoCompleto" } } } } },
        },
      },
    },
    "/ecommerce/custo-operacional": {
      get: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Custo operacional rateado por produto (cache 30min)",
        parameters: [
          { name: "valor_participacao", in: "query", schema: { type: "number", default: 2000000 }, description: "Valor base para rateio" },
        ],
        responses: {
          200: {
            description: "Mapa código → custo operacional",
            content: { "application/json": { schema: { type: "object", additionalProperties: { $ref: "#/components/schemas/CustoOperacional" } } } },
          },
        },
      },
    },
    "/ecommerce/token-salvo": {
      get: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Obter token Mercado Livre salvo no banco",
        responses: {
          200: { description: "Token", content: { "application/json": { schema: { type: "object", properties: { token: { type: "string" } } } } } },
          404: { description: "Token não encontrado" },
        },
      },
    },
    "/ecommerce/auth/token": {
      post: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Validar token Mercado Livre",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { access_token: { type: "string" } } } } },
        },
        responses: {
          200: { description: "Token válido" },
          401: { description: "Token inválido" },
        },
      },
    },
    "/ecommerce/my-items": {
      get: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Listar anúncios ativos do vendedor no ML",
        parameters: [
          { name: "seller_id", in: "query", required: true, schema: { type: "string" } },
        ],
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: "Lista de anúncios" },
        },
      },
    },
    "/ecommerce/simulate": {
      post: {
        tags: ["Calculadora — Ecommerce"],
        summary: "Simular venda no Mercado Livre (taxas, frete, lucro)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SimulateRequest" },
            },
          },
        },
        responses: {
          200: { description: "Resultado da simulação", content: { "application/json": { schema: { $ref: "#/components/schemas/SimulateResponse" } } } },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  DISPARO EM MASSA
    // ══════════════════════════════════════════════════════════════════════════
    "/disparo/auth/login": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Login no módulo Disparo (AD)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["usuario", "senha"], properties: { usuario: { type: "string" }, senha: { type: "string" } } } } },
        },
        responses: { 200: { description: "Token JWT" }, 401: { description: "Inválido" } },
      },
    },
    "/disparo/auth/hub-exchange": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Token exchange do Hub (sem login duplo)",
        requestBody: {
          content: { "application/json": { schema: { type: "object", required: ["usuario"], properties: { usuario: { type: "string" }, displayName: { type: "string" } } } } },
        },
        responses: { 200: { description: "Token JWT" } },
      },
    },
    "/disparo/upload": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Upload de contatos (CSV/Excel)",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: { 201: { description: "Contatos importados" } },
      },
    },
    "/disparo/templates": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Listar templates aprovados da Meta",
        responses: { 200: { description: "Lista de templates" } },
      },
      post: {
        tags: ["Disparo em Massa"],
        summary: "Criar novo template na Meta",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 201: { description: "Template enviado para aprovação" } },
      },
    },
    "/disparo/templates/gerenciar": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Listar todos os templates (inclui pendentes/rejeitados)",
        responses: { 200: { description: "Lista completa" } },
      },
    },
    "/disparo/templates/detalhe": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Detalhes de um template específico",
        parameters: [
          { name: "name", in: "query", required: true, schema: { type: "string" } },
          { name: "language_code", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Detalhes do template" } },
      },
    },
    "/disparo/chatwoot/etiquetas": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Listar etiquetas do Chatwoot",
        responses: { 200: { description: "Etiquetas" } },
      },
    },
    "/disparo/chatwoot/times": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Listar times do Chatwoot",
        responses: { 200: { description: "Times" } },
      },
    },
    "/disparo/template-etiquetas": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Mapa template → etiqueta (Supabase)",
        responses: { 200: { description: "Mapa" } },
      },
      post: {
        tags: ["Disparo em Massa"],
        summary: "Salvar mapa template → etiqueta",
        requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: { type: "string" } } } } },
        responses: { 200: { description: "Salvo" } },
      },
    },
    "/disparo/upload-midia": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Upload de mídia (imagem/vídeo/documento)",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
        },
        responses: { 201: { description: "Mídia enviada — retorna URL" } },
      },
    },
    "/disparo/media/{filename}": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Servir arquivo de mídia",
        parameters: [{ name: "filename", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Arquivo" }, 404: { description: "Não encontrado" } },
      },
    },
    "/disparo/disparar": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Iniciar disparo em massa",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["lista_id", "template_nome"],
                properties: {
                  lista_id: { type: "string" },
                  template_nome: { type: "string" },
                  inbox_id: { type: "integer", default: 1 },
                  configuracao: { type: "object", description: "Configurações de envio (etiqueta, time, etc)" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Disparo iniciado (aguardando aprovação)" } },
      },
    },
    "/disparo/disparos/{id}/logs": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Logs de um disparo",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Disparo + logs detalhados" } },
      },
    },
    "/disparo/disparos/ativo": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Disparos ativos (em processamento, pausados, aguardando aprovação)",
        responses: { 200: { description: "Lista de disparos ativos" } },
      },
    },
    "/disparo/disparos/{id}/aprovacao": {
      get: {
        tags: ["Disparo em Massa"],
        summary: "Verificar status de aprovação de um disparo",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Status de aprovação" } },
      },
    },
    "/disparo/disparos/{id}/aprovar": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Aprovar disparo manualmente",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Disparo aprovado e iniciado" } },
      },
    },
    "/disparo/disparos/{id}/cancelar": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Cancelar disparo (admin — aceita AWAITING_APPROVAL, PAUSING e PAUSED)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Cancelado" },
          400: { description: "Status não permite cancelamento" },
          404: { description: "Disparo não encontrado" },
        },
      },
    },
    "/disparo/disparos/{id}/pausar": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Pausar disparo em andamento",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Pausa solicitada" } },
      },
    },
    "/disparo/disparos/{id}/retomar": {
      post: {
        tags: ["Disparo em Massa"],
        summary: "Retomar disparo pausado",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Retomado" } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  FECHAMENTO ESTOQUE
    // ══════════════════════════════════════════════════════════════════════════
    "/stock-snapshot/status": {
      get: {
        tags: ["Fechamento Estoque"],
        summary: "Status da última execução do job (persistido no banco)",
        responses: {
          200: { description: "Status", content: { "application/json": { schema: { $ref: "#/components/schemas/SnapshotStatus" } } } },
        },
      },
    },
    "/stock-snapshot/run": {
      post: {
        tags: ["Fechamento Estoque"],
        summary: "Executar snapshot manualmente",
        responses: {
          200: {
            description: "Resultado da execução",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    inserted: { type: "integer" },
                    stores: { type: "integer" },
                    referenceMonth: { type: "integer" },
                    referenceYear: { type: "integer" },
                  },
                },
              },
            },
          },
          500: { description: "Erro na execução" },
        },
      },
    },
    "/stock-snapshot/history": {
      get: {
        tags: ["Fechamento Estoque"],
        summary: "Histórico completo de fechamentos",
        responses: {
          200: {
            description: "Registros de fechamento",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/FechamentoRow" } } } },
          },
        },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  AI ASSISTANT
    // ══════════════════════════════════════════════════════════════════════════
    "/ai-assistant/chat": {
      post: {
        tags: ["AI Assistant"],
        summary: "Enviar mensagem ou iniciar nova conversa",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  conversation_id: { type: "string", nullable: true, description: "Null para iniciar nova conversa" },
                  message: { type: "string" },
                  usuario: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Resposta do assistente com estado da conversa" },
        },
      },
    },
    "/ai-assistant/restart": {
      post: {
        tags: ["AI Assistant"],
        summary: "Reiniciar conversa",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { conversation_id: { type: "string" }, usuario: { type: "string" } } } } },
        },
        responses: { 200: { description: "Nova conversa iniciada" } },
      },
    },
    "/ai-assistant/conversation/{id}": {
      get: {
        tags: ["AI Assistant"],
        summary: "Obter estado de uma conversa",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Estado da conversa" }, 404: { description: "Não encontrada" } },
      },
    },
    "/ai-assistant/export/{id}": {
      get: {
        tags: ["AI Assistant"],
        summary: "Exportar PRD como JSON",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Documento exportado" }, 400: { description: "Conversa incompleta" } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    //  MULTI-PREÇO
    // ══════════════════════════════════════════════════════════════════════════
    "/multi-preco/sync": {
      post: {
        tags: ["Multi-Preço"],
        summary: "Sincronizar preços SJC → filiais (streaming NDJSON)",
        parameters: [
          { name: "usuario", in: "query", schema: { type: "string", default: "Sistema" }, description: "Usuário que iniciou a sync" },
        ],
        responses: {
          200: {
            description: "Stream NDJSON com eventos de progresso (line-delimited JSON)",
            content: {
              "application/x-ndjson": {
                schema: { $ref: "#/components/schemas/MultiPrecoSyncEvent" },
              },
            },
          },
        },
      },
    },
    "/multi-preco/history": {
      get: {
        tags: ["Multi-Preço"],
        summary: "Histórico de auditoria (últimos 500 registros)",
        responses: {
          200: {
            description: "Lista de registros de auditoria",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/MultiPrecoAuditRow" } },
              },
            },
          },
          500: { description: "Erro no banco" },
        },
      },
    },
  },

  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Health: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          usuario: { type: "string" },
          displayname: { type: "string" },
          role: { type: "string", enum: ["admin", "manager", "viewer"] },
          loja: { type: "string", nullable: true },
          can_access_hub: { type: "boolean" },
          can_access_dashboard: { type: "boolean" },
          apps: { $ref: "#/components/schemas/AppsPayload" },
        },
      },
      ManagedUser: {
        type: "object",
        properties: {
          usuario: { type: "string" },
          displayname: { type: "string" },
          department: { type: "string" },
          can_access_hub: { type: "boolean" },
          can_access_dashboard: { type: "boolean" },
          role: { type: "string" },
          loja: { type: "string", nullable: true },
          apps: { $ref: "#/components/schemas/AppsPayload" },
        },
      },
      AppsPayload: {
        type: "object",
        properties: {
          dashboard: { $ref: "#/components/schemas/AppPermission" },
          calculadora: { $ref: "#/components/schemas/AppPermission" },
          disparo: { $ref: "#/components/schemas/AppPermission" },
          fechamento: { $ref: "#/components/schemas/AppPermission" },
          assistente: { $ref: "#/components/schemas/AppPermission" },
          multipreco: { $ref: "#/components/schemas/AppPermission" },
        },
      },
      AppPermission: {
        type: "object",
        properties: {
          app_key: { type: "string" },
          role: { type: "string", enum: ["admin", "manager", "viewer"] },
          loja: { type: "string", nullable: true },
          can_access: { type: "boolean" },
        },
      },
      VendaDia: {
        type: "object",
        properties: {
          id: { type: "string" },
          nome: { type: "string" },
          vendas: { type: "number" },
        },
      },
      Meta: {
        type: "object",
        properties: {
          id: { type: "integer" },
          rep_codigo: { type: "string" },
          rep_nome: { type: "string" },
          loja: { type: "string" },
          meta_valor: { type: "number" },
          dias_uteis: { type: "integer", nullable: true },
          mes: { type: "integer" },
          ano: { type: "integer" },
        },
      },
      VendaSync: {
        type: "object",
        properties: {
          rep_codigo: { type: "string" },
          rep_nome: { type: "string" },
          total_vendas: { type: "number" },
        },
      },
      Produto: {
        type: "object",
        properties: {
          pro_codigo: { type: "integer" },
          resumo: { type: "string" },
          custo: { type: "number" },
          peso: { type: "number" },
        },
      },
      ProdutoCompleto: {
        type: "object",
        properties: {
          pro_codigo: { type: "integer" },
          resumo: { type: "string" },
          custo: { type: "number" },
          preco: { type: "number" },
          peso: { type: "number" },
        },
      },
      CustoOperacional: {
        type: "object",
        properties: {
          perc_participacao: { type: "number", description: "% participação nas vendas" },
          valor_participacao_rateado: { type: "number" },
          qtd_media_mensal: { type: "number" },
          custo_operacional_unit: { type: "number", nullable: true },
        },
      },
      SimulateRequest: {
        type: "object",
        required: ["price"],
        properties: {
          price: { type: "number", description: "Preço de venda" },
          quantity: { type: "integer", default: 1 },
          cost: { type: "number", default: 0, description: "Custo do produto" },
          weight: { type: "integer", default: 500, description: "Peso em gramas" },
          free_shipping: { type: "boolean", default: true },
          listing_type_id: { type: "string", description: "Tipo de anúncio ML" },
          item_id: { type: "string" },
          seller_id: { type: "string" },
          category_id: { type: "string" },
          tax_rate: { type: "number", description: "Imposto em % (default 21)" },
        },
      },
      SimulateResponse: {
        type: "object",
        properties: {
          results: {
            type: "object",
            properties: {
              gross_revenue: { type: "number" },
              ml_fee_percent: { type: "number" },
              ml_fee_amount: { type: "number" },
              shipping_cost: { type: "number" },
              tax_rate_percent: { type: "number" },
              tax_amount: { type: "number" },
              product_cost: { type: "number" },
              net_profit: { type: "number" },
              margin_percent: { type: "number" },
            },
          },
        },
      },
      SnapshotStatus: {
        type: "object",
        properties: {
          lastRunAt: { type: "string", format: "date-time", nullable: true },
          lastRunResult: {
            type: "object",
            nullable: true,
            properties: {
              inserted: { type: "integer" },
              stores: { type: "integer" },
              referenceMonth: { type: "integer" },
              referenceYear: { type: "integer" },
            },
          },
          lastRunError: { type: "string", nullable: true },
        },
      },
      MultiPrecoSyncEvent: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["info", "success", "error", "pending", "clear", "saving_log", "saving_progress", "saved_log", "complete"], description: "Tipo do evento" },
          message: { type: "string" },
          storeName: { type: "string", description: "Nome da loja afetada" },
          productCode: { type: "string" },
          newPrice: { type: "number" },
          tableName: { type: "string", enum: ["ATACADO", "DDF"] },
        },
      },
      MultiPrecoAuditRow: {
        type: "object",
        properties: {
          ID: { type: "integer" },
          CODIGO_PRODUTO: { type: "string" },
          LOJA: { type: "string" },
          DATA: { type: "string" },
          PRECO: { type: "number" },
          USUARIO: { type: "string" },
          STATUS: { type: "string", enum: ["SUCESSO", "ERRO"] },
          TABELA: { type: "string", enum: ["ATACADO", "DDF"] },
        },
      },
      FechamentoRow: {
        type: "object",
        properties: {
          EMP: { type: "string", description: "Nome da loja" },
          VALORESTOQUE: { type: "number", nullable: true },
          VENDASRECEBIDAS: { type: "number", nullable: true },
          VENDASLOJASINDUSTRIA: { type: "number", nullable: true },
          CAR: { type: "number", nullable: true },
          LUCROBRUTO: { type: "number", nullable: true },
          LUCROREAL: { type: "number", nullable: true },
          LUCROREALINDUSTRIA: { type: "number", nullable: true },
          LUCROFINAL: { type: "number", nullable: true },
          DESPESAS: { type: "number", nullable: true },
          CAP: { type: "number", nullable: true },
          MESREFERENCIA: { type: "integer" },
          ANOREFERENCIA: { type: "integer" },
        },
      },
    },
  },
};

export function setupSwagger(app: Express): void {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Dovale Hub — API Docs",
  }));

  app.get("/api/docs.json", (_req, res) => {
    res.json(spec);
  });
}
