const MAX_QUERY_LENGTH = 120;
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

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendJson(res, 405, { error: "Metode tidak diizinkan." });
    }

    const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
        return sendJson(res, 400, { error: "Masukkan nama bisnis 2-120 karakter." });
    }

    let timeout;
    try {
        const upstreamUrl = getUpstreamUrl();
        upstreamUrl.searchParams.set("action", "search");
        upstreamUrl.searchParams.set("q", query);

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        const response = await fetch(upstreamUrl, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Business search upstream returned HTTP ${response.status}.`);
        }

        const data = await response.json();
        return sendJson(res, 200, normalizeResults(data));
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
