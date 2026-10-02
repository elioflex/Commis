import assert from "node:assert/strict";
import test from "node:test";

import { DOFUS_SERVERS } from "../config.js";
import { offerDecisionRow, offerModal, watchSelectRow } from "../src/components.js";
import { setServerPrice } from "../src/market.js";
import {
    createOffer,
    decideOffer,
    offerById,
    offerGap,
    offerRefusedEmbed,
    offerStaffEmbed,
    parsePrice,
} from "../src/offers.js";
import { QUOTE_LOCK_MIN, lockQuote, lockedRate, quoteLockLine, releaseQuote } from "../src/price-lock.js";
import { pendingPriceChanges, priceChangeEmbed, setWatches, watchesFor } from "../src/price-watch.js";
import { read, setPath } from "../src/store.js";

function withPrices(prices, fn) {
    const saved = structuredClone(read("market.json").serverPrices ?? {});
    try {
        for (const [code, kinds] of Object.entries(prices)) {
            for (const [kind, value] of Object.entries(kinds)) setServerPrice(code, kind, value);
        }
        return fn();
    } finally {
        setPath("market.json", "serverPrices", saved);
    }
}

const [A, B] = DOFUS_SERVERS.map((server) => server.code);

test("price lock: held 15 min, customer always gets the better price", () => {
    withPrices({ [A]: { buy: 1.5, sell: 1.2 } }, () => {
        const t0 = 1_000_000;
        const until = lockQuote("u1", "buy", A, t0);
        assert.equal(until, t0 + QUOTE_LOCK_MIN * 60_000);
        assert.ok(quoteLockLine(until).includes("15 min"));

        setServerPrice(A, "buy", 1.8);
        assert.equal(lockedRate("u1", "buy", A, "EUR", t0 + 60_000), 1.5, "price went up: held price");
        setServerPrice(A, "buy", 1.3);
        assert.equal(lockedRate("u1", "buy", A, "EUR", t0 + 60_000), 1.3, "price went down: new price");
        setServerPrice(A, "buy", 1.8);
        assert.equal(lockedRate("u1", "buy", A, "EUR", t0 + QUOTE_LOCK_MIN * 60_000 + 1), 1.8, "expired");

        lockQuote("u1", "sell", A, t0);
        setServerPrice(A, "sell", 1.0);
        assert.equal(lockedRate("u1", "sell", A, "EUR", t0 + 1), 1.2, "payout dropped: held payout");
        releaseQuote("u1", "sell", A);
        assert.equal(lockedRate("u1", "sell", A, "EUR", t0 + 1), 1.0);
    });
});

test("price watch: one kind at a time, DM only on a 3 % move", () => {
    withPrices({ [A]: { buy: 2 }, [B]: { buy: 1, sell: 0.5 } }, () => {
        assert.deepEqual(setWatches("w1", "g1", "buy", [A, B, "nope"]), [A, B]);
        setWatches("w1", "g1", "sell", [B]);
        assert.deepEqual(watchesFor("w1", "buy"), [A, B]);
        assert.deepEqual(watchesFor("w1", "sell"), [B]);
        assert.equal(pendingPriceChanges().w1, undefined, "no move yet");

        setServerPrice(A, "buy", 2.02); // +1 %: noise
        setServerPrice(B, "buy", 0.9); // −10 %: good news for a buyer
        const { changes } = pendingPriceChanges().w1;
        assert.equal(changes.length, 1);
        assert.equal(changes[0].serverCode, B);
        const text = priceChangeEmbed(changes).toJSON().description;
        assert.ok(text.startsWith("🟢") && text.includes("en baisse de **10 %**"), text);

        setWatches("w1", "g1", "buy", []);
        assert.deepEqual(watchesFor("w1", "buy"), []);
        assert.deepEqual(watchesFor("w1", "sell"), [B], "sell watch kept");
        setWatches("w1", "g1", "sell", []);
        assert.equal(read("watches.json").users.w1, undefined);
    });
    assert.equal(watchSelectRow("buy").toJSON().components[0].custom_id, "watch:set:buy");
});

test("offers: parse, store, decide once", () => {
    assert.equal(parsePrice("1,40 €"), 1.4);
    assert.equal(parsePrice("15 DH"), 15);
    assert.equal(parsePrice("abc"), null);
    assert.equal(parsePrice("0"), null);

    withPrices({ [A]: { buy: 1.5 } }, () => {
        const offer = createOffer({
            guildId: "g1",
            userId: "c1",
            kind: "buy",
            serverCode: A,
            millions: 500,
            price: 1.35,
            currency: "EUR",
            personnage: "",
        });
        assert.match(offer.id, /^offre-\d{4}$/);
        assert.equal(offer.marketRate, 1.5);
        assert.equal(offerGap(offer), -10);
        assert.ok(JSON.stringify(offerStaffEmbed(offer).toJSON()).includes("En attente"));

        const accepted = decideOffer(offer.id, "accepted", "staff1");
        assert.equal(accepted.status, "accepted");
        assert.equal(decideOffer(offer.id, "refused", "staff2"), null, "already decided");
        assert.equal(offerById(offer.id).decidedBy, "staff1");
        assert.ok(offerRefusedEmbed(offer).toJSON().description.includes("1,50 €"));
    });

    const row = offerDecisionRow("offre-0001").toJSON().components.map((b) => b.custom_id);
    assert.deepEqual(row, ["offer:accept:offre-0001", "offer:refuse:offre-0001"]);
    assert.equal(offerModal("sell", A).toJSON().custom_id, `offer:modal:sell:${A}`);
});
