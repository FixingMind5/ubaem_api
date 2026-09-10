import express from "express";
import { adminAuth } from "./firebaseAdmin";
import cors from "cors";
import { getDb } from "./db";

const app = express();

app.use(cors({
  origin: [
    "http://localhost:4321",
    "https://ubaem.com",
    "https://www.ubaem.com"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization"
  ]
}));

const PORT = process.env.PORT || 8080;
app.use(express.json());

app.get("/db-test", async (_req, res) => {
  try {
    const db = await getDb();

    const result = await db.query(
      "SELECT NOW() AS fecha"
    );

    res.json({
      status: "ok",
      databaseTime: result.rows[0].fecha,
    });

  } catch (error) {
    console.error("ERROR POSTGRES:", error);

    res.status(500).json({
      status: "error",
      message: "No se pudo conectar a PostgreSQL",
    });
  }
});

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "UBAEM API"
  });
});

app.get("/me", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Token no enviado"
      });
    }

    const token = authorization.substring(7);

    const decodedToken = await adminAuth.verifyIdToken(token);

    return res.json({
      uid: decodedToken.uid,
      email: decodedToken.email
    });

  } catch (error) {
    console.error("ERROR FIREBASE:", error);

    return res.status(401).json({
      error: "Token inválido"
    });
  }
});

app.get("/profile", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Token no enviado"
      });
    }

    const token = authorization.substring(7);

    const decodedToken = await adminAuth.verifyIdToken(token);

    const db = await getDb();

    const result = await db.query(
      `
      SELECT
        id,
        firebase_uid,
        username,
        nombres,
        apellido_paterno,
        apellido_materno,
        curp,
        telefono,
        email
      FROM usuarios
      WHERE firebase_uid = $1
      `,
      [decodedToken.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Perfil no encontrado"
      });
    }

    return res.json(result.rows[0]);

  } catch (error) {
    console.error("ERROR PROFILE:", error);

    return res.status(500).json({
      error: "Error al obtener el perfil"
    });
  }
});

app.post("/profile", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Token no enviado"
      });
    }

    const token = authorization.substring(7);

    const decodedToken = await adminAuth.verifyIdToken(token);

    const {
      username,
      nombres,
      apellido_paterno,
      apellido_materno,
      curp,
      telefono,
      email
    } = req.body;

    const db = await getDb();

    const result = await db.query(
      `
      INSERT INTO usuarios (
        firebase_uid,
        username,
        nombres,
        apellido_paterno,
        apellido_materno,
        curp,
        telefono,
        email
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)

      ON CONFLICT (firebase_uid)
      DO UPDATE SET
        username = EXCLUDED.username,
        nombres = EXCLUDED.nombres,
        apellido_paterno = EXCLUDED.apellido_paterno,
        apellido_materno = EXCLUDED.apellido_materno,
        curp = EXCLUDED.curp,
        telefono = EXCLUDED.telefono,
        email = EXCLUDED.email

      RETURNING *
      `,
      [
        decodedToken.uid,
        username,
        nombres,
        apellido_paterno,
        apellido_materno,
        curp || null,
        telefono || null,
        email || decodedToken.email || null
      ]
    );

    return res.json(result.rows[0]);

  } catch (error) {
    console.error("ERROR PROFILE:", error);

    return res.status(500).json({
      error: "Error al guardar el perfil"
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UBAEM API escuchando en puerto ${PORT}`);
});