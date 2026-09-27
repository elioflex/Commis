import "dotenv/config";

import { REST, Routes } from "discord.js";

import { commandData } from "./commands.js";

const token = process.env.DISCORD_TOKEN?.trim();
const guildId = process.env.GUILD_ID?.trim();

if (!token) {
    console.error("DISCORD_TOKEN manquant.");
    process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

try {
    const me = await rest.get(Routes.user());
    console.log(`[deploy] Connecté en tant que ${me.username} (${me.id})`);

    const route = guildId
        ? Routes.applicationGuildCommands(me.id, guildId)
        : Routes.applicationCommands(me.id);

    const data = await rest.put(route, { body: commandData });
    console.log(
        `[deploy] ${data.length} commande(s) enregistrée(s) ${guildId ? `sur le serveur ${guildId}` : "globalement (propagation jusqu'à 1 h)"}.`,
    );
} catch (error) {
    console.error("[deploy] Échec :", error);
    process.exit(1);
}
