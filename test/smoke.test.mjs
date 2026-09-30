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

test("market math: quote is quantity × rate", () => {
    assert.deepEqual(quote("buy", 50, 1.35), { kind: "buy", millions: 50, rate: 1.35, total: 67.5 });
    assert.equal(quote("exchange", 200, 1).total, 200);
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

test("per-server pricing multiplies the base rate and resets to 1", async () => {
    const { effectiveRate, serverMultiplier, setServerMultiplier } = await import("../src/market.js");

    const base = rateFor("EUR", "buy");
    // Pas de réglage → prix de base.
    assert.equal(serverMultiplier("serveur-inconnu"), 1);
    assert.equal(effectiveRate("EUR", "buy", "serveur-inconnu"), base);

    // Multiplicateur du seed : Hellmina ×0.85 → moins cher que la base.
    const hellmina = effectiveRate("EUR", "buy", "hellmina");
    assert.ok(hellmina < base, `${hellmina} should be cheaper than base ${base}`);

    // Réglage manuel + reset.
    setServerMultiplier("drac", 1.2);
    assert.equal(effectiveRate("EUR", "buy", "drac"), Math.round(base * 1.2 * 1000) / 1000);
    assert.equal(setServerMultiplier("drac", 1), 1);
    assert.equal(effectiveRate("EUR", "buy", "drac"), base);
    // valeur de seed restaurée pour les autres tests
    setServerMultiplier("drac", 1.15);
});

test("formatMoney never renders NaN", () => {
    assert.match(formatMoney(12.5, "EUR"), /12,50/);
    assert.equal(formatMoney(undefined, "EUR"), "—");
    assert.equal(formatMoney(Number.NaN, "MAD"), "—");
});

test("every slash command is valid and under Discord's option limits", () => {
    const names = commandData.map((command) => command.name);
    assert.deepEqual(names, ["panel", "ticket", "rate", "stock", "setup", "check", "help"]);

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

test("reviews: one per delivered ticket, through the end-of-ticket button", async () => {
    const { reviewButtonRow, reviewModal } = await import("../src/components.js");
    const { closedTicketById, reviewForTicket } = await import("../src/tickets.js");
    const { read, write } = await import("../src/store.js");

    const button = reviewButtonRow("achat-00007").toJSON().components[0];
    assert.equal(button.custom_id, "review:open:achat-00007");
    assert.equal(reviewButtonRow("achat-00007", { done: true }).toJSON().components[0].disabled, true);
    assert.equal(reviewModal("achat-00007").toJSON().custom_id, "modal:review:achat-00007");

    const savedTickets = read("tickets.json");
    const savedReviews = read("reviews.json");
    try {
        write("tickets.json", { ...savedTickets, closed: [{ id: "achat-00007", userId: "42", type: "achat" }] });
        write("reviews.json", { entries: [] });
        assert.equal(closedTicketById("achat-00007").userId, "42");
        assert.equal(closedTicketById("inconnu"), null);
        assert.equal(reviewForTicket("achat-00007"), null);

        write("reviews.json", { entries: [{ ticketId: "achat-00007", rating: 5 }] });
        assert.equal(reviewForTicket("achat-00007").rating, 5);
    } finally {
        write("tickets.json", savedTickets);
        write("reviews.json", savedReviews);
    }
});

test("review shows the order details and the real time, only when 30 min or less", async () => {
    const { reviewEmbed } = await import("../src/embeds.js");
    const author = { tag: "client#0001", displayAvatarURL: () => undefined };
    const opened = "2026-09-30T10:00:00.000Z";
    const [from, to] = DOFUS_SERVERS;
    const fieldsFor = (ticket) =>
        Object.fromEntries(reviewEmbed({ author, rating: 5, text: "top", ticket }).toJSON().fields.map((f) => [f.name, f.value]));

    const fast = fieldsFor({ type: "achat", millions: 250, serverCode: from.code, openedAt: opened, closedAt: "2026-09-30T10:12:00.000Z" });
    assert.equal(fast["⏱️ Durée"], "Livré en 12 min");
    assert.ok(fast["💰 Quantité"].includes("250") && fast["💰 Quantité"].includes(from.name));

    const slow = fieldsFor({ type: "achat", millions: 250, serverCode: from.code, openedAt: opened, closedAt: "2026-09-30T11:30:00.000Z" });
    assert.equal(slow["⏱️ Durée"], undefined);

    const swap = fieldsFor({
        type: "echange", millions: 1000, received: 855, transferFrom: from.code, transferTo: to.code,
        openedAt: opened, closedAt: "2026-09-30T10:30:00.000Z",
    });
    assert.ok(swap["♻️ Transfert"].includes("855") && swap["♻️ Transfert"].includes(to.name));
    assert.equal(swap["⏱️ Durée"], "Livré en 30 min");
});
