/**
 * Relatório: clientes inativos nas cidades da planilha "Cidades Sorocaba x Campinas.xlsx"
 * — SJC e MG tratadas como uma base só (unificadas por cli_codigo).
 *
 * Testei unificar por CPF/CNPJ (cli_cnpj) primeiro, mas o cadastro de cliente é
 * replicado entre as duas bases usando o MESMO cli_codigo: comparei os cli_codigo que
 * existem nas duas bases (55.085 casos) e 94,8% tem o CNPJ idêntico nos dois lados; o
 * resto (539 casos, ~1%) é erro de digitação do CNPJ em uma das duas pontas (mesmo
 * cliente, documento com dígito errado num dos dois cadastros) — não são clientes
 * diferentes coincidindo no código. Por isso o código é a chave de unificação mais
 * confiável aqui, não o documento.
 *
 * Um cliente cadastrado nas duas bases (mesmo cli_codigo) só é considerado inativo se
 * estiver inativo NAS DUAS — se ele comprou há menos de 4 meses em qualquer uma das
 * duas, ele conta como ativo e sai do relatório. Cadastro que só existe em uma base
 * fica como registro único (não tem com o que ser fundido).
 *
 * Cidade do cliente vem de clientes.cli_mun_codigo -> municipios.mun_nome (não do campo
 * cli_cidade, que está vazio na maioria dos cadastros). As 114 cidades da planilha batem
 * com 112 códigos de município distintos:
 *   - "Tietê" e "Tíetê" (duas grafias na planilha) apontam pro mesmo município.
 *   - "Embu das Artes" está cadastrado como "Embu" no banco (nome antigo, pré-2006).
 *   - "Moji-Mirim" está cadastrado como "Mogi Mirim".
 *   - "Alphaville" não é município (é bairro de Barueri/Santana de Parnaíba, que já
 *     estão na lista) — não existe código de município separado pra ele.
 *
 * Inativo = sem NENHUM pedido válido (pdv_psi_codigo NOT IN ('CC'), pdv_tve_codigo NOT IN
 * ('6','7','26','34') — padrão de "venda real" do projeto) nos últimos 4 meses a partir de
 * hoje, na base em que o cadastro existe. Entra tanto quem nunca comprou quanto quem
 * comprou há mais de 4 meses.
 *
 * Rodar: npx tsx scripts/relatorio-clientes-inativos-cidades-sorocaba-campinas.ts
 */

import "dotenv/config";
import path from "path";
import os from "os";
import XLSX from "xlsx";
import { queryFirebird } from "../server/db/firebird";

const BASES = [
  { lojaKey: "sjc" as const, nome: "SJC" },
  { lojaKey: "mg" as const, nome: "MG" },
];

const MESES_INATIVIDADE = 4;

// Códigos de município (mun_codigo, UF=SP) das cidades da planilha "Cidades Sorocaba x Campinas.xlsx"
const MUNICIPIOS_CIDADES = [
  3500501, 3500600, 3500758, 3501152, 3501608, 3501905, 3502754, 3502903, 3503307, 3503802,
  3504107, 3505708, 3507001, 3507100, 3507605, 3508405, 3509007, 3509205, 3510302, 3510401,
  3510609, 3511508, 3511607, 3512209, 3512308, 3512407, 3512803, 3513009, 3514908, 3515004,
  3515152, 3515186, 3516309, 3518800, 3519055, 3519071, 3519709, 3520509, 3521002, 3522208,
  3522307, 3522505, 3522604, 3523909, 3524006, 3524709, 3525003, 3525201, 3525508, 3525854,
  3525904, 3526407, 3526704, 3526902, 3527009, 3527306, 3528403, 3528502, 3530706, 3530805,
  3530904, 3531209, 3531803, 3532009, 3532405, 3533403, 3534401, 3536505, 3536802, 3537107,
  3537503, 3537800, 3537909, 3538204, 3538600, 3538709, 3539103, 3540507, 3540606, 3541653,
  3542107, 3543907, 3544004, 3545159, 3545209, 3545308, 3545803, 3546702, 3547304, 3548005,
  3548104, 3548807, 3550209, 3550407, 3550605, 3551108, 3551603, 3552106, 3552403, 3552809,
  3553500, 3554003, 3554508, 3554656, 3554953, 3556206, 3556354, 3556453, 3556503, 3556701,
  3557006, 3557303,
];

function sqlClientesComFlagAtivo() {
  return `
    SELECT
      c.cli_codigo AS cod_cliente,
      c.cli_nome AS cliente,
      m.mun_nome AS cidade,
      COALESCE(c.cli_whatsapp, c.cli_fone, c.cli_celular, 0) AS cli_whatsapp,
      CASE WHEN EXISTS (
        SELECT 1 FROM pedidos_vendas p
        WHERE p.pdv_cli_codigo = c.cli_codigo
          AND p.pdv_data >= DATEADD(MONTH, -${MESES_INATIVIDADE}, CURRENT_DATE)
          AND p.pdv_psi_codigo NOT IN ('CC')
          AND p.pdv_tve_codigo NOT IN ('6', '7', '26', '34')
      ) THEN 1 ELSE 0 END AS ativo_recente
    FROM clientes c
    INNER JOIN municipios m ON m.mun_codigo = c.cli_mun_codigo
    WHERE c.cli_cliente = '1'
      AND m.mun_uf = 'SP'
      AND c.cli_mun_codigo IN (${MUNICIPIOS_CIDADES.join(",")})
  `;
}

interface ClienteRow {
  COD_CLIENTE: any;
  CLIENTE: any;
  CIDADE: any;
  CLI_WHATSAPP: any;
  ATIVO_RECENTE: any;
}

interface ClienteUnificado {
  codigo: string;
  nome: string;
  cidade: string;
  whatsapp: string;
  ativoRecente: boolean;
}

async function main() {
  console.log("=== Relatório: Clientes inativos (SJC+MG unificados) — sem compra válida há 4+ meses — Cidades Sorocaba x Campinas ===\n");

  const porCodigo = new Map<string, ClienteUnificado>();

  for (const base of BASES) {
    console.log(`Consultando base ${base.nome}...`);
    const rows = await queryFirebird<ClienteRow>(base.lojaKey, sqlClientesComFlagAtivo());
    console.log(`  ${rows.length} clientes na base ${base.nome} (ativos + inativos)`);

    for (const row of rows) {
      const codigo = row.COD_CLIENTE?.toString() || "";
      if (!codigo) continue;
      const nome = row.CLIENTE?.toString().trim() || "";
      const cidade = row.CIDADE?.toString().trim() || "";
      const whatsapp = row.CLI_WHATSAPP === null || row.CLI_WHATSAPP === undefined ? "" : String(row.CLI_WHATSAPP).trim();
      const ativoRecente = Number(row.ATIVO_RECENTE) === 1;

      const atual = porCodigo.get(codigo);
      if (atual) {
        atual.ativoRecente = atual.ativoRecente || ativoRecente;
        if (!atual.whatsapp && whatsapp && whatsapp !== "0") atual.whatsapp = whatsapp;
        if (!atual.nome) atual.nome = nome;
        if (!atual.cidade) atual.cidade = cidade;
      } else {
        porCodigo.set(codigo, { codigo, nome, cidade, whatsapp, ativoRecente });
      }
    }
  }

  const unificados = Array.from(porCodigo.values());
  console.log(`\nTotal de clientes únicos (SJC ∪ MG, unificados por cli_codigo): ${unificados.length}`);

  const inativos = unificados
    .filter((c) => !c.ativoRecente)
    .sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

  console.log(`Total de clientes inativos (inativos nas duas bases onde têm cadastro): ${inativos.length}`);

  const sheetDados = inativos.map((c) => ({
    "Código Cliente": c.codigo,
    "Nome Cliente": c.nome,
    "Cidade": c.cidade,
    "WhatsApp": c.whatsapp || 0,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetDados);
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 25 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, "Clientes Inativos");

  const fileName = `Clientes_Inativos_Sorocaba_Campinas_SJC_MG.xlsx`;
  const outPath = path.join(os.homedir(), "Desktop", fileName);
  XLSX.writeFile(wb, outPath);

  console.log(`\nRelatório salvo em: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao gerar relatório:", err);
    process.exit(1);
  });
