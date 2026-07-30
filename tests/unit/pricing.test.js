import assert from "node:assert/strict";
import test from "node:test";
import { formatLaunchOfferSavings } from "../../src/lib/pricing.js";

test("launch offer savings uses exact percentage for uniform prices", () => {
  assert.equal(formatLaunchOfferSavings({
    regular_price_kobo: 1000000,
    discounted_price_kobo: 700000,
    has_uniform_regular_price: true,
  }), "Save 30%");
});

test("launch offer savings uses up to percentage for mixed prices", () => {
  assert.equal(formatLaunchOfferSavings({
    regular_price_kobo: 1000000,
    discounted_price_kobo: 700000,
    has_uniform_regular_price: false,
  }), "Save up to 30%");
});

test("launch offer savings falls back when there is no discount", () => {
  assert.equal(formatLaunchOfferSavings({
    regular_price_kobo: 700000,
    discounted_price_kobo: 700000,
    has_uniform_regular_price: true,
  }), "Launch price");
});
