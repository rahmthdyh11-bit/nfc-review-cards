const crypto = require("crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function sendJson(res, status, body) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(status).json(body);
}

function getDatabase() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");
    }

    if (getApps().length === 0) {
        initializeApp({
            credential: cert(JSON.parse(serviceAccountJson))
        });
    }

    return getFirestore();
}

function isAllowedGoogleLink(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    if (url.protocol !== "https:" || url.username || url.password || url.port) {
        return false;
    }

    return (
        ((url.hostname === "www.google.com" || url.hostname === "google.com") &&
            url.pathname === "/search" &&
            url.search.length > 1) ||
        (url.hostname === "search.google.com" &&
            url.pathname === "/local/writereview" &&
            url.search.length > 1) ||
        (url.hostname === "g.page" &&
            /^\/r\/[^/]+\/review\/?$/.test(url.pathname)) ||
        (url.hostname === "maps.app.goo.gl" && url.pathname.length > 1)
    );
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendJson(res, 405, { error: "Metode tidak diizinkan." });
    }

    const body = typeof req.body === "string"
        ? (() => {
            try {
                return JSON.parse(req.body);
            } catch {
                return null;
            }
        })()
        : req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(res, 400, { error: "Data aktivasi tidak valid." });
    }

    const {
        cardId,
        activationPassword,
        shopName,
        shopLocation,
        destination
    } = body;

    if (
        typeof cardId !== "string" ||
        !/^[A-HJ-NP-Z2-9]{6}$/.test(cardId) ||
        typeof activationPassword !== "string" ||
        activationPassword.length < 12 ||
        activationPassword.length > 128 ||
        typeof shopName !== "string" ||
        shopName.trim().length < 2 ||
        shopName.trim().length > 100 ||
        (shopLocation !== undefined &&
            (typeof shopLocation !== "string" || shopLocation.trim().length > 100)) ||
        typeof destination !== "string" ||
        !isAllowedGoogleLink(destination)
    ) {
        return sendJson(res, 400, { error: "Periksa kembali password dan data aktivasi." });
    }

    try {
        const expectedPassword = process.env.ACTIVATION_PASSWORD;
        if (!expectedPassword || expectedPassword.length < 16) {
            throw new Error("ACTIVATION_PASSWORD must be configured with at least 16 characters.");
        }

        const providedBuffer = Buffer.from(activationPassword, "utf8");
        const expectedBuffer = Buffer.from(expectedPassword, "utf8");
        if (
            providedBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
        ) {
            return sendJson(res, 403, { error: "Password aktivasi salah." });
        }

        const db = getDatabase();
        const cardRef = db.collection("cards").doc(cardId);
        const destinationRef = db.collection("cardDestinations").doc(cardId);

        const result = await db.runTransaction(async transaction => {
            const cardSnap = await transaction.get(cardRef);
            if (!cardSnap.exists) {
                return "not-found";
            }

            const card = cardSnap.data();
            if (card.active === true || card.destination) {
                return "already-active";
            }

            transaction.update(cardRef, {
                shopName: shopName.trim(),
                shopLocation: typeof shopLocation === "string" ? shopLocation.trim() : "",
                destination,
                active: true
            });
            transaction.set(destinationRef, {
                active: true,
                destination
            });

            return "activated";
        });

        if (result === "not-found") {
            return sendJson(res, 404, { error: "Kartu belum didaftarkan. Hubungi admin." });
        }
        if (result === "already-active") {
            return sendJson(res, 409, { error: "Kartu sudah aktif. Hubungi admin jika perlu bantuan." });
        }

        return sendJson(res, 200, { ok: true });
    } catch (error) {
        console.error("Card activation API failed:", error);
        return sendJson(res, 500, { error: "Aktivasi gagal sementara. Silakan coba lagi nanti." });
    }
};
