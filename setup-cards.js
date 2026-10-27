const {
    initializeApp,
    cert
} = require("firebase-admin/app");

const {
    getFirestore
} = require("firebase-admin/firestore");

const fs = require("fs");

const serviceAccount =
    require("./serviceAccountKey.json");


initializeApp({
    credential:
        cert(serviceAccount)
});


const db =
    getFirestore();


const cardIds =
    fs.readFileSync(
        "./qr-codes/card-ids.txt",
        "utf8"
    )
    .split(/\r?\n/)
    .map(id => id.trim())
    .filter(Boolean);


async function setupCards() {

    let added = 0;
    let skipped = 0;

    const batch =
        db.batch();

    for (const cardId of cardIds) {

        const cardRef =
            db.collection("cards")
                .doc(cardId);

        const cardSnap =
            await cardRef.get();

        if (cardSnap.exists) {

            skipped++;

            console.log(
                `Skipping existing card: ${cardId}`
            );

            continue;
        }

        batch.set(
            cardRef,
            {
                destination: "",
                active: false
            }
        );

        added++;
    }

    if (added > 0) {
        await batch.commit();
    }

    console.log("");
    console.log(
        `New cards added: ${added}`
    );

    console.log(
        `Existing cards skipped: ${skipped}`
    );

    console.log(
        "Card setup complete."
    );
}


setupCards()
    .catch(error => {

        console.error(
            "Error setting up cards:",
            error
        );

        process.exit(1);
    });