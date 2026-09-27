import assert from "node:assert/strict";
import test from "node:test";

import { Collection } from "discord.js";

import { DOFUS_SERVERS, TICKET_TYPE_IDS, TICKET_TYPES } from "../config.js";
import { commandData } from "../src/commands.js";
import {
    closeReasonRow,
    marketModal,
    paymentSelectRow,
    serverSelectRow,
    simpleModal,
    ticketActionRow,
} from "../src/components.js";
import { panelEmbed, rateEmbed, stockEmbed, ticketIntroEmbed } from "../src/embeds.js";
import { formatMoney, parseMillions, quote, rateFor, stockFor } from "../src/market.js";
import { setupGuild } from "../src/setup.js";
import { ticketStats } from "../src/tickets.js";
import { buildTranscript } from "../src/transcript.js";

test("market math: quote applies the exchange rebate for big lots", () => {
    assert.deepEqual(quote("buy", 50, 1.35), {
        kind: "buy",
        millions: 50,
        rate: 1.35,
        discount: 0,
        total: 67.5,
    });

    const bigExchange = quote("echange", 200, 1);
    assert.equal(bigExchange.discount, 0.1);
    assert.equal(bigExchange.total, 180);

    assert.equal(quote("buy", 50, null), null);
    assert.equal(quote("buy", 0, 1), null);
});

test("parseMillions accepts plain, k and milliards suffixes only", () => {
    assert.equal(parseMillions("50"), 50);
    assert.equal(parseMillions("12.5"), 12.5);
    assert.equal(parseMillions("12,5"), 12.5);
    assert.equal(parseMillions("1200k"), 1.2);
    assert.equal(parseMillions("3 milliards"), 3000);
    assert.equal(parseMillions("abc"), null);
    assert.equal(parseMillions(""), null);
    assert.equal(parseMillions("-5"), null);
});

test("market data has a seed rate and stock for every configured server", () => {
    assert.equal(typeof rateFor("EUR", "buy"), "number");
    for (const server of DOFUS_SERVERS) {
        const stock = stockFor(server.code);
        assert.ok(["open", "low", "full"].includes(stock.status), `${server.code} status`);
        assert.equal(typeof stock.millions, "number");
    }
});

test("formatMoney never renders NaN", () => {
    assert.match(formatMoney(12.5, "EUR"), /12,50/);
    assert.equal(formatMoney(undefined, "EUR"), "—");
    assert.equal(formatMoney(Number.NaN, "MAD"), "—");
});

test("every slash command is valid and under Discord's option limits", () => {
    const names = commandData.map((command) => command.name);
    assert.deepEqual(names, ["panel", "ticket", "rate", "stock", "avis", "setup", "check", "help"]);

    for (const command of commandData) {
        assert.ok(command.description.length <= 100, `${command.name} description too long`);
        for (const option of command.options ?? []) {
            if (option.choices) assert.ok(option.choices.length <= 25, `${command.name}/${option.name} too many choices`);
            for (const sub of option.options ?? []) {
                if (sub.choices) assert.ok(sub.choices.length <= 25, `${command.name} ${option.name} ${sub.name}`);
            }
        }
    }
});

test("components stay inside Discord's limits (25 select options, 5 modal rows, 5 buttons)", () => {
    assert.ok(serverSelectRow("achat").components[0].options.length <= 25);
    assert.ok(paymentSelectRow("achat", "drac").components[0].options.length <= 25);
    assert.equal(marketModal("achat", "drac", "paypal").toJSON().components.length, 4);
    assert.equal(simpleModal("support").toJSON().components.length, 3);
    assert.equal(ticketActionRow({}).components.length, 5);
    assert.equal(closeReasonRow().components[0].options.length, 5);
});

test("every panel has a matching ticket type and a real embed", () => {
    for (const typeId of TICKET_TYPE_IDS) {
        assert.ok(TICKET_TYPES[typeId], typeId);
        const embed = panelEmbed(typeId).toJSON();
        assert.ok(embed.title.includes(TICKET_TYPES[typeId].label));
        assert.ok(embed.fields.length >= 1);
    }
    assert.match(rateEmbed().toJSON().title, /Taux/);
    assert.match(stockEmbed().toJSON().title, /Stock/);
});

test("ticket intro embed renders the order summary", () => {
    const embed = ticketIntroEmbed(
        {
            id: "vente-00001",
            number: 1,
            type: "vente",
            serverCode: "drac",
            millions: 50,
            currency: "EUR",
            rateKind: "sell",
            paymentCode: "paypal",
            personnage: "MyStique",
            notes: "dispo ce soir",
            total: 47.5,
        },
        { toString: () => "<@1>" },
        TICKET_TYPES.vente,
    ).toJSON();

    const names = embed.fields.map((field) => field.name);
    assert.ok(names.includes("🌍 Serveur Dofus"));
    assert.ok(names.includes("💰 Quantité"));
    assert.ok(names.includes("💳 Paiement"));
    assert.ok(names.includes("📝 Notes"));
    assert.ok(embed.description.includes("Bonjour"));
});

test("transcript renders standalone HTML even for an empty channel", async () => {
    const channel = {
        name: "vente-00001",
        messages: { fetch: async () => new Collection() },
    };
    const { html, count } = await buildTranscript(channel, { title: "Ticket vente", number: 1 });
    assert.equal(count, 0);
    assert.match(html, /<!doctype html>/);
    assert.match(html, /vente-00001/);
});

test("setup dry-run plans the whole layout without touching the API", async () => {
    const guild = {
        id: "1",
        roles: { cache: new Collection() },
        channels: { cache: new Collection() },
        members: { me: { id: "9" } },
    };

    const report = await setupGuild(guild, { dryRun: true });

    assert.ok(report.rolesCreated.length >= 20, "roles planned");
    assert.ok(report.categoriesCreated.length >= 5, "categories planned");
    assert.ok(report.channelsCreated.length >= 30, "channels planned");
    assert.ok(
        report.channelsCreated.some((name) => name.startsWith("💎・acheter-kamas")),
        "market channel planned",
    );
    assert.ok(report.channelsCreated.every((name) => name.endsWith("(prévu)")));
});

test("ticket stats tolerate an empty store", () => {
    const stats = ticketStats("does-not-exist");
    assert.equal(stats.openCount, 0);
    assert.equal(stats.closedCount, 0);
});
