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

app.get('/tuitions', async(req, res) => {
    const result = await tuitionsCollection.find().toArray()
    res.send(result)
})



app.get('/', (req, res) => {
    res.send('Welcome to mentorlagbe server');
})

app.listen(port, () => {
    console.log(`Mentorlagbe server listenting on port ${port}`) 
})