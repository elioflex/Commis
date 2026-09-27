import assert from "node:assert/strict";
import test from "node:test";

import { autoPrice, effectiveRate, priceSource, setFeedEnabled, setServerPrice } from "../src/market.js";
import {
    buildReference,
    gameFromTitle,
    kamasVariationTargets,
    matchServer,
    parseKamasv,
    runPriceFeed,
} from "../src/price-feed.js";
import { read, update } from "../src/store.js";

const eur = (cents) => ({ price: String(cents), currency_code: "EUR", currency_minor_unit: 2 });

// Shapes copied from the WooCommerce Store API responses of both shops.
const KAMASV_CATEGORIES = [
    { id: 1, name: "DOFUS", parent: 0 },
    { id: 2, name: "DOFUS TOUCH", parent: 0 },
    { id: 3, name: "DOFUS RETRO SAISONNIERS", parent: 0 },
    { id: 10, name: "Draconiros", parent: 1 },
    { id: 11, name: "Ombre &#8211; Shadow", parent: 1 },
    { id: 20, name: "Kelerog", parent: 2 },
    { id: 30, name: "Draconiros", parent: 3 },
];
const KAMASV_PRODUCTS = [
    { name: "10M Kamas Draconiros", categories: [{ id: 10 }], prices: eur(770), is_in_stock: true },
    { name: "50M Kamas Draconiros", categories: [{ id: 10 }], prices: eur(3850), is_in_stock: true },
    { name: "100M Kamas Draconiros", categories: [{ id: 10 }], prices: eur(9900), is_in_stock: false },
    { name: "10M Kamas Ombre", categories: [{ id: 11 }], prices: eur(640), is_in_stock: true },
    { name: "1M Kamas Kelerog", categories: [{ id: 20 }], prices: eur(332), is_in_stock: true },
    { name: "10M Kamas Draconiros saison", categories: [{ id: 30 }], prices: eur(100), is_in_stock: true },
    { name: "Pack Dofus", categories: [{ id: 10 }], prices: eur(5000), is_in_stock: true },
];
const ONEKAMAS_PRODUCTS = [
    { id: 70, name: "Kamas Dofus", type: "variable", variations: [
        { id: 71, attributes: [{ value: "Draconiros" }] },
        { id: 72, attributes: [{ value: "Tal kasha" }] },
        { id: 73, attributes: [{ value: "Serveur inconnu" }] },
    ] },
    { id: 80, name: "Kamas Dofus Unity (Dofus 3)", type: "variable", variations: [
        { id: 81, attributes: [{ value: "Draconiros" }] },
    ] },
    { id: 90, name: "Kamas TemporiX Dofus Touch", type: "variable", variations: [
        { id: 91, attributes: [{ value: "Kelerog" }] },
    ] },
];
const ONEKAMAS_VARIATIONS = {
    71: { prices: eur(80), is_in_stock: true },
    72: { prices: eur(44), is_in_stock: false },
};

/** Run `fn` with market.json's feed and server prices restored afterwards. */
async function withMarket(fn) {
    const saved = structuredClone(read("market.json"));
    try {
        return await fn();
    } finally {
        update("market.json", (data) => {
            for (const key of Object.keys(data)) delete data[key];
            Object.assign(data, saved);
            return true;
        });
    }
}

test("server matching stays inside the same game and skips seasonal servers", () => {
    assert.equal(gameFromTitle("DOFUS UNITY (DOFUS 3.0)"), "dofus");
    assert.equal(gameFromTitle("Kamas Dofus Touch"), "touch");
    assert.equal(gameFromTitle("Kamas Dofus Retro Temporis"), null);
    assert.equal(gameFromTitle("DOFUS RETRO SAISONNIERS"), null);
    assert.equal(matchServer("dofus", "Ombre &#8211; Shadow"), "ombre");
    assert.equal(matchServer("dofus", "Tal kasha"), "talkasha");
    assert.equal(matchServer("touch", "Kelerog"), "kelerog");
    assert.equal(matchServer("dofus", "Kelerog"), null);
    assert.equal(matchServer("retro", "Boune 2"), null);
});

test("kamasv: per-million median over in-stock lots of each server", () => {
    assert.deepEqual(parseKamasv(KAMASV_PRODUCTS, KAMASV_CATEGORIES), { drac: 0.77, ombre: 0.64, kelerog: 3.32 });
});

test("1kamas: one variation per matched server, first product wins", () => {
    assert.deepEqual(kamasVariationTargets(ONEKAMAS_PRODUCTS), [
        { id: 71, code: "drac" },
        { id: 72, code: "talkasha" },
    ]);
});

test("reference is the median of shops and big jumps wait for confirmation", () => {
    const first = buildReference({ kamasv: { drac: 0.77 }, "1kamas": { drac: 0.81 } });
    assert.equal(first.reference.drac.eur, 0.79);
    assert.deepEqual(first.held, []);

    // ×3 on one fetch → held, previous price kept.
    const spike = buildReference({ kamasv: { drac: 2.4 } }, first.reference, first.pending);
    assert.equal(spike.reference.drac.eur, 0.79);
    assert.deepEqual(spike.held, ["drac"]);

    // Confirmed on the next fetch → accepted.
    const confirmed = buildReference({ kamasv: { drac: 2.45 } }, spike.reference, spike.pending);
    assert.equal(confirmed.reference.drac.eur, 2.45);

    // A server that disappears keeps its last price.
    const missing = buildReference({ kamasv: { ombre: 0.6 } }, confirmed.reference);
    assert.equal(missing.reference.drac.eur, 2.45);
});

test("runPriceFeed stores the reference and prices follow manual > web > base", async () => {
    await withMarket(async () => {
        const fetchJson = async (url) => {
            if (url.includes("kamasv.com") && url.includes("/categories")) return { data: KAMASV_CATEGORIES, totalPages: 1 };
            if (url.includes("kamasv.com")) return { data: KAMASV_PRODUCTS, totalPages: 1 };
            const variation = url.match(/products\/(\d+)$/);
            if (variation) return { data: ONEKAMAS_VARIATIONS[variation[1]] ?? {}, totalPages: 1 };
            return { data: ONEKAMAS_PRODUCTS, totalPages: 1 };
        };

        update("market.json", (data) => {
            delete data.feed;
            delete data.serverPrices;
            return true;
        });

        const result = await runPriceFeed({ fetchJson });
        assert.equal(result.ok, true);
        assert.deepEqual(result.errors, []);

        const feed = read("market.json").feed;
        assert.equal(feed.reference.drac.eur, 0.785);
        assert.deepEqual(feed.reference.drac.sources, { kamasv: 0.77, "1kamas": 0.8 });
        assert.equal(feed.reference.talkasha, undefined, "out-of-stock variation ignored");

        // Web price × factor (buy 100 %, sell 70 %).
        assert.equal(priceSource("drac", "buy"), "auto");
        assert.equal(autoPrice("drac", "buy"), 0.79);
        assert.equal(effectiveRate("EUR", "sell", "drac"), 0.55);

        // Manual wins, clearing it gives the web price back.
        setServerPrice("drac", "buy", 1.5);
        assert.equal(effectiveRate("EUR", "buy", "drac"), 1.5);
        setServerPrice("drac", "buy", 0);
        assert.equal(effectiveRate("EUR", "buy", "drac"), 0.79);

        // Paused feed → base rate × multiplier.
        setFeedEnabled(false);
        assert.equal(priceSource("drac", "buy"), "base");
        assert.notEqual(effectiveRate("EUR", "buy", "drac"), 0.79);
    });
});

test("runPriceFeed keeps the last prices when every shop fails", async () => {
    await withMarket(async () => {
        update("market.json", (data) => {
            data.feed = { reference: { drac: { eur: 0.7, sources: { kamasv: 0.7 } } } };
            return true;
        });
        const result = await runPriceFeed({
            fetchJson: async () => {
                throw new Error("HTTP 503");
            },
        });
        assert.equal(result.ok, false);
        const feed = read("market.json").feed;
        assert.equal(feed.reference.drac.eur, 0.7);
        assert.match(feed.lastError, /HTTP 503/);
    });
});
