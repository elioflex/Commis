import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { BRAND, SETTINGS } from "../../config.js";
import { checkGuildLive } from "../preflight.js";
import { setupGuild } from "../setup.js";

/**
 * Builds the whole server (roles, categories, channels, panels) from the CLI.
 *
 *   npm run check                        diagnostic only, changes nothing
 *   npm run setup:dry                    preview of everything that would be created
 *   npm run setup                        creates what is missing
 *   npm run setup:full                   same + roles for every payment method
 *
 * Flags: --check --dry-run --skip-roles --with-payment-roles --force
 */

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const checkOnly = flags.has("--check");
const dryRun = flags.has("--dry-run");
const skipRoles = flags.has("--skip-roles");
const withPaymentRoles = flags.has("--with-payment-roles") || flags.has("--full");
const force = flags.has("--force");

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
    console.error("DISCORD_TOKEN manquant — copie .env.example vers .env et remplis-le.");
    process.exit(1);
}
if (!SETTINGS.guildId) {
    console.error("GUILD_ID manquant dans .env (clic droit sur le serveur → Copier l'ID du serveur).");
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async () => {
    console.log(`\nConnecté en tant que ${client.user.tag}`);
    const guild = await client.guilds.fetch(SETTINGS.guildId).catch(() => null);

    if (!guild) {
        console.error(
            `Serveur introuvable : ${SETTINGS.guildId}\n` +
                "Vérifie que le bot est bien invité sur ce serveur et que l'ID est correct.",
        );
        client.destroy();
        process.exit(1);
    }

    const label = checkOnly ? "Diagnostic" : dryRun ? "[DRY RUN]" : "Configuration";
    console.log(`${label} de « ${guild.name} » — ${BRAND.name} ${BRAND.emoji}\n`);

    /* ── pre-flight ── */
    const diagnostics = await checkGuildLive(guild, client, { withPaymentRoles });
    for (const check of diagnostics.checks) {
        console.log(`${check.level === "error" ? "❌" : check.level === "warn" ? "⚠️" : "✅"} ${check.title} — ${check.detail}`);
    }

    const { roles, categories, channels } = diagnostics.inventory;
    console.log(
        `\nStructure : ${roles.planned - roles.missing}/${roles.planned} rôles, ` +
            `${categories.planned - categories.missing}/${categories.planned} catégories, ` +
            `${channels.planned - channels.missing}/${channels.planned} salons.`,
    );

    if (checkOnly) {
        if (!diagnostics.ok) {
            console.log("\nCorrige les lignes ❌ ci-dessus, puis relance `npm run check`.");
            if (roles.missing + categories.missing + channels.missing > 0) {
                console.log("Lance ensuite `npm run setup` pour créer ce qui manque.");
            }
        } else if (roles.missing + categories.missing + channels.missing > 0) {
            console.log("\nTout est vert : lance `npm run setup` pour créer ce qui manque.");
        } else {
            console.log("\nTout est en place : tu peux lancer `npm start`.");
        }
        client.destroy();
        process.exit(diagnostics.ok ? 0 : 1);
    }

    if (!diagnostics.ok && !force) {
        console.log(
            "\nConfiguration interrompue : les points ❌ ci-dessus feraient échouer la création des salons.\n" +
                "Corrige-les puis relance. (`npm run setup -- --force` pour passer outre.)",
        );
        client.destroy();
        process.exit(1);
    }

    /* ── build ── */
    console.log();
    const report = await setupGuild(guild, { dryRun, skipRoles, withPaymentRoles });

    const section = (title, list) => {
        if (!list.length) return;
        console.log(`${title} (${list.length})`);
        for (const entry of list) console.log(`  • ${entry}`);
        console.log();
    };

    section("Rôles créés", report.rolesCreated);
    section("Catégories créées", report.categoriesCreated);
    section("Salons créés", report.channelsCreated);
    section("Panneaux publiés", report.panelsPosted);
    section("Déjà présents — rôles", report.rolesSkipped);
    section("Déjà présents — catégories", report.categoriesSkipped);
    section("Déjà présents — salons", report.channelsSkipped);

    if (dryRun) {
        console.log("Aperçu terminé : rien n'a été modifié. Lance `npm run setup` pour créer tout ça.");
    } else {
        console.log("À coller dans ton .env :");
        if (report.staffRoleId) console.log(`  STAFF_ROLE_ID=${report.staffRoleId}`);
        if (report.managerRoleId) console.log(`  MANAGER_ROLE_ID=${report.managerRoleId}`);
        if (report.logChannelId) console.log(`  LOG_CHANNEL_ID=${report.logChannelId}`);
        if (report.transcriptChannelId) console.log(`  TRANSCRIPT_CHANNEL_ID=${report.transcriptChannelId}`);
        console.log("\nEnsuite : npm start (et npm run deploy si tu n'as pas encore enregistré les commandes).");
    }

    client.destroy();
    process.exit(0);
});

client.on("error", (error) => console.error("[client]", error));
client.login(token).catch((error) => {
    console.error("Connexion impossible :", error.message);
    console.error("Vérifie DISCORD_TOKEN, et que l'application est bien un bot (pas un compte utilisateur).");
    process.exit(1);
});
