const crypto = require("crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function sendJson(res, status, body) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(status).json(body);
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

function isValidCardId(cardId) {
    return typeof cardId === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(cardId);
}

function passwordsMatch(provided, expected) {
    const providedBuffer = Buffer.from(provided, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return providedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

module.exports = async function handler(req, res) {
    try {
        const db = getDatabase();

        if (req.method === "GET") {
            const cardId = typeof req.query?.code === "string" ? req.query.code : "";
            if (!isValidCardId(cardId)) {
                return sendJson(res, 400, { error: "Kode kartu tidak valid." });
            }

            const cardSnap = await db.collection("cards").doc(cardId).get();
            if (!cardSnap.exists) {
                return sendJson(res, 404, { error: "Kartu belum didaftarkan. Hubungi admin." });
            }

            const card = cardSnap.data();
            return sendJson(res, 200, {
                verified: card.active !== true && card.activationPasswordVerified === true
            });
        }

        if (req.method !== "POST") {
            res.setHeader("Allow", "GET, POST");
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

        const cardId = body?.cardId;
        const activationPassword = body?.activationPassword;
        if (
            !isValidCardId(cardId) ||
            typeof activationPassword !== "string" ||
            activationPassword.length < 12 ||
            activationPassword.length > 128
        ) {
            return sendJson(res, 400, { error: "Masukkan password aktivasi yang valid." });
        }

        const expectedPassword = process.env.ACTIVATION_PASSWORD;
        if (!expectedPassword || expectedPassword.length < 16) {
            throw new Error("ACTIVATION_PASSWORD must be configured with at least 16 characters.");
        }
        if (!passwordsMatch(activationPassword, expectedPassword)) {
            return sendJson(res, 403, { error: "Password aktivasi salah." });
        }

        const cardRef = db.collection("cards").doc(cardId);
        const result = await db.runTransaction(async transaction => {
            const cardSnap = await transaction.get(cardRef);
            if (!cardSnap.exists) {
                return "not-found";
            }

            const card = cardSnap.data();
            if (card.active === true || card.destination) {
                return "already-active";
            }

            transaction.update(cardRef, { activationPasswordVerified: true });
            return "verified";
        });

        if (result === "not-found") {
            return sendJson(res, 404, { error: "Kartu belum didaftarkan. Hubungi admin." });
        }
        if (result === "already-active") {
            return sendJson(res, 409, { error: "Kartu sudah aktif. Hubungi admin jika perlu bantuan." });
        }

        return sendJson(res, 200, { ok: true });
    } catch (error) {
        console.error("Card activation verification failed:", error);
        return sendJson(res, 500, { error: "Tidak dapat memeriksa aktivasi. Silakan coba lagi nanti." });
    }
};
