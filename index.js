require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// HTTP Server & Socket.io setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://core-chat-pi.vercel.app"],
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(cors({
  origin: ["http://localhost:5173", "https://core-chat-pi.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// --- Random Chat Variables ---
let waitingUsers = [];
let onlineUsersCount = 0;

async function run() {
  try {
    // await client.connect(); // Production-এ এটি আন-কমেন্ট করতে পারেন
    const ConnectDB = client.db("Layout");
    const usersCollection = ConnectDB.collection("users");

    // --- Socket.io Logic Start ---
    io.on("connection", (socket) => {
      onlineUsersCount++;
      io.emit("update_user_count", onlineUsersCount);

      // ১. কিউতে জয়েন করা (Matching Logic)
      socket.on("join_queue", (data) => {
        const newUser = { id: socket.id, username: data.username };

        if (waitingUsers.length > 0) {
          const partner = waitingUsers.shift();
          const roomName = `room_${partner.id}_${socket.id}`;

          socket.join(roomName);
          const partnerSocket = io.sockets.sockets.get(partner.id);
          if (partnerSocket) partnerSocket.join(roomName);

          io.to(partner.id).emit("match_found", { room: roomName, partner: newUser.username });
          socket.emit("match_found", { room: roomName, partner: partner.username });

          console.log(`Match Found: ${roomName}`);
        } else {
          waitingUsers.push(newUser);
          socket.emit("searching", true);
        }
      });

      // ২. টেক্সট মেসেজ আদান-প্রদান
      socket.on("send_message", (data) => {
        // room আইডি ব্যবহার করে পার্টনারকে মেসেজ পাঠানো
        socket.to(data.room).emit("receive_message", data);
      });

      // ৩. WebRTC সিগন্যালিং (অডিও কানেকশনের জন্য ডাটা পাস করা)
      socket.on("webrtc_signal", (data) => {
        // data.initiator-সহ পুরো অবজেক্টটি পার্টনারকে পাঠান
        socket.to(data.room).emit("webrtc_signal", {
          signal: data.signal,
          room: data.room,
          initiator: data.initiator // এটি অত্যন্ত জরুরি
        });
      });

      // ৪. রুম লিভ করা বা নেক্সট করা
      socket.on("leave_room", ({ room }) => {
        socket.leave(room);
        socket.to(room).emit("partner_disconnected");
      });

      // ৫. কানেকশন বিচ্ছিন্ন হলে
      socket.on("disconnect", () => {
        onlineUsersCount--;
        io.emit("update_user_count", onlineUsersCount);
        waitingUsers = waitingUsers.filter((u) => u.id !== socket.id);

        // ডিসকানেক্ট হলে তার সাথে থাকা পার্টনারকে জানানো
        // এটি একটু কমপ্লেক্স হতে পারে কারণ সকেট রুম অটো লিভ করে, 
        // তাই ফ্রন্টএন্ডে partner_disconnected হ্যান্ডেল করা ভালো।
        console.log("A user disconnected");
      });
    });
    // --- Socket.io Logic End ---

    // JWT & Other API Routes
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
      res.send({ token });
    });

    app.post("/createUser", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) return res.status(409).send({ message: "exists" });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    console.log("Successfully connected to MongoDB and Socket.io is ready!");
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Server is Running..."));

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});