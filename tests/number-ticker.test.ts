import assert from "node:assert/strict";
import test from "node:test";
import { tickerCharacters, reconcileTicker } from "../lib/number-ticker";

const integer = new Intl.NumberFormat("en");
const money = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const characters = (value: number, formatter = integer) => tickerCharacters(formatter.formatToParts(value));
const visible = (items: ReturnType<typeof characters>) => items.filter(item => item.active).map(item => item.character).join("");

test("tokens to cost retains place values and keeps departing columns for their exit", () => {
  const before = characters(504123456);
  const cost = characters(4.125, money);
  const transition = reconcileTicker(before, cost);
  assert.equal(visible(transition), "$4.125");
  assert.ok(transition.some(item => !item.active));
  assert.equal(transition.find(item => item.key === "integer-0")?.character, "4");
  assert.equal(new Set(transition.map(item => item.key)).size, transition.length);
  assert.deepEqual(transition.filter(item => item.active), cost);
});

test("rapid shrink/grow reversals revive existing columns without duplicates", () => {
  let state = characters(999999999);
  for (const next of [characters(0, money), characters(123456789), characters(0.125, money), characters(7), characters(123456789)]) {
    state = reconcileTicker(state, next);
    assert.equal(visible(state), visible(next));
    assert.equal(new Set(state.map(item => item.key)).size, state.length);
    assert.ok(state.length <= 18);
  }
  assert.equal(state.find(item => item.key === "integer-8")?.active, true);
});

test("grouping, fractions and negative currency have independent stable columns", () => {
  for (const value of [-1234567.125, -0.01, 0, 999.9999]) {
    const parts = characters(value, money);
    assert.equal(visible(parts), money.format(value));
    assert.equal(new Set(parts.map(item => item.key)).size, parts.length);
  }
  const units = (value: number) => characters(value, money).find(item => item.key === "integer-0");
  assert.equal(units(1000.12)?.character, "0");
  assert.equal(units(7.12)?.character, "7");
  assert.equal(characters(7.12, money).find(item => item.key === "fraction-0")?.character, "1");
});

test("reduced motion drops old columns immediately and settled columns can be cleaned", () => {
  const before = characters(123456789);
  const next = characters(0, money);
  assert.deepEqual(reconcileTicker(before, next, true), next);
  const settled = reconcileTicker(before, next).filter(item => item.active);
  assert.deepEqual(settled, next);
  assert.deepEqual(reconcileTicker(settled, next), next);
});
