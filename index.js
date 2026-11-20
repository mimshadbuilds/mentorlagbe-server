import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import { MongoClient, ObjectId } from 'mongodb'

const app = express()
const port = process.env.PORT || 5000

app.use(express.json())
app.use(cors())

const client = new MongoClient(process.env.MONGODB_URI)

export async function connectToMongoDB() {
    await client.connect()
    console.log("Successfully connected to MongoDB!")
    return client
}

const mongoClient = await connectToMongoDB()
const db = mongoClient.db('mentorlagbeDB')

const usersCollection = db.collection('users')
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