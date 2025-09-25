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
const allowedOrigins = ["http://127.0.0.1", "https://demo.cpdacademy.co", "https://cpdacademy.co", "https://www.cpdacademy.co"];

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
  const { memberId, lessonId, currentTime, logout = 0, login = 0, answer = 'ไม่มี' }: LessonData & {
    logout?: number;
    login?: number;
    answer?: string;
  } = req.body; // Extract data from request body

  console.log("Received request to update lesson time:", {
    memberId,
    lessonId,
    currentTime,
    logout,
    login,
    answer
  });
  
  // Validate presence of required fields
  if (!memberId || !lessonId || !currentTime) {
    return res
      .status(400)
      .send(
        "Missing required fields: memberId, lessonId, currentTime"
      );
  }

  // First, get the existing lesson data
  const selectQuery = `
    SELECT * FROM member_lesson 
    WHERE MEMBER_ID = ? AND ID = ?
  `;

  // Update query
  const updateQuery = `
    UPDATE member_lesson
    SET \`CURRENT_TIME\` = ?
    WHERE MEMBER_ID = ? AND ID = ? AND FINISHED = 0
  `;

  try {
    // Use getConnection to handle individual request transactions
    const connection = await pool.getConnection();
    try {
      // First, retrieve the existing lesson data
      const [selectResults] = await connection.query(selectQuery, [
        memberId,
        lessonId
      ]);
        console.log("Retrieved lesson data:", selectResults);
        
      const data = selectResults as any[];
      
      if (data && data.length > 0) {
        // Log study time (converted from PHP implementation)
        await logStudyTime(connection, memberId, lessonId, currentTime, data, logout, login, answer);
        
        // Check if new currentTime is greater than existing currentTime
        const existingTime = data[0].CURRENT_TIME;
        const shouldUpdate = compareTime(currentTime, existingTime);
        console.log("Should update current time:", shouldUpdate);
        
        if (shouldUpdate) {
          // Update the current time
          const [updateResults] = await connection.query(updateQuery, [
            currentTime,
            memberId,
            lessonId
          ]);

          if ((updateResults as any).affectedRows === 1) {
            console.log("Lesson time updated successfully");
            res.json({ 
              success: true, 
              message: "Lesson time saved!",
              data: data[0]
            });
          } else {
            console.log("No lesson found or already finished");
            res.status(404).send("Lesson not found or already finished");
          }
        } else {
          console.log("Current time not updated - new time is not greater than existing time");
          res.json({
            success: true,
            message: "Current time not updated - new time is not greater than existing time",
            data: data[0]
          });
        }
      } else {
        console.log("No lesson data found");
        res.status(404).send("Lesson not found");
      }
    } finally {
      connection.release(); // Release the connection back to the pool
    }
  } catch (error) {
    console.error("Error updating lesson time:", error);
    res.status(500).send("Error saving lesson time");
  }
});

// Helper function to compare time strings and determine if newTime is greater than existingTime
function compareTime(newTime: string, existingTime: string): boolean {
  // Parse time into seconds for comparison - both should be treated as MM:SS format
  const timeToSeconds = (time: string): number => {
    // Handle MM:SS format (payload format)
    if (time.match(/^\d{1,2}:\d{2}$/)) {
      const [minutes, seconds] = time.split(':').map(Number);
      return minutes * 60 + seconds;
    }
    
    // Handle HH:MM:SS format but treat as MM:SS (ignore hours, use minutes:seconds)
    const timeMatch = time.match(/(\d+):(\d+):(\d+)/);
    if (timeMatch) {
      const [, hours, minutes, seconds] = timeMatch.map(Number);
      // For video time, treat HH:MM:SS as MM:SS (hours become minutes)
      return minutes * 60 + seconds;
    }
    
    return 0;
  };

  const newTimeSeconds = timeToSeconds(newTime);
  const existingTimeSeconds = timeToSeconds(existingTime);
  
  console.log(`Comparing times: ${newTime} (${newTimeSeconds}s) vs ${existingTime} (${existingTimeSeconds}s)`);

  return newTimeSeconds > existingTimeSeconds;
}

// Helper function to log study time (converted from PHP logStudyTime method)
async function logStudyTime(connection: any, memberId: number, lessonId: number, currentTime: string, lessonData: any[], logout: number, login: number, answer: string) {
  try {
    // Get the current record from member_lesson
    const selectQuery = `SELECT * FROM member_lesson WHERE MEMBER_ID = ? AND ID = ?`;
    const [oldRecord] = await connection.query(selectQuery, [memberId, lessonId]);
    
    if (!oldRecord || oldRecord.length < 1) {
      return false;
    }
    
    // Convert time format and calculate seconds for old time
    let strTime = oldRecord[0].CURRENT_TIME;
    // Add leading zeros if needed (e.g., "5:30" -> "00:05:30")
    strTime = strTime.replace(/^(\d{1,2}):(\d{2})$/, "00:$1:$2");
    
    const timeMatch = strTime.match(/(\d+):(\d+):(\d+)/);
    if (!timeMatch) return false;
    
    const [, hours, minutes, seconds] = timeMatch.map(Number);
    const timeSeconds = hours * 3600 + minutes * 60 + seconds;
    
    // Convert time format and calculate seconds for new time
    let strTime2 = currentTime;
    strTime2 = strTime2.replace(/^(\d{1,2}):(\d{2})$/, "00:$1:$2");
    
    const timeMatch2 = strTime2.match(/(\d+):(\d+):(\d+)/);
    if (!timeMatch2) return false;
    
    const [, hours2, minutes2, seconds2] = timeMatch2.map(Number);
    const timeSeconds2 = hours2 * 3600 + minutes2 * 60 + seconds2;
    
    // Calculate time difference
    const diffTime = Math.abs(timeSeconds2 - timeSeconds);
    
    if (diffTime !== 0) {
      // Get lesson data
      const lessonQuery = `SELECT * FROM member_lesson WHERE ID = ?`;
      const [lessonResults] = await connection.query(lessonQuery, [lessonId]);
      
      if (!lessonResults || lessonResults.length < 1) return false;
      const lessonRecord = lessonResults[0];
      
      // Get course lesson data
      const courseLessonQuery = `SELECT * FROM course_lesson WHERE ID = ?`;
      const [courseLessonResults] = await connection.query(courseLessonQuery, [lessonData[0].LESSON_ID]);
      
      if (!courseLessonResults || courseLessonResults.length < 1) return false;
      const courseLessonRecord = courseLessonResults[0];
      
      // Convert current time for video study time (replace : with . and remove leading zeros)
      const studyTimeVideo = currentTime.replace(/:/g, '.').replace(/^0+/, '') || '0';
      
      // Insert log record
      const insertQuery = `
        INSERT INTO log_study_time 
        (MEMBER_ID, COURSE_ID, LESSON_ID, MEMBER_COURSE_ID, STUDY_TIME, PAUSE_VIDEO_LOGOUT, LOGIN_START_VIDEO, STUDY_TIME_VIDEO, ANSWER)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await connection.query(insertQuery, [
        memberId,
        courseLessonRecord.COURSE_ID,
        lessonData[0].LESSON_ID,
        lessonData[0].MEMBER_COURSE_ID,
        diffTime,
        logout,
        login,
        studyTimeVideo,
        answer === 'ไม่มี' ? null : answer
      ]);
      
      console.log(`Study time logged: ${diffTime} seconds difference`);
    }
    
    return true;
  } catch (error) {
    console.error("Error logging study time:", error);
    // Don't throw error to prevent breaking the main update flow
    return false;
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
