import "dotenv/config";
import stripe from "../config/stripe.js";
import { MongoClient } from "mongodb";

const email = process.argv[2];
const userId = process.argv[3];
const name = process.argv[4] || "Webhook Tester";

if (!email || !userId) {
    console.error("usage: node scripts/test-webhook.js <email> <userId> [name]");
    process.exit(1);
}

const sessionObject = {
    id: "cs_test_webhook_" + Date.now(),
    object: "checkout.session",
    mode: "payment",
    currency: "usd",
    amount_total: 1000,
    payment_status: "paid",
    payment_intent: "pi_test_" + Date.now(),
    customer: null,
    customer_email: email,
    client_reference_id: userId,
    metadata: {
        userId,
        userEmail: email,
        userRole: "student",
        planName: "Student Pro",
        planId: "student_pro",
    },
};

const payload = JSON.stringify({
    id: "evt_test_" + Date.now(),
    object: "event",
    type: "checkout.session.completed",
    data: { object: sessionObject },
});

const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
});

const post = async (body, sig) => {
    const res = await fetch("http://localhost:5000/payments/webhook", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "stripe-signature": sig ?? signature,
        },
        body,
    });
    return { status: res.status, body: await res.text() };
};

const first = await post(payload);
console.log("webhook#1 status=" + first.status + " body=" + first.body);

const replay = await post(payload);
console.log("webhook#2 (replay) status=" + replay.status + " body=" + replay.body);

const tamperedPayload = payload.replace("1000", "1");
const tamperedSig = stripe.webhooks.generateTestHeaderString({
    payload: tamperedPayload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
});
const bad = await post(tamperedPayload, tamperedSig);
console.log("webhook#3 (wrong amount) status=" + bad.status + " body=" + bad.body);

const forged = await post(payload, "t=1,v1=deadbeef");
console.log("webhook#4 (bad signature) status=" + forged.status + " body=" + forged.body);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db("mentorlagbeDB");

const user = await db.collection("user").findOne({ email });
console.log("user.plan=" + user?.plan + " planUpdatedAt=" + user?.planUpdatedAt);

const payments = await db
    .collection("payments")
    .find({ userEmail: email })
    .sort({ createdAt: -1 })
    .toArray();
console.log("payments count=" + payments.length);
for (const p of payments) {
    console.log(
        "payment: status=" + p.paymentStatus +
        " plan=" + p.planName +
        " amount=" + p.amount + p.currency +
        " txn=" + p.transactionId +
        " session=" + p.stripeSessionId +
        " paidAt=" + p.paidAt +
        " createdAt=" + p.createdAt
    );
}

await client.close();
