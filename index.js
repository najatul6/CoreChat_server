require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

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

let waitingUsers = [];
let onlineUsersCount = 0;

async function run() {
  try {
    const ConnectDB = client.db("Layout");
    const usersCollection = ConnectDB.collection("users");

    io.on("connection", (socket) => {
      onlineUsersCount++;
      io.emit("update_user_count", onlineUsersCount);

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

      socket.on("send_message", (data) => {
        socket.to(data.room).emit("receive_message", data);
      });

      socket.on("webrtc_signal", (data) => {
        socket.to(data.room).emit("webrtc_signal", {
          signal: data.signal,
          room: data.room,
          initiator: data.initiator 
        });
      });

      socket.on("leave_room", ({ room }) => {
        socket.leave(room);
        socket.to(room).emit("partner_disconnected");
      });

      socket.on("disconnect", () => {
        onlineUsersCount--;
        io.emit("update_user_count", onlineUsersCount);
        waitingUsers = waitingUsers.filter((u) => u.id !== socket.id);

        console.log("A user disconnected");
      });
    });

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