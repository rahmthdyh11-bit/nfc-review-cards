const MAX_QUERY_LENGTH = 120;
const MAX_MAPS_URL_LENGTH = 2048;
const MAX_RESULTS = 20;
const UPSTREAM_TIMEOUT_MS = 8000;

function sendJson(res, status, body) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(status).json(body);
}

function getUpstreamUrl() {
    const configuredUrl = process.env.BUSINESS_SEARCH_API_URL;
    if (!configuredUrl) {
        throw new Error("BUSINESS_SEARCH_API_URL is not configured.");
    }

    const url = new URL(configuredUrl);
    if (
        url.protocol !== "https:" ||
        url.hostname !== "script.google.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)
    ) {
        throw new Error("BUSINESS_SEARCH_API_URL is not a valid Apps Script endpoint.");
    }

    return url;
}

function normalizeBusiness(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
    }

    return {
        name: typeof item.name === "string" ? item.name.slice(0, 200) : "",
        address: typeof item.address === "string" ? item.address.slice(0, 500) : "",
        placeId: typeof item.placeId === "string" ? item.placeId.slice(0, 500) : "",
        place_id: typeof item.place_id === "string" ? item.place_id.slice(0, 500) : "",
        id: typeof item.id === "string" ? item.id.slice(0, 500) : ""
    };
}

function normalizeResults(data) {
    if (!Array.isArray(data)) {
        throw new Error("Business search returned an invalid response.");
    }

    return data.slice(0, MAX_RESULTS)
        .map(normalizeBusiness)
        .filter(Boolean);
}

function isAllowedMapsUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        (
            url.hostname === "maps.app.goo.gl" ||
            url.hostname === "maps.google.com" ||
            ((url.hostname === "www.google.com" || url.hostname === "google.com") &&
                url.pathname.startsWith("/maps"))
        )
    );
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendJson(res, 405, { error: "Metode tidak diizinkan." });
    }

    const action = typeof req.query?.action === "string" ? req.query.action : "search";
    if (action !== "search" && action !== "resolveMapsLink") {
        return sendJson(res, 400, { error: "Jenis pencarian tidak valid." });
    }

    const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";
    const mapsUrl = typeof req.query?.url === "string" ? req.query.url.trim() : "";
    if (
        (action === "search" && (query.length < 2 || query.length > MAX_QUERY_LENGTH)) ||
        (action === "resolveMapsLink" &&
            (mapsUrl.length > MAX_MAPS_URL_LENGTH || !isAllowedMapsUrl(mapsUrl)))
    ) {
        return sendJson(res, 400, {
            error: action === "search"
                ? "Masukkan nama bisnis 2-120 karakter."
                : "Masukkan link Google Maps yang valid."
        });
    }

    let timeout;
    try {
        const upstreamUrl = getUpstreamUrl();
        upstreamUrl.searchParams.set("action", action);
        if (action === "search") {
            upstreamUrl.searchParams.set("q", query);
        } else {
            upstreamUrl.searchParams.set("url", mapsUrl);
        }

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        const response = await fetch(upstreamUrl, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Business search upstream returned HTTP ${response.status}.`);
        }

        const data = await response.json();
        if (action === "search") {
            return sendJson(res, 200, normalizeResults(data));
        }

        const candidates = Array.isArray(data) ? data : [data];
        const result = candidates
            .map(normalizeBusiness)
            .find(item => item && (item.placeId || item.place_id || item.id));
        return sendJson(res, 200, result || {});
    } catch (error) {
        console.error("Business search API failed:", error);
        const isTimeout = error.name === "AbortError";
        return sendJson(
            res,
            isTimeout ? 504 : 502,
            { error: isTimeout ? "Pencarian bisnis terlalu lama. Coba lagi." : "Pencarian bisnis sedang tidak tersedia." }
        );
    } finally {
        clearTimeout(timeout);
    }
};
