import { DOFUS_SERVERS, SETTINGS } from "../config.js";
import { refreshMarketDisplays } from "./live-board.js";
import { read, update } from "./store.js";

/**
 * Automatic market prices, read from public kamas shops.
 *
 * - kamasv.com and 1kamas.com SELL kamas. They run WooCommerce, whose Store API
 *   (`/wp-json/wc/store/v1/`) is the public JSON behind their product pages.
 *   Their median is the retail reference → `feed.reference`.
 * - leskamas.com BUYS kamas from players; its price list is a plain HTML table.
 *   That payout is our sell reference → `feed.sellReference`.
 *
 * We fetch sequentially and only every `PRICE_FEED_INTERVAL_MIN`, directly (no proxy).
 *
 * `market.js` turns both references into our buy / sell / exchange prices with
 * the staff factors.
 */

const USER_AGENT = "CommisPriceBot/1.0 (Discord bot; prix de reference, 1 passage / 30 min)";
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_GAP_MS = 400;
/** A price that moves more than this between two fetches must be confirmed by the next one. */
const MAX_JUMP = 0.5;

/** `kind`: "retail" = price the shop sells at · "payout" = price the shop pays players. */
export const SOURCES = [
    { id: "kamasv", label: "kamasv.com", base: "https://kamasv.com", kind: "retail" },
    { id: "1kamas", label: "1kamas.com", base: "https://1kamas.com", kind: "retail" },
    { id: "leskamas", label: "leskamas.com", base: "https://www.leskamas.com", kind: "payout" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ───────────────────────── HTTP ───────────────────────── */

async function httpGet(url, accept) {
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${new URL(url).host}`);
    return response;
}

async function defaultFetchJson(url) {
    const response = await httpGet(url, "application/json");
    return { data: await response.json(), totalPages: Number(response.headers.get("x-wp-totalpages")) || 1 };
}

async function defaultFetchText(url) {
    return (await httpGet(url, "text/html")).text();
}

/* ───────────────────────── matching ───────────────────────── */

const decodeEntities = (text) =>
    String(text ?? "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, "&");

/** "Ombre &#8211; Shadow" → "ombreshadow", "Tal kasha" → "talkasha". */
export const normalizeName = (text) =>
    decodeEntities(text)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

const serverKeys = new Map();
for (const server of DOFUS_SERVERS) {
    if (!server.game) continue;
    for (const name of [server.name, ...(server.aliases ?? [])]) {
        serverKeys.set(`${server.game}:${normalizeName(name)}`, server.code);
    }
}

/** Our server code for a shop's (game, server name), or null — "Boune 2" never matches "Boune". */
export const matchServer = (game, name) => (game ? serverKeys.get(`${game}:${normalizeName(name)}`) ?? null : null);

/**
 * Which game a shop's category or product title is about. Seasonal and
 * temporary servers (Temporis, saisonniers) are separate markets: skipped.
 */
export function gameFromTitle(title) {
    const text = normalizeName(title);
    if (/temporis|temporix|saisonnier/.test(text)) return null;
    if (text.includes("touch")) return "touch";
    if (text.includes("retro")) return "retro";
    if (text.includes("wakfu")) return "wakfu";
    if (text.includes("dofus") || text === "kamas") return "dofus";
    return null;
}

/** WooCommerce prices are strings in minor units: { price: "77", currency_minor_unit: 2 } → 0.77. */
export function priceFromStoreApi(prices) {
    if (!prices || String(prices.currency_code ?? "EUR").toUpperCase() !== "EUR") return null;
    const minor = Number(prices.currency_minor_unit ?? 2);
    const value = Number.parseInt(prices.price, 10) / 10 ** minor;
    return Number.isFinite(value) && value > 0 ? value : null;
}

const median = (values) => {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/* ───────────────────────── sources ───────────────────────── */

/**
 * kamasv.com: one simple product per lot ("10M Kamas Draconiros"), filed under
 * a server category whose parent is the game ("DOFUS TOUCH" › "Kelerog").
 * Price per million = median over the lots of a server.
 */
export function parseKamasv(products, categories) {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const perServer = new Map();

    const rootOf = (category) => {
        let current = category;
        for (let depth = 0; current?.parent && depth < 5; depth += 1) current = byId.get(current.parent) ?? null;
        return current;
    };

    for (const product of products) {
        const lot = String(product.name ?? "").match(/^\s*(\d+(?:[.,]\d+)?)\s*M\b/i);
        if (!lot || product.is_in_stock === false) continue;

        let code = null;
        for (const ref of product.categories ?? []) {
            const category = byId.get(ref.id);
            if (!category?.parent) continue;
            code = matchServer(gameFromTitle(rootOf(category)?.name ?? ""), category.name);
            if (code) break;
        }
        const price = priceFromStoreApi(product.prices);
        const millions = Number.parseFloat(lot[1].replace(",", "."));
        if (!code || price === null || !(millions > 0)) continue;

        if (!perServer.has(code)) perServer.set(code, []);
        perServer.get(code).push(price / millions);
    }

    return Object.fromEntries([...perServer].map(([code, values]) => [code, round4(median(values))]));
}

/**
 * 1kamas.com: one variable product per game ("Kamas Dofus Touch"), one
 * variation per server, priced per million.
 */
export function kamasVariationTargets(products) {
    const targets = [];
    for (const product of products) {
        const game = gameFromTitle(product.name);
        if (!game || product.type !== "variable") continue;
        for (const variation of product.variations ?? []) {
            const code = matchServer(game, variation.attributes?.[0]?.value);
            if (code && !targets.some((target) => target.code === code)) targets.push({ id: variation.id, code });
        }
    }
    return targets;
}

/**
 * leskamas.com « vendre des kamas »: one HTML table, a colspan row per game
 * ("Dofus Touch Kamas") then one row per server: name, Paypal €/M, …, status.
 * The Paypal/SEPA column is the payout in EUR per million.
 */
export function parseLeskamas(html) {
    const table = String(html ?? "").match(/<table[^>]*hovertable[\s\S]*?<\/table>/i)?.[0] ?? "";
    const prices = {};
    let game = null;

    for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)].map(([, attrs, inner]) => ({
            attrs,
            text: decodeEntities(inner.replace(/<[^>]*>/g, "")).trim(),
        }));
        if (cells.length === 1 && /colspan/i.test(cells[0].attrs)) {
            game = gameFromTitle(cells[0].text);
            continue;
        }
        if (cells.length < 2) continue;

        const code = matchServer(game, cells[0].text);
        const price = Number.parseFloat(cells[1].text.replace(",", "."));
        if (code && /€\s*\/\s*M/i.test(cells[1].text) && price > 0) prices[code] = round4(price);
    }
    return prices;
}

const round4 = (value) => (value === null ? null : Math.round(value * 10_000) / 10_000);

async function fetchAllPages(fetchJson, url) {
    const first = await fetchJson(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=1`);
    const items = [...first.data];
    for (let page = 2; page <= Math.min(first.totalPages, 20); page += 1) {
        await sleep(REQUEST_GAP_MS);
        items.push(...(await fetchJson(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`)).data);
    }
    return items;
}

const readers = {
    async leskamas({ fetchText }, base) {
        return parseLeskamas(await fetchText(`${base}/vendre-des-kamas.html`));
    },
    async kamasv({ fetchJson }, base) {
        const categories = await fetchAllPages(fetchJson, `${base}/wp-json/wc/store/v1/products/categories`);
        const products = await fetchAllPages(fetchJson, `${base}/wp-json/wc/store/v1/products`);
        return parseKamasv(products, categories);
    },
    async "1kamas"({ fetchJson }, base) {
        const products = await fetchAllPages(fetchJson, `${base}/wp-json/wc/store/v1/products`);
        const prices = {};
        for (const { id, code } of kamasVariationTargets(products)) {
            await sleep(REQUEST_GAP_MS);
            const { data } = await fetchJson(`${base}/wp-json/wc/store/v1/products/${id}`);
            const price = data?.is_in_stock === false ? null : priceFromStoreApi(data?.prices);
            if (price !== null) prices[code] = round4(price);
        }
        return prices;
    },
};

/* ───────────────────────── reference ───────────────────────── */

/**
 * Merge the shops into one reference per server and apply the jump guard: a
 * price moving more than 50 % is held as `pending` until a second fetch
 * confirms it (within 10 %), so one broken page cannot reprice the shop.
 */
export function buildReference(bySource, previous = {}, pending = {}) {
    const reference = {};
    const nextPending = {};
    const held = [];

    const codes = new Set(Object.values(bySource).flatMap((prices) => Object.keys(prices)));
    for (const code of codes) {
        const sources = {};
        for (const [source, prices] of Object.entries(bySource)) {
            if (Number.isFinite(prices[code]) && prices[code] > 0) sources[source] = prices[code];
        }
        const eur = round4(median(Object.values(sources)));
        if (eur === null) continue;

        const before = previous[code]?.eur;
        const jumped = Number.isFinite(before) && Math.abs(eur - before) / before > MAX_JUMP;
        const confirmed = Number.isFinite(pending[code]) && Math.abs(eur - pending[code]) / pending[code] <= 0.1;

        if (jumped && !confirmed) {
            reference[code] = previous[code];
            nextPending[code] = eur;
            held.push(code);
        } else {
            reference[code] = { eur, sources };
        }
    }

    // A server no shop lists any more keeps its last known price.
    for (const [code, entry] of Object.entries(previous)) {
        if (!reference[code]) reference[code] = entry;
    }

    return { reference, pending: nextPending, held };
}

/* ───────────────────────── runner ───────────────────────── */

let timer = null;
let inFlight = null;

/** Fetch every source, update market.json. Never throws. */
export async function runPriceFeed({
    client = null,
    fetchJson = defaultFetchJson,
    fetchText = defaultFetchText,
    sources = SOURCES,
} = {}) {
    if (inFlight) return inFlight;

    inFlight = (async () => {
        const byKind = { retail: {}, payout: {} };
        const errors = [];

        for (const source of sources) {
            try {
                const prices = await readers[source.id]({ fetchJson, fetchText }, source.base);
                if (Object.keys(prices).length) byKind[source.kind ?? "retail"][source.id] = prices;
                else errors.push(`${source.label} : aucun prix reconnu`);
            } catch (error) {
                // fetch hides the reason behind "fetch failed": show ECONNREFUSED, ENOTFOUND, etc.
                const cause = error.cause?.code ?? error.cause?.message;
                errors.push(`${source.label} : ${error.message}${cause ? ` (${cause})` : ""}`);
            }
        }

        const now = new Date().toISOString();
        const feed = read("market.json").feed ?? {};
        const lastError = errors.length ? errors.join(" • ") : null;

        if (!Object.keys(byKind.retail).length && !Object.keys(byKind.payout).length) {
            update("market.json", (data) => {
                data.feed = { ...(data.feed ?? {}), lastAttemptAt: now, lastError };
                return true;
            });
            console.warn(`[price-feed] aucune source disponible — ${lastError}`);
            return { ok: false, changed: 0, errors, held: [] };
        }

        // A kind with no working source this round keeps its previous prices untouched.
        const retail = buildReference(byKind.retail, feed.reference ?? {}, feed.pending ?? {});
        const payout = buildReference(byKind.payout, feed.sellReference ?? {}, feed.sellPending ?? {});
        const changedIn = (next, previous = {}) =>
            Object.keys(next).filter((code) => next[code]?.eur !== previous[code]?.eur).length;
        const changed = changedIn(retail.reference, feed.reference) + changedIn(payout.reference, feed.sellReference);
        const held = [...retail.held, ...payout.held.map((code) => `${code} (rachat)`)];

        update("market.json", (data) => {
            data.feed = {
                ...(data.feed ?? {}),
                reference: retail.reference,
                pending: retail.pending,
                sellReference: payout.reference,
                sellPending: payout.pending,
                lastAttemptAt: now,
                fetchedAt: now,
                lastError,
            };
            if (changed) data.updatedAt = now;
            return true;
        });

        console.info(
            `[price-feed] ${Object.keys(retail.reference).length} prix de vente, ` +
                `${Object.keys(payout.reference).length} prix de rachat, ${changed} modifié(s)` +
                `${held.length ? `, en attente de confirmation : ${held.join(", ")}` : ""}` +
                `${lastError ? ` — ${lastError}` : ""}`,
        );

        if (changed && client) refreshMarketDisplays(client);
        return { ok: true, changed, errors, held };
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
}

export function startPriceFeed(client) {
    if (SETTINGS.priceFeed === "off" || timer) return false;
    const everyMs = SETTINGS.priceFeedIntervalMin * 60_000;
    void runPriceFeed({ client });
    timer = setInterval(() => void runPriceFeed({ client }), everyMs);
    timer.unref?.();
    console.info(
        `[price-feed] actif — ${SOURCES.map((source) => source.label).join(" + ")}, toutes les ${SETTINGS.priceFeedIntervalMin} min`,
    );
    return true;
}

export const priceFeedRunning = () => timer !== null;

export function stopPriceFeed() {
    if (timer) clearInterval(timer);
    timer = null;
}
