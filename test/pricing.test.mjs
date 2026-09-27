import assert from "node:assert/strict";
import test from "node:test";

import { DOFUS_SERVERS, TICKET_TYPE_IDS } from "../config.js";
import { priceTableModal } from "../src/components.js";
import { boardEmbed, panelEmbed, rateEmbed } from "../src/embeds.js";
import {
    effectiveRate,
    formatPriceTable,
    parsePriceTable,
    rateFor,
    serverPrice,
    serverPriceSummary,
    serverRateFields,
    setServerPrice,
} from "../src/market.js";

/** Discord rejects a message whose embeds exceed these limits. */
function assertEmbedFits(embed, label) {
    const json = embed.toJSON();
    const fields = json.fields ?? [];
    assert.ok(fields.length <= 25, `${label}: ${fields.length} fields`);
    for (const field of fields) {
        assert.ok(field.name.length <= 256, `${label}: field name too long`);
        assert.ok(field.value.length <= 1024, `${label}: field « ${field.name} » is ${field.value.length} chars`);
    }
    const total =
        (json.title?.length ?? 0) +
        (json.description?.length ?? 0) +
        (json.footer?.text?.length ?? 0) +
        fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    assert.ok(total <= 6000, `${label}: ${total} chars total`);
    assert.ok((json.description?.length ?? 0) <= 4096, `${label}: description too long`);
}

test("a fixed server price wins over base × multiplier, in EUR and converted currencies", () => {
    const before = serverPrice("drac", "buy");
    try {
        setServerPrice("drac", "buy", 2);
        assert.equal(effectiveRate("EUR", "buy", "drac"), 2);

        // Other currencies keep the owner's spread from the base-rate table.
        const ratio = rateFor("USD", "buy") / rateFor("EUR", "buy");
        assert.equal(effectiveRate("USD", "buy", "drac"), Math.round(2 * ratio * 1000) / 1000);

        // Other kinds and servers are untouched.
        assert.equal(serverPrice("drac", "sell"), null);
        assert.equal(serverPrice("tylezia", "buy"), null);

        // 0 resets to the base-rate × multiplier model.
        assert.equal(setServerPrice("drac", "buy", 0), null);
        assert.equal(serverPrice("drac", "buy"), null);
    } finally {
        setServerPrice("drac", "buy", before);
    }
});

test("serverPriceSummary lists every currency", () => {
    const summary = serverPriceSummary("buy", "drac");
    for (const symbol of ["€", "$", "£", "DH", "₮"]) assert.ok(summary.includes(symbol), `${symbol} in ${summary}`);
});

test("price table round-trips and rejects typos without partial updates", () => {
    const table = formatPriceTable();
    assert.equal(table.split("\n").length, DOFUS_SERVERS.length);

    const parsed = parsePriceTable(table);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.updates.length, DOFUS_SERVERS.length * 3);

    const custom = parsePriceTable("Draconiros : 1,60 / - / 0.7\nhellmina: 1.2 / 0,9 / -\n\n");
    assert.deepEqual(custom.errors, []);
    assert.deepEqual(custom.updates, [
        { serverCode: "drac", kind: "buy", price: 1.6 },
        { serverCode: "drac", kind: "exchange", price: 0.7 },
        { serverCode: "hellmina", kind: "buy", price: 1.2 },
        { serverCode: "hellmina", kind: "sell", price: 0.9 },
    ]);

    const broken = parsePriceTable("Atlantide : 1 / 1 / 1\nDraconiros : 1 / 2\nTylezia : abc / 1 / 1\nOrukam : -3 / 1 / 1");
    assert.equal(broken.errors.length, 4);

    assert.ok(priceTableModal(table).toJSON().components[0].components[0].value.length <= 4000);
});

test("market panels, the board and /rate voir stay inside Discord's embed limits", () => {
    for (const typeId of TICKET_TYPE_IDS) assertEmbedFits(panelEmbed(typeId), `panel ${typeId}`);
    for (const kind of ["buy", "sell", "exchange"]) {
        assertEmbedFits(boardEmbed(kind), `board ${kind}`);
        const text = serverRateFields(kind).map((field) => field.value).join("\n");
        for (const server of DOFUS_SERVERS) assert.ok(text.includes(server.name), `${kind} lists ${server.name}`);
    }
    assertEmbedFits(rateEmbed(), "rate voir");
});

test("buy list puts sold-out servers last, cheapest first among the rest", () => {
    const names = serverRateFields("buy")
        .flatMap((field) => field.value.split("\n"))
        .filter((line) => !line.startsWith("└"));
    const firstFull = names.findIndex((line) => line.startsWith("🔴"));
    if (firstFull !== -1) assert.ok(names.slice(firstFull).every((line) => line.startsWith("🔴")));
});
