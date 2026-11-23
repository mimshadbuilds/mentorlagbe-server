import "dotenv/config";
import stripe from "../config/stripe.js";

const session = await stripe.checkout.sessions.retrieve(process.argv[2]);
console.log(
    JSON.stringify(
        {
            id: session.id,
            mode: session.mode,
            status: session.status,
            payment_status: session.payment_status,
            amount_total: session.amount_total,
            currency: session.currency,
            customer_email: session.customer_email,
            client_reference_id: session.client_reference_id,
            metadata: session.metadata,
            payment_intent: session.payment_intent,
        },
        null,
        1
    )
);
