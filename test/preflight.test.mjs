import assert from "node:assert/strict";
import test from "node:test";

import { Collection, PermissionFlagsBits } from "discord.js";

import { SETTINGS } from "../config.js";
import { ensureCategory } from "../src/guild-utils.js";
import { checkGuild, describeInventory, formatChecks } from "../src/preflight.js";
import { paymentRoleDefinitions, plannedRoles, setupGuild } from "../src/setup.js";

const REQUIRED = [
    "ViewChannel",
    "ManageChannels",
    "ManageRoles",
    "SendMessages",
    "EmbedLinks",
    "AttachFiles",
    "ReadMessageHistory",
];

const permissions = (granted = REQUIRED) => {
    const bits = granted.reduce((acc, key) => acc | PermissionFlagsBits[key], 0n);
    return { has: (bit) => (bits & bit) !== 0n };
};

const fakeGuild = ({
    granted = REQUIRED,
    botPosition = 10,
    staffPosition = 5,
    roles = [],
    channels = [],
    id = "1025854496225628190",
} = {}) => {
    const roleCache = new Collection([
        ["staff", { id: "5", name: "Staff", position: staffPosition }],
        ...roles.map((name, index) => [`r${index}`, { id: `r${index}`, name, position: 1 }]),
    ]);
    const channelCache = new Collection(
        channels.map((name, index) => [`c${index}`, { id: `c${index}`, name, type: 0 }]),
    );

    return {
        id,
        roles: { everyone: { id: "1", name: "@everyone" }, cache: roleCache },
        channels: { cache: channelCache },
        members: {
            me: {
                id: "9",
                permissions: permissions(granted),
                roles: { highest: { id: "1", name: "Bot", position: botPosition } },
            },
        },
    };
};

const icons = (result) => result.checks.filter((check) => check.level === "error").map((check) => check.title);

test("a healthy guild passes the pre-flight with no errors", () => {
    const result = checkGuild(fakeGuild());

    assert.equal(result.ok, true);
    assert.deepEqual(icons(result), []);
    assert.ok(result.checks.some((check) => check.title === "Hiérarchie des rôles" && check.level === "ok"));
});

test("missing permissions and a bot role under Staff are reported as errors", () => {
    const weak = checkGuild(fakeGuild({ granted: ["ViewChannel", "SendMessages"], botPosition: 2 }));
    assert.equal(weak.ok, false);

    const titles = icons(weak);
    assert.ok(titles.includes("Gérer les rôles"), "ManageRoles flagged");
    assert.ok(titles.includes("Gérer les salons"), "ManageChannels flagged");
    assert.ok(titles.includes("Hiérarchie des rôles"), "role order flagged");
    assert.ok(!titles.includes("Voir les salons"), "granted permission not flagged");
});

test("a member intent missing from the code is surfaced", () => {
    const client = { options: { intents: { has: () => false } } };
    const result = checkGuild(fakeGuild(), client);

    assert.ok(icons(result).includes("Intent SERVER MEMBERS (code)"));
});

test("a GUILD_ID pointing at another server is a warning, not a blocker", (context) => {
    if (!SETTINGS.guildId) return context.skip("no GUILD_ID configured");

    const mismatched = checkGuild(fakeGuild({ id: "1" }));
    const check = mismatched.checks.find((item) => item.title === "GUILD_ID différent");
    assert.equal(check?.level, "warn");
    assert.equal(mismatched.ok, true, "a wrong guild id must not block the setup");

    const matching = checkGuild(fakeGuild({ id: SETTINGS.guildId }));
    assert.ok(!matching.checks.some((item) => item.title === "GUILD_ID différent"));
});

test("an empty guild reports every permission, since the bot member is unknown", () => {
    const result = checkGuild({ id: "1", roles: { cache: new Collection() }, channels: { cache: new Collection() } });

    assert.equal(result.ok, false);
    assert.ok(icons(result).includes("Bot introuvable sur le serveur"));
    assert.equal(result.inventory.roles.missing, plannedRoles().length);
});

test("the inventory counts what is already built", () => {
    const plannedRoleNames = plannedRoles().map((role) => role.name);
    const guild = fakeGuild({
        roles: [plannedRoleNames[0], plannedRoleNames[1]],
        channels: ["🏪 | Le Comptoir", "📜・règles"],
    });

    const inventory = describeInventory(guild);
    assert.equal(inventory.roles.planned, plannedRoleNames.length);
    assert.equal(inventory.roles.missing, plannedRoleNames.length - 2);
    assert.equal(inventory.channels.missing, inventory.channels.planned - 1);
    assert.ok(inventory.categories.missing < inventory.categories.planned, "one category found");

    const lines = formatChecks({ checks: [], inventory });
    assert.match(lines.join("\n"), /il manque \d+ rôle\(s\)/);
});

test("staff-only channels grant the bot its own access, since it has no Staff role", async () => {
    const guild = fakeGuild();
    let payload = null;
    guild.channels.create = async (options) => {
        payload = options;
        return { id: "new-channel", ...options };
    };

    await ensureCategory(guild, "🔒 | Staff", { staffOnly: true });

    const targets = payload.permissionOverwrites.map((overwrite) => overwrite.id);
    assert.ok(targets.includes("1"), "@everyone is denied by default");
    assert.ok(targets.includes("5"), "the Staff role gets access");
    assert.ok(targets.includes("9"), "the bot gets explicit access — Manage Channels does not bypass ViewChannel");

    const everyone = payload.permissionOverwrites.find((overwrite) => overwrite.id === "1");
    assert.ok(everyone.deny.includes(PermissionFlagsBits.ViewChannel));
});

test("payment roles are opt-in and skip the catch-all entry", () => {
    const paymentRoles = paymentRoleDefinitions();
    assert.ok(paymentRoles.length >= 15);
    assert.ok(!paymentRoles.some((role) => role.name.startsWith("Autre")));
    assert.equal(plannedRoles({ withPaymentRoles: true }).length, plannedRoles().length + paymentRoles.length);
});

test("setup plans the payment roles only when asked", async () => {
    const guild = fakeGuild({ roles: [], channels: [] });
    guild.roles.cache.clear();

    const plain = await setupGuild(guild, { dryRun: true });
    const full = await setupGuild(guild, { dryRun: true, withPaymentRoles: true });

    assert.equal(full.rolesCreated.length - plain.rolesCreated.length, paymentRoleDefinitions().length);
    assert.ok(full.rolesCreated.some((name) => name.startsWith("PayPal")));
});
