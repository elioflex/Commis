import assert from "node:assert/strict";
import test from "node:test";

import { DOFUS_SERVERS, TICKET_TYPE_IDS } from "../config.js";
import { panelRow, priceTableModal } from "../src/components.js";
import { boardEmbed, exchangeRecapEmbed, exchangeSimEmbed, guideEmbeds, panelEmbed, rateEmbed } from "../src/embeds.js";
import {
    DEFAULT_EXCHANGE_FEE,
    effectiveRate,
    exchangeFee,
    exchangeQuote,
    formatPriceTable,
    parsePriceTable,
    rateFor,
    serverPrice,
    serverPriceSummary,
    serverRateFields,
    setExchangeFee,
    setServerPrice,
    stockLines,
    stockSummary,
} from "../src/market.js";
import { read, setPath } from "../src/store.js";

/** Discord rejects a message whose embeds exceed these limits. */
function embedLength(json) {
    return (
        (json.title?.length ?? 0) +
        (json.description?.length ?? 0) +
        (json.footer?.text?.length ?? 0) +
        (json.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
    );
}

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
        const ratio = rateFor("MAD", "buy") / rateFor("EUR", "buy");
        assert.equal(effectiveRate("MAD", "buy", "drac"), Math.round(2 * ratio * 1000) / 1000);

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

test("prices are shown in euro and dirham only", () => {
    const summary = serverPriceSummary("buy", "drac");
    assert.match(summary, /^[\d,]+ € · [\d,]+ DH$/);
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

test("buy list puts on-order servers last and never says « complet »", () => {
    const names = serverRateFields("buy")
        .flatMap((field) => field.value.split("\n"))
        .filter((line) => !line.startsWith("└"));
    const firstOnOrder = names.findIndex((line) => line.includes("🕐 sur commande"));
    if (firstOnOrder !== -1) assert.ok(names.slice(firstOnOrder).every((line) => line.includes("🕐 sur commande")));
    for (const kind of ["buy", "exchange"]) {
        const text = JSON.stringify(serverRateFields(kind)).toLowerCase();
        assert.ok(!text.includes("complet") && !text.includes("🔴"), kind);
    }
});

test("stock views skip servers we no longer sell", () => {
    const saved = structuredClone(read("market.json").stock);
    try {
        setPath("market.json", "stock.kelerog", { millions: 500, status: "open" });
        assert.ok(!stockLines().some((line) => line.includes("kelerog") || line.includes("Kelerog")));
        assert.equal(stockSummary().servers, stockLines().length);
    } finally {
        setPath("market.json", "stock", saved);
    }
});

test("the bot guide fits in one message and lists every command", () => {
    const embeds = guideEmbeds();
    for (const embed of embeds) assertEmbedFits(embed, `guide ${embed.data.title}`);
    // Discord caps the embeds of a single message at 6000 characters together.
    assert.ok(embeds.reduce((sum, embed) => sum + embedLength(embed.toJSON()), 0) <= 6000);

    const text = JSON.stringify(embeds.map((embed) => embed.toJSON()));
    const commands = ["/rate ajuster", "/rate prix", "/rate tableau", "/rate auto", "/rate commission", "/stock set"];
    commands.push("/ticket claim", "/ticket close", "/panel", "/setup", "/check");
    assert.ok(!text.includes("/avis"), "reviews only come from the end-of-ticket button");
    for (const command of commands) assert.ok(text.includes(command), `guide mentions ${command}`);
});

/** Pins sale prices on two servers for the duration of `fn`, then restores them. */
function withExchangePrices(prices, fn) {
    const saved = structuredClone(read("market.json"));
    try {
        for (const [code, price] of Object.entries(prices)) setServerPrice(code, "buy", price);
        return fn();
    } finally {
        setPath("market.json", "serverPrices", saved.serverPrices ?? {});
        setPath("market.json", "exchangeFee", saved.exchangeFee ?? DEFAULT_EXCHANGE_FEE);
    }
}

test("exchange: value ratio between servers, minus the commission", () => {
    const [from, to] = DOFUS_SERVERS.map((server) => server.code);
    withExchangePrices({ [from]: 0.38, [to]: 0.4 }, () => {
        setExchangeFee(10);
        // 1000 × 0,38 / 0,40 × 0,9 = 855
        assert.equal(exchangeQuote(from, to, 1000).received, 855);
        // Other way round: 1000 × 0,40 / 0,38 × 0,9 = 947,36… rounded down.
        assert.equal(exchangeQuote(to, from, 1000).received, 947.36);

        setServerPrice(to, "buy", 0.38);
        assert.equal(exchangeQuote(from, to, 1000).received, 900);

        setExchangeFee(0);
        assert.equal(exchangeQuote(from, to, 1000).received, 1000);
    });
});

test("exchange: invalid input gives no quote, commission is clamped", () => {
    const [from, to] = DOFUS_SERVERS.map((server) => server.code);
    withExchangePrices({ [from]: 0.38, [to]: 0.4 }, () => {
        assert.equal(exchangeQuote(from, from, 1000), null);
        assert.equal(exchangeQuote(from, to, 0), null);
        assert.equal(exchangeQuote(from, "inconnu", 1000), null);

        assert.equal(setExchangeFee(80), 50);
        assert.equal(setExchangeFee(-5), 0);
        assert.equal(setExchangeFee(12.5), 12.5);
        assert.equal(exchangeFee(), 12.5);
    });
});

test("exchange recap shows both servers, the rate and an example", () => {
    const [from, to] = DOFUS_SERVERS;
    withExchangePrices({ [from.code]: 0.38, [to.code]: 0.4 }, () => {
        setExchangeFee(10);
        const embed = exchangeRecapEmbed(from.code, to.code);
        assertEmbedFits(embed, "exchange recap");
        const text = embed.toJSON().description;
        assert.ok(text.includes(from.name) && text.includes(to.name));
        assert.ok(text.includes("0,855"), text);
        assert.ok(text.includes("855 M"), text);
        assert.ok(text.includes("commission 10 %"), text);
    });
});

test("exchange displays show stock only, the simulator gives the amount", () => {
    for (const embed of [boardEmbed("exchange"), panelEmbed("echange")]) {
        const text = JSON.stringify(embed.toJSON().fields);
        assert.ok(!text.includes("€") && !text.includes("DH"), "no price on the exchange displays");
    }
    const ids = panelRow("echange").toJSON().components.map((button) => button.custom_id);
    assert.deepEqual(ids, ["panel:echange", "xchg:sim", "alert:start", "info:proc:echange", "info:guarantee"]);

    const [from, to] = DOFUS_SERVERS;
    withExchangePrices({ [from.code]: 0.38, [to.code]: 0.4 }, () => {
        setExchangeFee(10);
        const text = exchangeSimEmbed(from.code, to.code, 1000).toJSON().description;
        assert.ok(text.includes("855 M") && text.includes(to.name), text);
        assert.ok(!exchangeRecapEmbed(from.code, to.code).toJSON().description.includes("€"));
    });
});
