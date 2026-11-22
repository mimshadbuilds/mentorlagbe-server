import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { handleImageUpload } from './middlewares/upload.js'
import stripe from "./config/stripe.js";


const app = express()
const port = process.env.PORT || 5000

app.use(cors());

app.use("/payments/webhook",
    express.raw({ type: "application/json" })
);

app.use(express.json());

const betterAuthUrl = process.env.CLIENT_URL

const JWKS = createRemoteJWKSet(
    new URL(`${betterAuthUrl}/api/auth/jwks`)
)

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({
            success: false,
            message: 'Unauthorized'
        })
    }

    const token = authHeader.split(' ')[1]

    if (!token) {
        return res.status(401).send({
            success: false,
            message: 'Unauthorized'
        })
    }

    try {
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: betterAuthUrl,
            audience: betterAuthUrl
        })

        req.user = payload

        next()
    } catch (error) {
        console.error('Token validation failed:', error.message)

        return res.status(401).send({
            success: false,
            message: 'Invalid or expired token'
        })
    }
}
const verifyTutor = async (req, res, next) => {
    try {
        const user = await usersCollection.findOne({
            email: req.user.email
        })

        if (!user) {
            return res.status(404).send({
                success: false,
                message: 'User not found'
            })
        }

        if (user.role !== 'tutor') {
            return res.status(403).send({
                success: false,
                message: 'Forbidden! Tutor access required.'
            })
        }

        req.tutor = user

        next()
    } catch (error) {
        console.error('Tutor verification failed:', error.message)

        return res.status(500).send({
            success: false,
            message: 'Internal server error'
        })
    }
}
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await usersCollection.findOne({
            email: req.user.email
        });

        if (!user) {
            return res.status(404).send({
                success: false,
                message: "User not found."
            });
        }

        if (user.role !== "admin") {
            return res.status(403).send({
                success: false,
                message: "Forbidden! Admin access required."
            });
        }

        req.admin = user;

        next();
    } catch (error) {
        console.error("Admin verification failed:", error.message);

        return res.status(500).send({
            success: false,
            message: "Internal server error."
        });
    }
};
const verifyStudent = async (req, res, next) =>    {
    const user = await usersCollection.findOne({
        email: req.user.email
    });

    if (!user) {
        return res.status(404).send({
            message: "User not found."
        });
    }

    if (user.role !== "student") {
        return res.status(403).send({
            message: "Only students can perform this action."
        });
    }

    req.student = user;
    next();
};

const client = new MongoClient(process.env.MONGODB_URI)

export async function connectToMongoDB() {
    await client.connect()
    console.log("Successfully connected to MongoDB!")
    return client
}

const mongoClient = await connectToMongoDB()
const db = mongoClient.db('mentorlagbeDB')

const usersCollection = db.collection('user')
const tuitionsCollection = db.collection('tuitions')
const applicationsCollection = db.collection('applications')
const paymentsCollection = db.collection('payments')

app.post("/payments/checkout", verifyToken, async (req, res) => {
    try {
        const { plan } = req.body;

        const plans = {
            student_pro: {
                role: "student",
                name: "Student Pro",
                amount: 1000,
            },
            tutor_pro: {
                role: "tutor",
                name: "Tutor Pro",
                amount: 1500,
            },
        };

        if (!plan || !plans[plan]) {
            return res.status(400).send({
                success: false,
                message: "Please select a valid Pro plan.",
            });
        }

        const selectedPlan = plans[plan];

        const user = await usersCollection.findOne({
            email: req.user.email,
        });

        if (!user) {
            return res.status(404).send({
                success: false,
                message: "User not found.",
            });
        }

        if (user.role !== selectedPlan.role) {
            return res.status(403).send({
                success: false,
                message: "You are not authorized to purchase this plan.",
            });
        }

        if (user.plan === "pro") {
            return res.status(409).send({
                success: false,
                message: "You already have an active Pro plan.",
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",

            customer_email: user.email,

            client_reference_id: user.email,

            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: selectedPlan.name,
                            description: "One-time payment for permanent Pro access.",
                        },
                        unit_amount: selectedPlan.amount,
                    },
                    quantity: 1,
                },
            ],

            metadata: {
                userEmail: user.email,
                userName: user.name || "",
                userRole: user.role,
                planName: selectedPlan.name,
                plan: plan,
            },

            payment_intent_data: {
                metadata: {
                    userEmail: user.email,
                    userRole: user.role,
                    plan: plan,
                },
            },

            success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

            cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
        });

        res.status(200).send({
            success: true,
            message: "Checkout session created successfully.",
            sessionId: session.id,
            url: session.url,
        });

    } catch (error) {
        console.error("Stripe checkout creation failed:", error);

        res.status(500).send({
            success: false,
            message: "Failed to create Stripe checkout session.",
        });
    }
});

app.post("/upload/image", verifyToken, handleImageUpload, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send({
            message: "Please select an image to upload.",
            });
        }

        const apiKey = process.env.IMGBB_API_KEY;

        if (!apiKey) {
            return res.status(500).send({
            message: "Image upload service is not configured.",
            });
        }

        const imageBase64 = req.file.buffer.toString("base64");

        const formData = new URLSearchParams();
        formData.append("image", imageBase64);

        const response = await fetch(
            `https://api.imgbb.com/1/upload?key=${apiKey}`,
            {
            method: "POST",
            body: formData,
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            return res.status(502).send({
            message: "Image hosting service failed to upload the image.",
            });
        }

        res.status(201).send({
            message: "Image uploaded successfully.",
            imageUrl: result.data.url,
        });
        } catch (error) {
        res.status(500).send({
            message: "Failed to upload image.",
            error: error.message,
        });
        }
    }
);

//users api
app.get("/users/me", verifyToken, async (req, res) => {
    try {
        const user = await usersCollection.findOne(
        { email: req.user.email },
        {
            projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            phone: 1,
            bio: 1,
            plan: 1,
            createdAt: 1,
            },
        });

        if(!user) {
        return res.status(404).send({
            message: "User not found.",
        });
        }

        res.send({
        message: "Profile retrieved successfully.",
        user,
        });
    } catch (error) {
        res.status(500).send({
        message: "Failed to retrieve profile.",
        error: error.message,
        });
    }
});

app.patch("/users/me", verifyToken, async (req, res) => {
    try {
        const { phone, bio } = req.body;

        if (phone === undefined && bio === undefined) {
        return res.status(400).send({
            message: "At least one profile field is required.",
        });
        }

        if (
        (phone !== undefined && typeof phone !== "string") ||
        (bio !== undefined && typeof bio !== "string")
        ) {
        return res.status(400).send({
            message: "Phone and bio must be strings.",
        });
        }

        const updatedFields = {};

        if (phone !== undefined) {
        updatedFields.phone = phone.trim();
        }

        if (bio !== undefined) {
        updatedFields.bio = bio.trim();
        }

        const result = await usersCollection.updateOne(
        { email: req.user.email },
        {
            $set: updatedFields,
        }
        );

        if (result.matchedCount === 0) {
        return res.status(404).send({
            message: "User not found.",
        });
        }

        const updatedUser = await usersCollection.findOne(
        { email: req.user.email },
        {
            projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            phone: 1,
            bio: 1,
            plan: 1,
            createdAt: 1,
            },
        }
        );

        res.send({
        message: "Profile updated successfully.",
        user: updatedUser,
        });
    } catch (error) {
        res.status(500).send({
        message: "Failed to update profile.",
        error: error.message,
        });
    }
});


//tuitions api
app.post('/tuitions', verifyToken, verifyTutor, async (req, res) => {
    try {
        const { title, subject, classLevel, mode, location, monthlyFee, daysPerWeek, bannerImage, description } = req.body

        if (
            !title?.trim() ||
            !subject?.trim() ||
            !classLevel?.trim() ||
            !mode ||
            !description?.trim()
        ) {
            return res.status(400).send({
                success: false,
                message: 'Please provide all required tuition information.'
            })
        }

        if (!['Online', 'Offline'].includes(mode)) {
            return res.status(400).send({
                success: false,
                message: 'Invalid tuition mode.'
            })
        }

        if (mode === 'Offline' && !location?.trim()) {
            return res.status(400).send({
                success: false,
                message: 'Location is required for offline tuition.'
            })
        }

        if (
            !Number.isFinite(monthlyFee) ||
            monthlyFee <= 0 ||
            !Number.isInteger(daysPerWeek) ||
            daysPerWeek < 1 ||
            daysPerWeek > 7
        ) {
            return res.status(400).send({
                success: false,
                message: 'Please provide a valid monthly fee and days per week.'
            })
        }

        const tutor = req.tutor

        if (tutor.plan !== 'pro') {
            const totalTuitions = await tuitionsCollection.countDocuments({
                tutorEmail: tutor.email
            })

            if (totalTuitions >= 2) {
                return res.status(403).send({
                    success: false,
                    message: 'Free tutors can create a maximum of 2 tuition posts. Upgrade to Pro for unlimited posts.'
                })
            }
        }

        const tuition = {
            title: title.trim(),
            subject: subject.trim(),
            classLevel: classLevel.trim(),
            mode,
            location: location?.trim() || '',
            monthlyFee,
            daysPerWeek,
            bannerImage: bannerImage?.trim() || '',
            description: description.trim(),
            tutorName: tutor.name,
            tutorEmail: tutor.email,
            approvalStatus: 'pending',
            isActive: true,
            createdAt: new Date()
        }

        const result = await tuitionsCollection.insertOne(tuition)

        res.status(201).send({
            success: true,
            message: 'Tuition created successfully. Waiting for admin approval.',
            data: {
                _id: result.insertedId,
                ...tuition
            }
        })

    } catch (error) {
        console.error('Tuition creation failed:', error.message)

        res.status(500).send({
            success: false,
            message: 'Internal server error.'
        })
    }
})

app.get("/tuitions", async (req, res) => {
    try {
        const { q, subject, classLevel, mode } = req.query;

        const query = {
            approvalStatus: "approved",
            isActive: true,
        };

        if (subject) {
            query.subject = subject;
        }

        if (classLevel) {
            query.classLevel = classLevel;
        }

        if (mode) {
            query.mode = mode;
        }

        if (q) {
            const escapedSearch = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const searchRegex = new RegExp(escapedSearch, "i");

            query.$or = [
                { title: searchRegex },
                { subject: searchRegex },
                { classLevel: searchRegex },
            ];
        }

        const result = await tuitionsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch tuitions:", error);

        res.status(500).send({
            message: "Failed to fetch tuition listings.",
        });
    }
});

app.get("/tuitions/my", verifyToken, verifyTutor, async (req, res) => {
    try {
        const result = await tuitionsCollection
            .find({ tutorEmail: req.tutor.email })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch tutor tuitions:", error);

        res.status(500).send({
            message: "Failed to fetch your tuition listings.",
        });
    }
});

app.get("/tuitions/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                message: "Invalid tuition ID.",
            });
        }

        const result = await tuitionsCollection.findOne({
            _id: new ObjectId(id),
            approvalStatus: "approved",
            isActive: true,
        });

        if (!result) {
            return res.status(404).send({
                message: "Tuition listing not found.",
            });
        }

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch tuition:", error);

        res.status(500).send({
            message: "Failed to fetch tuition details.",
        });
    }
});

app.patch("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
    const { id } = req.params;

    try {
        if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid tuition ID." });
        }

    const { title, subject, classLevel, mode, location, monthlyFee, daysPerWeek, bannerImage, description } = req.body;

    const updatedTuition = { title, subject, classLevel, mode, location, monthlyFee, daysPerWeek, bannerImage, description };

    const result = await tuitionsCollection.updateOne(
        { 
            _id: new ObjectId(id),
            tutorEmail: req.tutor.email,
            },
        {
            $set: updatedTuition,
        }
        );

        if (result.matchedCount === 0) {
        return res.status(404).send({
            message: "Tuition not found or you are not authorized to update it.",
        });
        }

        res.status(200).send({
        message: "Tuition updated successfully.",
        modifiedCount: result.modifiedCount,
        });
    } catch (error) {
    console.error("Failed to update tuition:", error);

    res.status(500).send({
    message: "Failed to update tuition.",
    });
    }
});

app.delete("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
    const { id } = req.params;

    try {
        if(!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid tuition ID." });
    }

    const result = await tuitionsCollection.deleteOne({
        _id: new ObjectId(id), 
        tutorEmail: req.tutor.email,
    });

    if (result.deletedCount === 0) {
        return res.status(404).send({
        message: "Tuition not found or you are not authorized to delete it.",
    });
    }

    res.status(200).send({
        message: "Tuition deleted successfully." });
    } catch(error) {
    console.error("Failed to delete tuition:", error);

    res.status(500).send({
        message: "Failed to delete tuition.",
    });
    }
});

app.patch("/tuitions/:id/status", verifyToken, verifyTutor, async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;

    try {
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid tuition ID." });
    }

        if (typeof isActive !== "boolean") {
        return res.status(400).send({
            message: "isActive must be a boolean.",
        });
        }

    const result = await tuitionsCollection.updateOne(
        {
            _id: new ObjectId(id),
            tutorEmail: req.tutor.email,
        },
        {
            $set: { isActive },
        }
    );

        if (result.matchedCount === 0) {
        return res.status(404).send({
            message: "Tuition not found or you are not authorized to update it.",
        });
        }

    res.status(200).send({
        message: `Tuition ${isActive ? "activated" : "deactivated"} successfully.`,
    });
    } catch(error) {
    console.error("Failed to update tuition status:", error);

    res.status(500).send({
        message: "Failed to update tuition status.",
        });
    }
});

//applications api
app.post("/applications", verifyToken, verifyStudent, async (req, res) => {
    try {
        const { tuitionId, preferredSchedule, studentNote } = req.body;

        if(!tuitionId || !ObjectId.isValid(tuitionId)) {
            return res.status(400).send({
                message: "Valid tuition ID is required."
            });
        }

        if(!preferredSchedule?.trim()) {
            return res.status(400).send({
                message: "Preferred schedule is required."
            });
        }

        const tuition = await tuitionsCollection.findOne({
            _id: new ObjectId(tuitionId),
            approvalStatus: "approved",
            isActive: true
            });

        if(!tuition) {
            return res.status(404).send({
                message: "Tuition listing not found or unavailable."
            });
        }

        const existingApplication = await applicationsCollection.findOne({
            tuitionId: tuition._id.toString(),
            studentEmail: req.student.email
        });

        if(existingApplication) {
            return res.status(409).send({
                message: "You have already applied for this tuition."
            });
        }

        const application = {
            tuitionId: tuition._id.toString(),
            tuitionTitle: tuition.title,
            subject: tuition.subject,
            monthlyFee: tuition.monthlyFee,
            tutorEmail: tuition.tutorEmail,
            studentName: req.student.name,
            studentEmail: req.student.email,
            studentPhone: req.student.phone || "",
            preferredSchedule: preferredSchedule.trim(),
            studentNote: studentNote?.trim() || "",
            status: "pending",
            appliedAt: new Date()
        };

        const result = await applicationsCollection.insertOne(application);

        res.status(201).send({
            message: "Application submitted successfully.",
            insertedId: result.insertedId
        });
    } catch (error) {
        console.error("Failed to submit application:", error);

        res.status(500).send({
            message: "Failed to submit application."
        });
    }
});

app.get("/applications/tutor", verifyToken, verifyTutor, async (req, res) => {
    try {
        const result = await applicationsCollection.find({ 
            tutorEmail: req.tutor.email })
            .sort({ appliedAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch tutor applications:", error);

        res.status(500).send({
            message: "Failed to fetch applications."
        });
    }
});

app.get("/applications/student", verifyToken, verifyStudent, async (req, res) => {
    try {
        const result = await applicationsCollection.find({ studentEmail: req.student.email })
            .sort({ appliedAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch student applications:", error);

        res.status(500).send({
            message: "Failed to fetch applications."
        });
    }
});

app.patch("/applications/:id/status", verifyToken, verifyTutor, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                message: "Invalid application ID."
            });
        }

        if (!["accepted", "rejected"].includes(status)) {
            return res.status(400).send({
                message: "Status must be accepted or rejected."
            });
        }

        const result = await applicationsCollection.updateOne(
            {
                _id: new ObjectId(id),
                tutorEmail: req.tutor.email,
                status: "pending"
            },
            {
                $set: { status }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: "Pending application not found or you are not authorized to update it."
            });
        }

        res.status(200).send({
            message: `Application ${status} successfully.`
        });
    } catch (error) {
        console.error("Failed to update application status:", error);

        res.status(500).send({
            message: "Failed to update application status."
        });
    }
});

app.delete("/applications/:id", verifyToken, verifyStudent, async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                message: "Invalid application ID."
            });
        }

        const result = await applicationsCollection.deleteOne({
            _id: new ObjectId(id),
            studentEmail: req.student.email,
            status: "pending"
        });

        if (result.deletedCount === 0) {
            return res.status(404).send({
                message: "Pending application not found or you are not authorized to cancel it."
            });
        }

        res.status(200).send({
            message: "Application cancelled successfully."
        });
    } catch (error) {
        console.error("Failed to cancel application:", error);

        res.status(500).send({
            message: "Failed to cancel application."
        });
    }
});


//admin api
app.get("/admin/tuitions", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { status } = req.query;

        const query = {};

        if (status) {
            if (!["pending", "approved", "rejected"].includes(status)) {
                return res.status(400).send({
                    message: "Invalid tuition approval status."
                });
            }

            query.approvalStatus = status;
        }

        const result = await tuitionsCollection.find(query)
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch admin tuitions:", error);

        res.status(500).send({
            message: "Failed to fetch tuition listings."
        });
    }
});

app.patch("/admin/tuitions/:id/approval", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { approvalStatus } = req.body;

    try {
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                message: "Invalid tuition ID."
            });
        }

        if (!["approved", "rejected"].includes(approvalStatus)) {
            return res.status(400).send({
                message: "approvalStatus must be approved or rejected."
            });
        }

        const result = await tuitionsCollection.updateOne(
            {
                _id: new ObjectId(id),
                approvalStatus: "pending"
            },
            {
                $set: { approvalStatus }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: "Pending tuition not found."
            });
        }

        res.status(200).send({
            message: `Tuition ${approvalStatus} successfully.`
        });
    } catch (error) {
        console.error("Failed to update tuition approval:", error);

        res.status(500).send({
            message: "Failed to update tuition approval."
        });
    }
});

app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const [totalUsers, totalTutors, pendingTuitions, approvedTuitions, revenueResult] = await Promise.all([
            usersCollection.countDocuments(),
            usersCollection.countDocuments({ role: "tutor" }),
            tuitionsCollection.countDocuments({ approvalStatus: "pending" }),
            tuitionsCollection.countDocuments({ approvalStatus: "approved" }),
            paymentsCollection.aggregate([
                { $match: { paymentStatus: "paid" } },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$amount" }
                    }
                }
            ]).toArray()
        ]);

        res.status(200).send({
            totalUsers,
            totalTutors,
            pendingTuitions,
            approvedTuitions,
            totalRevenue: revenueResult[0]?.totalRevenue || 0
        });
    } catch (error) {
        console.error("Failed to fetch admin stats:", error);

        res.status(500).send({
            message: "Failed to fetch admin statistics."
        });
    }
});

app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection
            .find({},
                {
                    projection: {
                        name: 1,
                        email: 1,
                        role: 1,
                        plan: 1,
                        image: 1,
                        createdAt: 1
                    }
                }
            )
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch admin users:", error);

        res.status(500).send({
            message: "Failed to fetch users."
        });
    }
});

app.patch("/admin/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                message: "Invalid user ID."
            });
        }

        if (!["student", "tutor", "admin"].includes(role)) {
            return res.status(400).send({
                message: "Invalid user role."
            });
        }

        const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: { role }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: "User not found."
            });
        }

        res.status(200).send({
            message: "User role updated successfully.",
            role
        });
    } catch (error) {
        console.error("Failed to update user role:", error);

        res.status(500).send({
            message: "Failed to update user role."
        });
    }
});

app.get("/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await paymentsCollection
            .find({},
                {
                    projection: {
                        userName: 1,
                        userEmail: 1,
                        userRole: 1,
                        planName: 1,
                        amount: 1,
                        currency: 1,
                        transactionId: 1,
                        paidAt: 1,
                        paymentStatus: 1
                    }
                }
            )
            .sort({ paidAt: -1 })
            .toArray();

        res.status(200).send(result);
    } catch (error) {
        console.error("Failed to fetch admin transactions:", error);

        res.status(500).send({
            message: "Failed to fetch transactions."
        });
    }
});

app.get('/', (req, res) => {
    res.send('Welcome to mentorlagbe backend server');
})

app.listen(port, () => {
    console.log(`Mentorlagbe server listenting on port ${port}`) 
})