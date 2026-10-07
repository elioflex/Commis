import assert from "node:assert/strict";
import test from "node:test";

import { CURRENCIES, parseCurrency } from "../config.js";
import { adminModal } from "../src/admin-panel.js";
import {
    exchangeModal,
    exchangeSimModal,
    marketModal,
    offerModal,
    priceTableModal,
    renameModal,
    reviewModal,
    simpleModal,
} from "../src/components.js";

// discord.js validates lengths when the builder is serialised: a label over 45
// characters only fails when a customer clicks the button ("Invalid string length").
test("every modal builds within Discord's limits", () => {
    const modals = [
        exchangeModal("brial", "drac"),
        exchangeModal("brial", "drac", 1000),
        exchangeSimModal("brial", "drac"),
        marketModal("achat", "drac", "paypal"),
        marketModal("vente", "drac", "paypal"),
        offerModal("buy", "drac"),
        offerModal("sell", "drac"),
        priceTableModal("drac 1.2 0.9"),
        renameModal(),
        reviewModal("ticket-0001"),
        simpleModal("echange"),
        ...["factors", "fee", "adjust", "price", "stock"].map((kind) => adminModal(kind)),
    ];
    for (const modal of modals) assert.doesNotThrow(() => modal.toJSON(), modal.data?.custom_id);
});

test("customers see DH, never MAD", () => {
    assert.deepEqual(
        CURRENCIES.map((currency) => currency.name),
        ["EUR", "DH"],
    );
    for (const typed of ["DH", "dh", "Dhs", "dirham", "MAD"]) assert.equal(parseCurrency(typed), "MAD");
    for (const typed of ["EUR", "eur", "€", "euro"]) assert.equal(parseCurrency(typed), "EUR");
    assert.equal(parseCurrency("USD"), null);
    const labels = JSON.stringify([marketModal("achat", "drac", "paypal").toJSON(), offerModal("buy", "drac").toJSON()]);
    assert.ok(!labels.includes("MAD"), labels);
});
