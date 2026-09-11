import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readInventoryRows } from "../../scripts/import-inventory.js";

/**
 * PROVA (spec estoque-manual.md §6): a leitura da planilha filtra certo
 * ("Estoque atual" > 0), usa a coluna "Descreva o Produto" como nome, aguenta
 * as peculiaridades reais do arquivo do Lucas (linhas em branco antes do
 * cabeçalho, linhas sem "Código"), e falha alto — não silenciosamente —
 * quando a estrutura esperada não bate.
 *
 * Usa um arquivo .xlsx pequeno gerado no próprio teste (não o arquivo real do
 * Lucas, que é responsabilidade do sênior rodar depois da revisão).
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "import-inventory-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Monta um .xlsx com a mesma forma da planilha real (linhas em branco antes do cabeçalho). */
function writeSampleWorkbook(
  fileName: string,
  sheetName: string,
  rows: (string | number | null)[][],
): string {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const filePath = path.join(tmpDir, fileName);
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

const HEADER = [
  "Código",
  "Descreva o Produto",
  "Tipo Unitário",
  "Fornecedor",
  "Estoque Mínimo",
  "Estoque Inicial",
  "Estoque atual",
];

describe("readInventoryRows", () => {
  it("filtra só as linhas com Estoque atual > 0, usando 'Descreva o Produto' como nome", () => {
    const filePath = writeSampleWorkbook("basico.xlsx", "EstoqueAtual-e-Cadastro", [
      [null, null, null, null, null, null, null], // linhas em branco antes do
      [null, null, null, null, null, null, null], // cabeçalho, como na planilha real
      HEADER,
      [1, "Vestido Adriana marrom P", "Peça", "Amiska", null, 2, 0],
      [2, "Vestido Adriana marrom G", "Peça", "Amiska", null, 1, 3],
      [3, "Calça cenoura amarela P", "Peça", "Amiska", null, 1, 5],
    ]);

    const rows = readInventoryRows(filePath);

    expect(rows).toEqual([
      { name: "Vestido Adriana marrom G", stock: 3 },
      { name: "Calça cenoura amarela P", stock: 5 },
    ]);
  });

  it("inclui linhas com Estoque atual > 0 mesmo sem 'Código' preenchido", () => {
    const filePath = writeSampleWorkbook("sem-codigo.xlsx", "EstoqueAtual-e-Cadastro", [
      HEADER,
      [null, "Camisa branca tricoline P", "Peça", "Loja Vautier", "", 1, 1],
    ]);

    const rows = readInventoryRows(filePath);

    expect(rows).toEqual([{ name: "Camisa branca tricoline P", stock: 1 }]);
  });

  it("ignora linhas com Estoque atual nulo ou negativo", () => {
    const filePath = writeSampleWorkbook("negativo.xlsx", "EstoqueAtual-e-Cadastro", [
      HEADER,
      [1, "Item Zerado", "Peça", "X", null, 1, 0],
      [2, "Item Nulo", "Peça", "X", null, 1, null],
      [3, "Item Negativo", "Peça", "X", null, 1, -2],
    ]);

    const rows = readInventoryRows(filePath);

    expect(rows).toEqual([]);
  });

  it("falha com mensagem clara quando a aba não existe", () => {
    const filePath = writeSampleWorkbook("aba-errada.xlsx", "OutraAba", [
      HEADER,
      [1, "Item", "Peça", "X", null, 1, 5],
    ]);

    expect(() => readInventoryRows(filePath)).toThrow(/EstoqueAtual-e-Cadastro/);
  });

  it("falha com mensagem clara quando a coluna 'Estoque atual' não existe", () => {
    const filePath = writeSampleWorkbook(
      "sem-coluna.xlsx",
      "EstoqueAtual-e-Cadastro",
      [["Código", "Descreva o Produto"], [1, "Item"]],
    );

    expect(() => readInventoryRows(filePath)).toThrow(/Estoque atual/);
  });
});
