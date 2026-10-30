import { ESTOQUE, sortearPremio } from "../../server/routes/cofres";

describe("sortearPremio", () => {
  it("percorre o estoque pelos tickets e respeita o que acabou", () => {
    expect(Object.values(ESTOQUE).reduce((a, b) => a + b, 0)).toBe(200);
    expect(sortearPremio(ESTOQUE, () => 0)).toBe(3);
    expect(sortearPremio(ESTOQUE, () => 75)).toBe(4);
    expect(sortearPremio(ESTOQUE, () => 199)).toBe(15);
    expect(sortearPremio({ 3: 0, 4: 0, 15: 1 }, () => 0)).toBe(15);
  });

  it("falha quando não resta prêmio", () => {
    expect(() => sortearPremio({ 3: 0 })).toThrow("Todos os cofres foram abertos.");
  });
});
