import { createServer } from "node:http";

/**
 * Minimal HTTP server.
 *
 * Render (and most free PaaS) only run a "web service" if the process binds a
 * port, and they use that endpoint both as a health check and — with a free
 * plan — as the inbound traffic that keeps the service from spinning down.
 * Discord itself never talks HTTP to the bot, so this server answers for it.
 *
 *   /            → JSON status of the bot
 *   /healthz     → "ok" (health check + keep-alive target)
 *   /robots.txt  → disallow (keeps crawlers away)
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

function send(response, status, body, headers = TEXT_HEADERS) {
    response.writeHead(status, headers);
    response.end(body);
}

export function startHealthServer(getStatus, { port = Number(process.env.PORT ?? Number.NaN) } = {}) {
    if (!Number.isFinite(port)) {
        console.info("[health] PORT absente — pas de serveur HTTP (normal en local).");
        return null;
    }

    const server = createServer(async (request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;

        if (path === "/healthz" || path === "/ping") {
            send(response, 200, "ok");
            return;
        }

        if (path === "/robots.txt") {
            send(response, 200, "User-agent: *\nDisallow: /\n");
            return;
        }

        if (path === "/") {
            try {
                send(response, 200, JSON.stringify(await getStatus(), null, 2), JSON_HEADERS);
            } catch (error) {
                send(response, 500, JSON.stringify({ ok: false, error: error.message }), JSON_HEADERS);
            }
            return;
        }

        send(response, 404, "not found");
    });

    server.on("error", (error) => console.error("[health] serveur HTTP :", error.message));
    server.listen(port, "0.0.0.0", () => {
        console.info(`[health] en écoute sur 0.0.0.0:${port} (/healthz pour le ping)`);
    });

    return server;
}
