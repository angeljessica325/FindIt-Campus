
require("dotenv").config();

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const session = require("express-session");

const MongoStoreModule = require("connect-mongo");
const MongoStore = MongoStoreModule.default || MongoStoreModule;

const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET;
const DOMAIN = (process.env.COLLEGE_EMAIL_DOMAIN || "karunya.edu.in")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing in .env");
    process.exit(1);
}

if (!SESSION_SECRET ||
    SESSION_SECRET === "PASTE_A_LONG_RANDOM_SECRET_HERE" ||
    SESSION_SECRET.length < 32) {
    console.error("Please configure a strong SESSION_SECRET in .env");
    process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const categories = [
    "Electronics",
    "Books & Stationery",
    "Clothing & Accessories",
    "Keys & Cards",
    "Bags",
    "Other"
];

let students;
let items;

// =============================================
// HELPERS
// =============================================

function validDate(value) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(value + "T00:00:00.000Z");
    const now = new Date();

    const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0")
    ].join("-");

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value &&
        value <= today;
}

function validCollegeEmail(email) {
    if (typeof email !== "string" || email.length > 254) {
        return false;
    }

    const emailPattern =
        /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

    return emailPattern.test(email) &&
        email.endsWith("@" + DOMAIN);
}

function validObjectId(id) {
    return typeof id === "string" &&
        /^[a-f\d]{24}$/i.test(id);
}

function requireLogin(req, res, next) {
    if (!req.session.studentId) {
        return res.status(401).json({
            error: "Please log in first."
        });
    }

    next();
}

// Check browser Origin for modifying requests.
// Requests without Origin are allowed for compatible clients.
// Production deployments should use HTTPS and appropriate CSRF protection.
function checkOrigin(req, res, next) {
    const origin = req.get("origin");

    if (!origin) return next();

    try {
        const originHost = new URL(origin).host.toLowerCase();
        const requestHost = req.get("host")?.toLowerCase();

        if (!requestHost || originHost !== requestHost) {
            return res.status(403).json({
                error: "Cross-origin request rejected."
            });
        }

        next();
    } catch {
        return res.status(403).json({
            error: "Invalid request origin."
        });
    }
}

function publicStudent(student) {
    return {
        id: student._id.toString(),
        name: student.name,
        email: student.email
    };
}

function publicReport(report) {
    return {
        _id: report._id,
        type: report.type,
        itemName: report.itemName,
        category: report.category,
        location: report.location,
        date: report.date,
        description: report.description,
        createdAt: report.createdAt,
        status: report.status || "active"
    };
}

// =============================================
// START SERVER
// =============================================

async function startServer() {
    try {
        await client.connect();

        console.log("MongoDB connected successfully!");

        const db = client.db("FindItCampus");

        students = db.collection("students");
        items = db.collection("items");

        // Unique student email
        await students.createIndex(
            { email: 1 },
            { unique: true }
        );

        // Report indexes
        await items.createIndex({ createdAt: -1 });
        await items.createIndex({ ownerId: 1, createdAt: -1 });

        // Persistent MongoDB sessions
        if (process.env.TRUST_PROXY === "true") {
            app.set("trust proxy", 1);
        }

        app.use(session({
            name: "findit.sid",
            secret: SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            store: MongoStore.create({
                client,
                dbName: "FindItCampus",
                collectionName: "sessions",
                ttl: 86400
            }),
            cookie: {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 24 * 60 * 60 * 1000
            }
        }));

        // =============================================
        // HEALTH
        // =============================================

        app.get("/api/health", (req, res) => {
            res.json({
                message: "FindIt Campus API is working!"
            });
        });

        // =============================================
        // STUDENT REGISTRATION
        // =============================================

        app.post("/api/auth/register", checkOrigin, async (req, res) => {
            try {
                const { name, email, password } = req.body || {};

                const cleanName =
                    typeof name === "string" ? name.trim() : "";

                const cleanEmail =
                    typeof email === "string"
                        ? email.trim().toLowerCase()
                        : "";

                if (cleanName.length < 2 || cleanName.length > 80) {
                    return res.status(400).json({
                        error: "Name must be 2–80 characters."
                    });
                }

                if (!validCollegeEmail(cleanEmail)) {
                    return res.status(400).json({
                        error: `Use a valid @${DOMAIN} college email.`
                    });
                }

                if (typeof password !== "string" ||
                    password.length < 8 ||
                    password.length > 128) {
                    return res.status(400).json({
                        error: "Password must be 8–128 characters."
                    });
                }

                const existing = await students.findOne({
                    email: cleanEmail
                });

                if (existing) {
                    return res.status(409).json({
                        error: "An account with this email already exists."
                    });
                }

                const passwordHash = await bcrypt.hash(password, 12);

                const student = {
                    name: cleanName,
                    email: cleanEmail,
                    passwordHash,
                    emailVerified: false,
                    createdAt: new Date()
                };

                const result = await students.insertOne(student);
                student._id = result.insertedId;

                req.session.regenerate((err) => {
                    if (err) {
                        console.error("Session error:", err.message);

                        return res.status(500).json({
                            error: "Account created, but login setup failed. Please log in."
                        });
                    }

                    req.session.studentId = student._id.toString();

                    req.session.save((saveError) => {
                        if (saveError) {
                            return res.status(500).json({
                                error: "Account created. Please log in."
                            });
                        }

                        res.status(201).json({
                            message: "Account created successfully!",
                            student: publicStudent(student)
                        });
                    });
                });

            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({
                        error: "An account with this email already exists."
                    });
                }

                console.error("Registration error:", error.message);

                res.status(500).json({
                    error: "Registration failed."
                });
            }
        });

        // =============================================
        // STUDENT LOGIN
        // =============================================

        app.post("/api/auth/login", checkOrigin, async (req, res) => {
            try {
                const email =
                    typeof req.body?.email === "string"
                        ? req.body.email.trim().toLowerCase()
                        : "";

                const password = req.body?.password;

                if (!validCollegeEmail(email) ||
                    typeof password !== "string" ||
                    password.length > 128) {
                    return res.status(400).json({
                        error: "Enter a valid college email and password."
                    });
                }

                const student = await students.findOne({
                    email
                });

                if (!student) {
                    return res.status(401).json({
                        error: "Incorrect email or password."
                    });
                }

                const passwordOk = await bcrypt.compare(
                    password,
                    student.passwordHash
                );

                if (!passwordOk) {
                    return res.status(401).json({
                        error: "Incorrect email or password."
                    });
                }

                req.session.regenerate((err) => {
                    if (err) {
                        return res.status(500).json({
                            error: "Could not start your session."
                        });
                    }

                    req.session.studentId = student._id.toString();

                    req.session.save((saveError) => {
                        if (saveError) {
                            return res.status(500).json({
                                error: "Could not save your session."
                            });
                        }

                        res.json({
                            message: "Login successful!",
                            student: publicStudent(student)
                        });
                    });
                });

            } catch (error) {
                console.error("Login error:", error.message);

                res.status(500).json({
                    error: "Login failed."
                });
            }
        });

        // =============================================
        // CURRENT LOGGED-IN STUDENT
        // =============================================

        app.get("/api/auth/me", async (req, res) => {
            try {
                if (!req.session.studentId ||
                    !validObjectId(req.session.studentId)) {
                    return res.status(401).json({
                        error: "Not logged in."
                    });
                }

                const student = await students.findOne({
                    _id: new ObjectId(req.session.studentId)
                });

                if (!student) {
                    return res.status(401).json({
                        error: "Student account not found."
                    });
                }

                res.json({
                    student: publicStudent(student)
                });

            } catch (error) {
                console.error("Account error:", error.message);

                res.status(500).json({
                    error: "Could not load your account."
                });
            }
        });

        // =============================================
        // LOGOUT
        // =============================================

        app.post("/api/auth/logout", checkOrigin, (req, res) => {
            req.session.destroy((err) => {
                if (err) {
                    return res.status(500).json({
                        error: "Logout failed."
                    });
                }

                res.clearCookie("findit.sid", {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax"
                });

                res.json({
                    message: "Logged out successfully."
                });
            });
        });

        // =============================================
        // SAVE LOST OR FOUND REPORT
        // =============================================

        app.post("/api/items", checkOrigin, requireLogin, async (req, res) => {
            try {
                const {
                    type,
                    itemName,
                    category,
                    location,
                    date,
                    description
                } = req.body || {};

                if (!["lost", "found"].includes(type)) {
                    return res.status(400).json({
                        error: "Choose lost or found."
                    });
                }

                if (typeof itemName !== "string" ||
                    itemName.trim().length < 2 ||
                    itemName.trim().length > 80) {
                    return res.status(400).json({
                        error: "Item name must be 2–80 characters."
                    });
                }

                if (!categories.includes(category)) {
                    return res.status(400).json({
                        error: "Choose a valid category."
                    });
                }

                if (typeof location !== "string" ||
                    location.trim().length < 2 ||
                    location.trim().length > 120) {
                    return res.status(400).json({
                        error: "Location must be 2–120 characters."
                    });
                }

                if (!validDate(date)) {
                    return res.status(400).json({
                        error: "Enter a valid date that is not in the future."
                    });
                }

                if (typeof description !== "string" ||
                    description.trim().length < 5 ||
                    description.trim().length > 500) {
                    return res.status(400).json({
                        error: "Description must be 5–500 characters."
                    });
                }

                // Ownership comes only from the authenticated session.
                const report = {
                    type,
                    itemName: itemName.trim(),
                    category,
                    location: location.trim(),
                    date,
                    description: description.trim(),
                    ownerId: req.session.studentId,
                    status: "active",
                    createdAt: new Date()
                };

                const result = await items.insertOne(report);

                res.status(201).json({
                    message: "Report submitted successfully!",
                    id: result.insertedId
                });

            } catch (error) {
                console.error("Save error:", error.message);

                res.status(500).json({
                    error: "Could not save report. Please try again."
                });
            }
        });

        // =============================================
        // PUBLIC ITEM BROWSING
        // =============================================

        app.get("/api/items", async (req, res) => {
            try {
                const reports = await items.find({})
                    .sort({ createdAt: -1 })
                    .limit(100)
                    .toArray();

                res.json(reports.map(publicReport));

            } catch (error) {
                console.error("Fetch error:", error.message);

                res.status(500).json({
                    error: "Could not fetch reports."
                });
            }
        });

        // =============================================
        // MY REPORTS
        // =============================================

        app.get("/api/my-reports", requireLogin, async (req, res) => {
            try {
                const reports = await items.find({
                    ownerId: req.session.studentId
                })
                    .sort({ createdAt: -1 })
                    .limit(200)
                    .toArray();

                res.json(reports.map(publicReport));

            } catch (error) {
                console.error("My reports error:", error.message);

                res.status(500).json({
                    error: "Could not load your reports."
                });
            }
        });

        // =============================================
        // MARK OWN REPORT AS RECOVERED
        // =============================================

        app.patch(
            "/api/items/:id/recovered",
            checkOrigin,
            requireLogin,
            async (req, res) => {
                try {
                    const id = req.params.id;

                    if (!validObjectId(id)) {
                        return res.status(400).json({
                            error: "Invalid report ID."
                        });
                    }

                    const reportId = new ObjectId(id);

                    // Match both report ID and owner.
                    // A different student cannot recover this report.
                    const result = await items.updateOne(
                        {
                            _id: reportId,
                            ownerId: req.session.studentId,
                            status: { $ne: "recovered" }
                        },
                        {
                            $set: {
                                status: "recovered",
                                recoveredAt: new Date()
                            }
                        }
                    );

                    if (result.matchedCount === 0) {
                        const report = await items.findOne({
                            _id: reportId
                        });

                        if (!report) {
                            return res.status(404).json({
                                error: "Report not found."
                            });
                        }

                        if (report.ownerId !== req.session.studentId) {
                            return res.status(403).json({
                                error: "Only the original reporter can recover this report."
                            });
                        }

                        return res.status(400).json({
                            error: "This report is already recovered."
                        });
                    }

                    res.json({
                        message: "Report marked as recovered!"
                    });

                } catch (error) {
                    console.error("Recovery error:", error.message);

                    res.status(500).json({
                        error: "Could not update report."
                    });
                }
            }
        );

        // =============================================
        // START LISTENING
        // =============================================

        app.listen(PORT, () => {
            console.log(
                `Server running at http://localhost:${PORT}`
            );
        });

    } catch (error) {
        console.error("Startup failed:", error.message);

        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

startServer();
