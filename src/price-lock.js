import { CURRENCY_CODES } from "../config.js";
import { effectiveRate } from "./market.js";

/**
 * 🔒 Prix bloqué. The price a customer sees when they pick their server is held
 * for QUOTE_LOCK_MIN while they fill in the form; once the ticket is open its
 * price is guaranteed for TICKET_LOCK_HOURS (the ticket stores it).
 *
 * The lock only ever helps the customer: if our price moves in their favour
 * meanwhile, they get the new one. Quotes live in memory: a restart simply
 * means the current price is used.
 */

export const QUOTE_LOCK_MIN = 15;
export const TICKET_LOCK_HOURS = 2;

const quotes = new Map();
const quoteKey = (userId, kind, serverCode) => `${userId}:${kind}:${serverCode}`;

function liveQuote(userId, kind, serverCode, now) {
    const entry = quotes.get(quoteKey(userId, kind, serverCode));
    if (!entry) return null;
    if (now - entry.at > QUOTE_LOCK_MIN * 60_000) {
        quotes.delete(quoteKey(userId, kind, serverCode));
        return null;
    }
    return entry;
}

/** Hold today's prices for this customer, unless a hold is already running. Returns its expiry (ms). */
export function lockQuote(userId, kind, serverCode, now = Date.now()) {
    const existing = liveQuote(userId, kind, serverCode, now);
    if (existing) return existing.at + QUOTE_LOCK_MIN * 60_000;
    const rates = Object.fromEntries(CURRENCY_CODES.map((code) => [code, effectiveRate(code, kind, serverCode)]));
    if (Object.values(rates).every((rate) => rate === null)) return null;
    quotes.set(quoteKey(userId, kind, serverCode), { rates, at: now });
    return now + QUOTE_LOCK_MIN * 60_000;
}

/** The best of the held price and today's price, from the customer's side. */
export function lockedRate(userId, kind, serverCode, currency, now = Date.now()) {
    const current = effectiveRate(currency, kind, serverCode);
    const held = liveQuote(userId, kind, serverCode, now)?.rates[currency] ?? null;
    if (held === null) return current;
    if (current === null) return held;
    // We sell (buy): lower is better for them. We pay (sell): higher is better.
    return kind === "sell" ? Math.max(held, current) : Math.min(held, current);
}

export function releaseQuote(userId, kind, serverCode) {
    quotes.delete(quoteKey(userId, kind, serverCode));
}

/** "<t:…:t>" — Discord shows it in the reader's own time zone. */
export const discordTime = (ms) => `<t:${Math.floor(ms / 1000)}:t>`;

export const quoteLockLine = (until) =>
    until ? `🔒 **Prix bloqué ${QUOTE_LOCK_MIN} min** pour toi (jusqu'à ${discordTime(until)}) : s'il baisse d'ici là, tu as le nouveau prix.` : null;
