
import "dotenv/config";
import { MongoClient } from "mongodb";

const email = process.argv
    .find((arg) => arg.startsWith("--email="))
    ?.split("=")[1]
    ?.trim()
    .toLowerCase();

    if (!email) {
        console.error("Please provide an email: npm run make-admin -- --email=user@example.com");
        process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

const makeAdmin = async () => {
    try {
        await client.connect();

        const db = client.db("mentorlagbeDB");
        const usersCollection = db.collection("user");

        const result = await usersCollection.updateOne(
        { email },
        { $set: { role: "admin" } }
        );

        if (result.matchedCount === 0) {
        console.error(`No user found with email: ${email}`);
        return;
        }

        if (result.modifiedCount === 0) {
        console.log(`${email} already has admin access.`);
        return;
    }

    console.log(`Successfully promoted ${email} to admin.`);
    } catch (error) {
        console.error("Failed to make admin:", error);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
};

makeAdmin();
