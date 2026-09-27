import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test, { after } from "node:test";

import { Collection } from "discord.js";

// The store reads DATA_DIR when it is evaluated, so it must be set before the
// dynamic imports below — that keeps these tests away from the real data files.
const dataDir = await mkdtemp(join(tmpdir(), "comptoir-test-"));
process.env.DATA_DIR = dataDir;
process.env.STATE_MIRROR = "on";

const { read, write } = await import("../src/store.js");
const { startHealthServer } = await import("../src/health.js");
const {
    MIRROR_NAME,
    applySnapshot,
    buildSnapshot,
    decideImport,
    isEmptyState,
    mirrorStateNow,
    restoreState,
    scheduleStateMirror,
    stateMirrorStatus,
} = await import("../src/persist.js");

after(() => rm(dataDir, { recursive: true, force: true }));

const fakeMessage = ({ id, authorId, text }) => ({
    id,
    author: { id: authorId },
    attachments: new Collection([
        ["a", { name: MIRROR_NAME, url: "https://cdn.example/etat.json", size: text.length }],
    ]),
});

function fakeReadyClient({ botId = "9", messages = [] } = {}) {
    const calls = { edited: [], sent: [] };
    const channel = {
        id: "555",
        name: "⚙️・gestion",
        isTextBased: () => true,
        messages: {
            fetch: async () => new Collection(messages.map((message) => [message.id, message])),
            edit: async (id, payload) => {
                calls.edited.push({ id, payload });
                return { id, attachments: new Collection([["a", { size: 42 }]]) };
            },
        },
        send: async (payload) => {
            calls.sent.push(payload);
            return { id: `new-${calls.sent.length}`, attachments: new Collection([["a", { size: 42 }]]) };
        },
    };

    return {
        calls,
        client: {
            user: { id: botId, tag: "Commis#8145" },
            guilds: {
                fetch: async () => ({ channels: { cache: new Collection([["555", channel]]) } }),
                cache: new Collection(),
            },
            isReady: () => true,
        },
    };
}

test("the store writes its files into the configured DATA_DIR", () => {
    write("tickets.json", { counter: 3, open: { "vente-00003": { id: "vente-00003" } }, closed: [] });

    assert.ok(existsSync(join(dataDir, "tickets.json")));
    assert.ok(existsSync(join(dataDir, "market.json")), "missing files are seeded");
    assert.equal(read("tickets.json").counter, 3);
});

test("a snapshot round-trips back into the data files", () => {
    write("reviews.json", { entries: [{ rating: 5, text: "rapide et propre" }] });
    const snapshot = buildSnapshot();

    assert.equal(snapshot.version, 1);
    assert.ok(snapshot.savedAt);
    assert.ok(snapshot.files["reviews.json"]);

    // Simulate a wiped filesystem, then restore.
    write("reviews.json", { entries: [] });
    const restored = applySnapshot(snapshot);

    assert.ok(restored.includes("reviews.json"));
    assert.equal(read("reviews.json").entries[0].rating, 5);
});

test("applySnapshot ignores unknown files and junk payloads", () => {
    const restored = applySnapshot({ files: { "secrets.json": { a: 1 }, "panels.json": "not-an-object" } });
    assert.deepEqual(restored, []);
});

test("decideImport protects a rich local state unless told otherwise", () => {
    assert.equal(decideImport({ mode: "off" }), "off");
    assert.equal(decideImport({ mode: "always", localEmpty: false }), "import");
    assert.equal(decideImport({ mode: "when-empty", localEmpty: true }), "import");
    assert.equal(decideImport({ mode: "when-empty", localEmpty: false }), "keep-local");
    assert.equal(decideImport({ mode: "when-empty", localEmpty: isEmptyState() }), "keep-local");
});

test("restoreState imports the newest snapshot and then edits that same message", async () => {
    write("market.json", { updatedAt: null, rates: {}, stock: {} });
    const snapshot = {
        version: 1,
        savedAt: "2026-09-27T10:00:00.000Z",
        files: { "market.json": { updatedAt: "2026-09-27T10:00:00.000Z", rates: { EUR: { buy: 1.42 } }, stock: {} } },
    };

    const older = fakeMessage({ id: "1", authorId: "9", text: "{}" });
    const newest = fakeMessage({ id: "2", authorId: "9", text: "{}" });
    const fromSomeoneElse = fakeMessage({ id: "3", authorId: "42", text: "{}" });

    const { client, calls } = fakeReadyClient({ messages: [older, newest, fromSomeoneElse] });
    const result = await restoreState(client, {
        fetchText: async () => JSON.stringify(snapshot),
        mode: "always",
    });

    assert.deepEqual(
        result.restored,
        ["market.json"],
        `restore returned reason=${result.reason} error=${result.error ?? "none"}`,
    );
    assert.equal(read("market.json").rates.EUR.buy, 1.42);
    assert.equal(stateMirrorStatus().messageId, "2", "the newest bot snapshot wins");
    assert.equal(stateMirrorStatus().channelId, "555");

    // The next save must update the existing message, not spam a new one.
    await mirrorStateNow();
    assert.equal(calls.edited.length, 1);
    assert.equal(calls.edited[0].id, "2");
    assert.equal(calls.sent.length, 0);
    assert.ok(stateMirrorStatus().lastSavedAt);
});

test("restoreState stays quiet when there is nothing to restore", async () => {
    const { client } = fakeReadyClient({ messages: [] });
    const result = await restoreState(client);

    assert.equal(result.reason, "no-snapshot");
    assert.equal(scheduleStateMirror(), true, "mirroring is armed once a channel is known");
});

test("the health server answers the keep-alive probe and reports status", async () => {
    const server = startHealthServer(() => ({ ok: true, brand: "Le Comptoir des Kamas", tickets: { open: 2 } }), {
        port: 0,
    });
    assert.ok(server, "server started");
    await once(server, "listening");

    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const probe = await fetch(`${base}/healthz`);
        assert.equal(probe.status, 200);
        assert.equal(await probe.text(), "ok");

        const status = await fetch(`${base}/`);
        assert.deepEqual(await status.json(), { ok: true, brand: "Le Comptoir des Kamas", tickets: { open: 2 } });

        assert.equal((await fetch(`${base}/robots.txt`)).status, 200);
        assert.equal((await fetch(`${base}/nope`)).status, 404);
    } finally {
        // fetch keeps sockets alive, which would otherwise hold the test runner open.
        server.closeAllConnections?.();
        server.close();
    }
});

test("the health server stays off when no port is provided", () => {
    assert.equal(startHealthServer(() => ({}), { port: Number.NaN }), null);
});
