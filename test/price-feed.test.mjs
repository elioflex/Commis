import assert from "node:assert/strict";
import test from "node:test";

import {
    autoPrice,
    competitorEdge,
    effectiveRate,
    eurPrice,
    priceSource,
    resolveServers,
    serverRateFields,
    setFeedEnabled,
    setServerAdjustments,
    setServerPrice,
} from "../src/market.js";
import {
    buildReference,
    gameFromTitle,
    kamasVariationTargets,
    matchServer,
    parseKamasv,
    parseLeskamas,
    runPriceFeed,
} from "../src/price-feed.js";
import { boardEmbed, panelEmbed } from "../src/embeds.js";
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

// leskamas.com « vendre des kamas » table, trimmed.
const LESKAMAS_HTML = `<p>Vendez vos kamas</p><div><table border="1" class="hovertable"><tbody>
<tr><td>Server</td><td>Paypal / Skrill / SEPA</td><td>BitCoin</td><td>Status</td></tr>
<tr style="background: white"><td colspan="7" style="text-align:center">Dofus Kamas</td></tr>
<tr onmouseover="x"><td>Draconiros</td><td>0.52€/M</td><td>0.515€/M</td><td>Incomplet</td></tr>
<tr><td>Ombre(Shadow)</td><td>0.371€/M</td><td>0.367€/M</td><td><font color='red'>Stock complet</font></td></tr>
<tr><td>Salar</td><td>0.30€/M</td><td>0.297€/M</td><td>Incomplet</td></tr>
<tr style="background: white"><td colspan="7" style="text-align:center">Dofus Touch Kamas</td></tr>
<tr><td>Kelerog</td><td>2.28€/M</td><td>2.257€/M</td><td>Incomplet</td></tr>
<tr><td>Temporix-1</td><td>0.1€/M</td><td>0.099€/M</td><td>Incomplet</td></tr>
<tr style="background: white"><td colspan="7" style="text-align:center">Wakfu Kamas</td></tr>
<tr><td>Rubilax</td><td>1.02€/M</td><td>1.010€/M</td><td>Incomplet</td></tr>
</tbody></table></div>`;

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
    // Dofus 3 only: Touch / Retro / Wakfu listings are recognised, then ignored.
    assert.equal(matchServer("touch", "Kelerog"), null);
    assert.equal(matchServer("touch", "Draconiros"), null);
    assert.equal(matchServer("dofus", "Kelerog"), null);
    assert.equal(matchServer("retro", "Boune 2"), null);
});

test("kamasv: per-million median over in-stock lots of each server", () => {
    assert.deepEqual(parseKamasv(KAMASV_PRODUCTS, KAMASV_CATEGORIES), { drac: 0.77, ombre: 0.64 });
});

test("1kamas: one variation per matched server, first product wins", () => {
    assert.deepEqual(kamasVariationTargets(ONEKAMAS_PRODUCTS), [
        { id: 71, code: "drac" },
        { id: 72, code: "talkasha" },
    ]);
});

test("leskamas: payout per game section, seasonal servers skipped", () => {
    assert.deepEqual(parseLeskamas(LESKAMAS_HTML), { drac: 0.52, ombre: 0.371, salar: 0.3 });
    assert.deepEqual(parseLeskamas("<html>maintenance</html>"), {});
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

        const result = await runPriceFeed({ fetchJson, fetchText: async () => LESKAMAS_HTML });
        assert.equal(result.ok, true);
        assert.deepEqual(result.errors, []);

        const feed = read("market.json").feed;
        assert.equal(feed.reference.drac.eur, 0.785);
        assert.deepEqual(feed.reference.drac.sources, { kamasv: 0.77, "1kamas": 0.8 });
        assert.equal(feed.reference.talkasha, undefined, "out-of-stock variation ignored");

        assert.equal(feed.sellReference.drac.eur, 0.52);

        // Buy: 3 % under the cheapest shop (0.77 → 0.7469, rounded down).
        // Sell: 3 % over leskamas's payout (0.52 → 0.5356, rounded up).
        assert.equal(priceSource("drac", "buy"), "auto");
        assert.equal(autoPrice("drac", "buy"), 0.74);
        assert.equal(effectiveRate("EUR", "sell", "drac"), 0.54);
        // No payout source for Talkasha… and no retail either (out of stock) → base.
        assert.equal(priceSource("talkasha", "sell"), "base");
        // Salar: payout only → sell is automatic (0.30 × 103 % → 0.31), buy stays on the base rate.
        assert.equal(autoPrice("salar", "sell"), 0.31);
        assert.equal(priceSource("salar", "buy"), "base");

        // Manual wins, clearing it gives the web price back.
        setServerPrice("drac", "buy", 1.5);
        assert.equal(effectiveRate("EUR", "buy", "drac"), 1.5);
        setServerPrice("drac", "buy", 0);
        assert.equal(effectiveRate("EUR", "buy", "drac"), 0.74);

        // Paused feed → base rate × multiplier.
        setFeedEnabled(false);
        assert.equal(priceSource("drac", "buy"), "base");
        assert.notEqual(effectiveRate("EUR", "buy", "drac"), 0.74);
    });
});

test("runPriceFeed keeps the last prices when every shop fails", async () => {
    await withMarket(async () => {
        update("market.json", (data) => {
            data.feed = { reference: { drac: { eur: 0.7, sources: { kamasv: 0.7 } } } };
            return true;
        });
        const fail = async () => {
            throw new Error("HTTP 503");
        };
        const result = await runPriceFeed({ fetchJson: fail, fetchText: fail });
        assert.equal(result.ok, false);
        const feed = read("market.json").feed;
        assert.equal(feed.reference.drac.eur, 0.7);
        assert.match(feed.lastError, /HTTP 503/);
    });
});

test("sell falls back to 70 % of the retail price when no shop publishes a payout", async () => {
    await withMarket(async () => {
        update("market.json", (data) => {
            delete data.serverPrices;
            data.feed = { reference: { orukam: { eur: 0.45, sources: { kamasv: 0.45 } } } };
            return true;
        });
        // 0.45 × 70 % × 103 % = 0.324 → 0.33 · 0.45 × 97 % = 0.4365 → 0.43
        assert.equal(autoPrice("orukam", "sell"), 0.33);
        assert.equal(autoPrice("orukam", "buy"), 0.43);
    });
});

/** A fresh feed: two shops for Draconiros and Mikhal, leskamas's payouts. */
function seedFeed(fetchedAt = new Date().toISOString()) {
    update("market.json", (data) => {
        delete data.serverPrices;
        delete data.adjustments;
        data.feed = {
            fetchedAt,
            reference: {
                drac: { eur: 0.785, sources: { kamasv: 0.77, "1kamas": 0.8 } },
                mikhal: { eur: 0.67, sources: { kamasv: 0.67 } },
            },
            sellReference: {
                drac: { eur: 0.52, sources: { leskamas: 0.52 } },
                mikhal: { eur: 0.66, sources: { leskamas: 0.66 } },
            },
        };
        return true;
    });
}

test("competitors stay internal: nothing about them on customer displays", async () => {
    await withMarket(async () => {
        seedFeed();
        assert.deepEqual(competitorEdge("drac", "buy"), [
            { site: "1kamas", price: 0.8, gap: 7.5 },
            { site: "kamasv", price: 0.77, gap: 3.9 },
        ]);

        // Customers never see a competitor's name or price.
        for (const kind of ["buy", "sell", "exchange"]) {
            const fields = serverRateFields(kind);
            assert.ok(fields.every((field) => field.value.length <= 1024));
            const text = JSON.stringify(fields);
            assert.ok(!/🏆| vs |1Kamas|KamasV|LesKamas/.test(text), text);
        }
        for (const embed of [panelEmbed("achat"), panelEmbed("vente"), boardEmbed("buy"), boardEmbed("sell")]) {
            assert.ok(!/🏆|1Kamas|KamasV|LesKamas|Moins cher que/.test(JSON.stringify(embed.toJSON())));
        }
    });
});

test("what we pay never eats the margin, unless staff pinned it by hand", async () => {
    await withMarket(async () => {
        seedFeed();
        // Mikhal: buy 0.67 × 97 % = 0.64; paying 0.66 × 103 % = 0.68 would lose money.
        assert.equal(eurPrice("mikhal", "buy").eur, 0.64);
        assert.deepEqual(eurPrice("mikhal", "sell"), { eur: 0.6, manual: false, capped: true });

        setServerPrice("mikhal", "sell", 0.7);
        assert.deepEqual(eurPrice("mikhal", "sell"), { eur: 0.7, manual: true, capped: false });
    });
});

test("manager adjustments: one, several or all servers, per side", async () => {
    await withMarket(async () => {
        seedFeed();
        assert.deepEqual(resolveServers("drac, Ombre (Shadow); mikhal").codes, ["drac", "ombre", "mikhal"]);
        assert.equal(resolveServers("tous").codes.length, 13);
        assert.deepEqual(resolveServers("kelerog").unknown, ["kelerog"], "no Touch servers any more");
        assert.deepEqual(resolveServers("drac, truc").unknown, ["truc"]);

        setServerAdjustments(["drac"], ["buy"], -2);
        assert.equal(autoPrice("drac", "buy"), 0.73); // 0.7469 × 98 % = 0.732
        assert.equal(autoPrice("drac", "sell"), 0.54, "the other side is untouched");

        setServerAdjustments(["drac"], ["buy", "sell"], 2);
        assert.equal(autoPrice("drac", "buy"), 0.76);
        assert.equal(autoPrice("drac", "sell"), 0.55);

        // Adjustments also apply on the base rate when the web has no price.
        const before = effectiveRate("EUR", "buy", "talkasha");
        setServerAdjustments(["talkasha"], ["buy"], 10);
        assert.equal(effectiveRate("EUR", "buy", "talkasha"), Math.round(before * 1.1 * 1000) / 1000);

        assert.equal(setServerAdjustments(["drac", "talkasha"], ["buy", "sell"], 0), 0);
        assert.equal(autoPrice("drac", "buy"), 0.74);
        assert.equal(setServerAdjustments(["drac"], ["buy"], -90), -50, "capped at ±50 %");
    });
});
