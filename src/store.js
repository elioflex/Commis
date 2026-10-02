import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Overridable so a host with a mounted disk can point DATA_DIR at it (Render,
// Fly.io…), and so tests never touch the real data files.
const DATA_DIR = process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");

const DEFAULTS = {
    "market.json": { updatedAt: null, rates: {}, stock: {} },
    "tickets.json": { counter: 0, open: {}, closed: [] },
    "reviews.json": { entries: [] },
    "panels.json": { posted: {} },
    "alerts.json": { users: {} },
    "watches.json": { users: {} },
    "offers.json": { nextId: 1, offers: {} },
};

const cache = new Map();

let writeHook = null;

/**
 * Called after every successful write, with the file name that changed.
 * `persist.js` uses it to keep its off-site snapshot up to date, which means
 * no feature code ever has to think about persistence.
 */
export function setWriteHook(hook) {
    writeHook = typeof hook === "function" ? hook : null;
}

const filePath = (name) => resolve(DATA_DIR, name);

function seedMissing() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    for (const [name, value] of Object.entries(DEFAULTS)) {
        if (!existsSync(filePath(name))) {
            writeFileSync(filePath(name), `${JSON.stringify(value, null, 2)}\n`);
        }
    }
}

/** Read a data file (cached), returning a defensive copy of the defaults on corruption. */
export function read(name) {
    if (cache.has(name)) return cache.get(name);

    if (!DEFAULTS[name]) throw new Error(`Unknown data file: ${name}`);
    seedMissing();

    let data;
    try {
        data = JSON.parse(readFileSync(filePath(name), "utf8"));
    } catch (error) {
        console.error(`[store] ${name} is unreadable (${error.message}) — falling back to defaults`);
        data = structuredClone(DEFAULTS[name]);
    }

    cache.set(name, data);
    return data;
}

/** Write a data file atomically (temp file + rename). */
export function write(name, data) {
    seedMissing();
    const target = filePath(name);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, target);
    cache.set(name, data);
    writeHook?.(name);
    return data;
}

/** Mutate a data file inside a callback and persist the result. */
export function update(name, mutator) {
    const data = read(name);
    const result = mutator(data);
    write(name, data);
    return result === undefined ? data : result;
}

/** Read a value by dotted path, e.g. `getPath("market.json", "rates.EUR.buy")`. */
export function getPath(name, path, fallback = undefined) {
    let cursor = read(name);
    for (const key of String(path).split(".")) {
        if (cursor === null || typeof cursor !== "object" || !(key in cursor)) return fallback;
        cursor = cursor[key];
    }
    return cursor === undefined ? fallback : cursor;
}

/** Write a value by dotted path, creating intermediate objects. */
export function setPath(name, path, value) {
    return update(name, (data) => {
        const keys = String(path).split(".");
        const last = keys.pop();
        let cursor = data;
        for (const key of keys) {
            if (cursor[key] === null || typeof cursor[key] !== "object") cursor[key] = {};
            cursor = cursor[key];
        }
        cursor[last] = value;
        return value;
    });
}

/** Drop a value by dotted path. Returns true when something was removed. */
export function deletePath(name, path) {
    return update(name, (data) => {
        const keys = String(path).split(".");
        const last = keys.pop();
        let cursor = data;
        for (const key of keys) {
            if (cursor === null || typeof cursor !== "object" || !(key in cursor)) return false;
            cursor = cursor[key];
        }
        if (cursor === null || typeof cursor !== "object" || !(last in cursor)) return false;
        return delete cursor[last];
    });
}

export const files = Object.keys(DEFAULTS);
export { DATA_DIR };
