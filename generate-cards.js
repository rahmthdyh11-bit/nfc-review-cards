const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const BASE_URL = "https://nfc-review-cards-690a6.web.app/";
const TOTAL_CARDS = 100;

const outputDir = path.join(__dirname, "qr-codes");

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

function generateCardId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";

    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }

    return id;
}

const cardIds = new Set();

while (cardIds.size < TOTAL_CARDS) {
    cardIds.add(generateCardId());
}

async function generateQRs() {

    for (const cardId of cardIds) {

        const url = BASE_URL + cardId;
        const filePath = path.join(outputDir, `${cardId}.png`);

        await QRCode.toFile(filePath, url, {
            width: 1000,
            margin: 4,
            errorCorrectionLevel: "H"
        });

        console.log(`${cardId} → ${url}`);
    }

    fs.writeFileSync(
        path.join(outputDir, "card-ids.txt"),
        [...cardIds].join("\n")
    );

    console.log("\n100 QR codes generated successfully.");
}

generateQRs();