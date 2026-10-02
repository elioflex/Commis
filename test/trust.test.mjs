import assert from "node:assert/strict";
import test from "node:test";

import { ANTI_SCAM_LINE, DOFUS_SERVERS, TICKET_TYPE_IDS } from "../config.js";
import { alertSelectRow, panelRows } from "../src/components.js";
import { guaranteeEmbed, panelEmbed, paymentMethodsEmbed, procedureEmbed, reviewEmbed } from "../src/embeds.js";
import { alertsFor, isRestock, restockEmbed, setAlerts, subscribersFor } from "../src/stock-alerts.js";

const ids = (typeId) => panelRows(typeId).map((row) => row.toJSON().components.map((button) => button.custom_id));

test("market panels: tools on row 1, trust buttons on row 2, 5 at most per row", () => {
    assert.deepEqual(ids("achat"), [
        ["panel:achat", "alert:start", "watch:start:buy", "offer:start:buy"],
        ["info:proc:achat", "info:guarantee", "info:pay"],
    ]);
    assert.deepEqual(ids("vente"), [
        ["panel:vente", "watch:start:sell", "offer:start:sell"],
        ["info:proc:vente", "info:guarantee", "info:pay"],
    ]);
    for (const typeId of TICKET_TYPE_IDS) {
        for (const row of ids(typeId)) assert.ok(row.length <= 5, typeId);
    }
    assert.deepEqual(ids("support"), [["panel:support"]]);
});

test("market panels show the anti-scam line, other panels don't", () => {
    for (const typeId of ["achat", "vente", "echange"]) {
        assert.ok(JSON.stringify(panelEmbed(typeId).toJSON()).includes("Anti-arnaque"), typeId);
    }
    assert.ok(!JSON.stringify(panelEmbed("support").toJSON()).includes("Anti-arnaque"));
});

test("info embeds render for every market panel", () => {
    assert.ok(guaranteeEmbed().toJSON().description.includes(ANTI_SCAM_LINE));
    for (const typeId of ["achat", "vente", "echange"]) {
        const text = procedureEmbed(typeId).toJSON().description;
        assert.ok(text.startsWith("1️⃣"), typeId);
    }
    assert.ok(paymentMethodsEmbed().toJSON().description.includes("PayPal"));
});

test("stock alerts: set, list, subscribers, clear", () => {
    const [a, b] = DOFUS_SERVERS;
    assert.deepEqual(setAlerts("u1", "g1", [a.code, b.code, a.code, "nope"]), [a.code, b.code]);
    assert.deepEqual(alertsFor("u1"), [a.code, b.code]);
    assert.deepEqual(subscribersFor(a.code), [{ userId: "u1", guildId: "g1" }]);
    const row = alertSelectRow(alertsFor("u1")).toJSON().components[0];
    assert.equal(row.custom_id, "alert:set");
    assert.equal(row.min_values, 0);
    assert.deepEqual(row.options.filter((o) => o.default).map((o) => o.value), [a.code, b.code]);
    setAlerts("u1", "g1", []);
    assert.deepEqual(alertsFor("u1"), []);
    assert.deepEqual(subscribersFor(a.code), []);
});

test("restock fires only when a server becomes deliverable", () => {
    assert.equal(isRestock({ status: "full", millions: 0 }, { status: "open", millions: 300 }), true);
    assert.equal(isRestock({ status: "low", millions: 0 }, { status: "low", millions: 20 }), true);
    assert.equal(isRestock({ status: "open", millions: 300 }, { status: "open", millions: 500 }), false);
    assert.equal(isRestock({ status: "full", millions: 0 }, { status: "full", millions: 0 }), false);
    assert.ok(restockEmbed(DOFUS_SERVERS[0].code, { millions: 250 }).toJSON().description.includes("250"));
});

test("reviews show the ticket reference and the staff in charge", () => {
    const author = { tag: "client", displayAvatarURL: () => null };
    const ticket = { id: "achat-00042", type: "achat", millions: 100, serverCode: DOFUS_SERVERS[0].code, claimedBy: "123", closedBy: "456" };
    const fields = Object.fromEntries(reviewEmbed({ author, rating: 4, text: "ok", ticket }).toJSON().fields.map((f) => [f.name, f.value]));
    assert.equal(fields["🧾 Référence"], "`achat-00042`");
    assert.equal(fields["🧑‍💼 Staff"], "<@123>");
    const unclaimed = { ...ticket, claimedBy: null };
    const fallback = Object.fromEntries(reviewEmbed({ author, rating: 4, text: "ok", ticket: unclaimed }).toJSON().fields.map((f) => [f.name, f.value]));
    assert.equal(fallback["🧑‍💼 Staff"], "<@456>");
});
