
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const PUBLIC_DIR = path.join(ROOT, "public");

for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters.");
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters.");
}

const db = new Database(path.join(DATA_DIR, "cinewave.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    filename TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const adminExists = db.prepare("SELECT id FROM admins WHERE username = ?")
  .get(process.env.ADMIN_USERNAME);

if (!adminExists) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)")
    .run(process.env.ADMIN_USERNAME, hash);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomUUID() + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".mp4", ".webm", ".ogg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error("Only MP4, WebM and OGG videos are allowed."));
    }
    cb(null, true);
  }
});

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Please log in as admin." });
  }
  next();
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && origin !== `${req.protocol}://${req.get("host")}`) {
    return res.status(403).json({ error: "Invalid request origin." });
  }
  next();
}

app.use("/api", requireSameOrigin);

app.get("/api/movies", (req, res) => {
  const movies = db.prepare(`
    SELECT id, title, category, description, filename, created_at
    FROM movies ORDER BY id DESC
  `).all();

  res.json(movies);
});

app.get("/api/me", (req, res) => {
  res.json({ loggedIn: Boolean(req.session.adminId) });
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?")
    .get(username);

  if (!admin || !bcrypt.compareSync(password || "", admin.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Login failed." });
    req.session.adminId = admin.id;
    res.json({ success: true });
  });
});

app.post("/api/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

app.post("/api/movies", requireAdmin, (req, res, next) => {
  upload.single("video")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  const { title, category, description } = req.body || {};

  if (!req.file || !title || !category) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Title, category and video are required." });
  }

  const result = db.prepare(`
    INSERT INTO movies (title, category, description, filename)
    VALUES (?, ?, ?, ?)
  `).run(
    String(title).trim().slice(0, 150),
    String(category).trim().slice(0, 60),
    String(description || "").trim().slice(0, 2000),
    req.file.filename
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete("/api/movies/:id", requireAdmin, (req, res) => {
  const movie = db.prepare("SELECT * FROM movies WHERE id = ?")
    .get(Number(req.params.id));

  if (!movie) return res.status(404).json({ error: "Movie not found." });

  db.prepare("DELETE FROM movies WHERE id = ?").run(movie.id);

  const filePath = path.join(UPLOAD_DIR, path.basename(movie.filename));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.json({ success: true });
});

app.use("/videos", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`CINEWAVE running at http://localhost:${PORT}`);
});
