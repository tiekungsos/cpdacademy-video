import express, { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Interface for database configuration
interface DbConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  waitForConnections: boolean;
  connectionLimit: number;
  queueLimit: number;
}

// Interface for lesson data (optional, for type safety)
interface LessonData {
  memberId: number;
  lessonId: number;
  memberCourse: number;
  currentTime: string; // Assuming currentTime is a string representation
}

// Replace with your actual database connection details
const dbConfig: DbConfig = {
  host: process.env.HOST || "",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DATABASE || "",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10, // Set an appropriate connection limit
  queueLimit: 0, // No limit on queued connection requests
};

let pool: mysql.Pool; // Connection pool for better performance

async function connectToDatabase() {
  try {
    pool = await mysql.createPool(dbConfig);
    console.log("Connected to database");
  } catch (error) {
    console.error("Error connecting to database:", error);
    process.exit(1); // Exit on connection error
  }
}

connectToDatabase(); // Connect on server startup

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Specify allowed origins
const allowedOrigins = ["http://127.0.0.1", "https://yourdomain.com"];

const corsOptions = {
  origin: (origin: any, callback: any) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));

// Middleware to check for user-agent
app.use((req, res, next) => {
  const userAgent = req.headers["user-agent"];

  if (process.env.PROD == "1") {
    // Deny requests from Postman and similar tools
    if (userAgent && userAgent.toLowerCase().includes("postman")) {
      return res.status(403).send("Access forbidden");
    }

    // Deny requests without a valid origin
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).send("Access forbidden");
    }
  }

  next();
});

app.post("/lesson/dwUpdateTime", async (req, res) => {
  const { memberId, lessonId, currentTime, memberCourse }: LessonData =
    req.body; // Extract data from request body

  // Validate presence of required fields
  if (!memberId || !lessonId || !currentTime || !memberCourse) {
    return res
      .status(400)
      .send(
        "Missing required fields: memberId, lessonId, currentTime, memberCourse"
      );
  }

  // Construct the prepared statement
  const updateQuery = `
    UPDATE member_lesson
    SET \`CURRENT_TIME\` = ?
    WHERE MEMBER_ID = ? AND LESSON_ID = ? AND MEMBER_COURSE_ID = ? AND FINISHED = 0
  `;

  try {
    // Use getConnection to handle individual request transactions
    const connection = await pool.getConnection();
    try {
      const [updateResults] = await connection.query(updateQuery, [
        currentTime,
        memberId,
        lessonId,
        memberCourse,
      ]);

      if ((updateResults as any).affectedRows === 1) {
        console.log("Lesson time updated successfully");
        res.send("Lesson time saved!");
      } else {
        console.log("No lesson found or already finished");
        res.status(404).send("Lesson not found or already finished");
      }
    } finally {
      connection.release(); // Release the connection back to the pool
    }
  } catch (error) {
    console.error("Error updating lesson time:", error);
    res.status(500).send("Error saving lesson time");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
