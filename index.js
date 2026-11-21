import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import { jwtVerify, createRemoteJWKSet } from 'jose'

const app = express()
const port = process.env.PORT || 5000

app.use(express.json())
app.use(cors())


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

app.get('/', (req, res) => {
    res.send('Welcome to mentorlagbe backend server');
})

app.listen(port, () => {
    console.log(`Mentorlagbe server listenting on port ${port}`) 
})