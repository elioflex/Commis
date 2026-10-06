import assert from "node:assert/strict";
import test from "node:test";

import { DOFUS_SERVERS, LAYOUT } from "../config.js";
import {
    ADMIN_CHANNEL,
    adminActivity,
    adminModal,
    adminPayload,
    adminRows,
    parseNumber,
    parseSide,
    parseStockStatus,
    resolveOneServer,
} from "../src/admin-panel.js";
import { createOffer } from "../src/offers.js";
import { read, update } from "../src/store.js";

test("the price-manager channel is part of the structure, manager only", () => {
    const channel = LAYOUT.flatMap((block) => block.channels).find((c) => c.name === ADMIN_CHANNEL);
    assert.ok(channel?.managerOnly);
});

const embedLength = (json) =>
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text?.length ?? 0) +
    (json.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);

/** Every priced server with three competitor prices: the heaviest realistic dashboard. */
function seedFullFeed() {
    const saved = structuredClone(read("market.json"));
    update("market.json", (data) => {
        const reference = {};
        const sellReference = {};
        for (const server of DOFUS_SERVERS.filter((s) => s.game)) {
            reference[server.code] = { eur: 1.234, sources: { kamasv: 1.231, "1kamas": 1.244 } };
            sellReference[server.code] = { eur: 0.987, sources: { leskamas: 0.987 } };
        }
        data.feed = { ...(data.feed ?? {}), fetchedAt: new Date().toISOString(), reference, sellReference };
        data.adjustments = Object.fromEntries(Object.keys(reference).map((code) => [code, { buy: -2.5, sell: 1.5 }]));
        return true;
    });
    return () =>
        update("market.json", (data) => {
            for (const key of Object.keys(data)) delete data[key];
            Object.assign(data, saved);
            return true;
        });
}

test("dashboard stays under Discord's 6000-character limit, with its control buttons", () => {
    const restore = seedFullFeed();
    try {
        const payload = adminPayload("g1", { running: true });
        const total = payload.embeds.reduce((sum, embed) => sum + embedLength(embed.toJSON()), 0);
        assert.ok(total <= 6000, `dashboard is ${total} characters`);
        assert.ok(payload.embeds.every((embed) => (embed.toJSON().fields ?? []).every((f) => f.value.length <= 1024)));
    } finally {
        restore();
    }
    const ids = adminRows().flatMap((row) => row.toJSON().components.map((b) => b.custom_id));
    assert.deepEqual(ids, ["admin:feed", "admin:toggle", "admin:factors", "admin:fee", "admin:adjust", "admin:price", "admin:stock"]);
    for (const kind of ["factors", "fee", "adjust", "price", "stock"]) {
        assert.equal(adminModal(kind).toJSON().custom_id, `admin:modal:${kind}`);
    }
});

test("activity counts pending offers", () => {
    const before = adminActivity("g1").pendingOffers;
    createOffer({ guildId: "g1", userId: "c9", kind: "buy", serverCode: "drac", millions: 10, price: 1, currency: "EUR" });
    assert.equal(adminActivity("g1").pendingOffers, before + 1);
});

test("admin inputs are parsed forgivingly", () => {
    assert.equal(parseNumber("97 %"), 97);
    assert.equal(parseNumber("-2,5"), -2.5);
    assert.equal(parseNumber("abc"), null);
    assert.deepEqual(parseSide("Achat"), ["buy"]);
    assert.deepEqual(parseSide("rachat"), ["sell"]);
    assert.deepEqual(parseSide("les deux"), ["buy", "sell"]);
    assert.equal(parseSide("les deux", { allowBoth: false }), null);
    assert.equal(parseStockStatus("", 500), "open");
    assert.equal(parseStockStatus("", 0), "full");
    assert.equal(parseStockStatus("sur commande", 500), "full");
    assert.equal(parseStockStatus("n'importe", 5), null);
    assert.equal(resolveOneServer("drac"), "drac");
    assert.equal(resolveOneServer("tous"), null);
});
