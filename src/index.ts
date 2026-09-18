import express from "express";
import { adminAuth } from "./firebaseAdmin";
import cors from "cors";
import { getDb } from "./db";
import { apiError, success } from "./utils/responses";

import adminRoutes from "./routes/admin.routes";

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
app.use(express.json());

app.use("/admin", adminRoutes);

const PORT = process.env.PORT || 8080;


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
      return apiError(
        res,
        401,
        "AUTH_REQUIRED",
        "Inicia sesión para ver tu perfil"
      )
    }

    const token = authorization.substring(7);
    let decodedToken;

    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch {
      return apiError(
        res,
        401,
        "INVALID_TOKEN",
        "Tu sesión no es válida o ha expirado"
      );
    }

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
      return apiError(
        res,
        404,
        "PROFILE_NOT_FOUND",
        "El perfil no existe o no has registrado tu perfil"
      )
    }

    return success(res, result.rows[0]);

  } catch (error) {
    console.error("GET /profile:", error);

    return apiError(
      res,
      500,
      "INTERNAL_ERROR",
      "No fue posible obtener su perfil"
    );
  }
});

app.post("/profile", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return apiError(
        res,
        401,
        "AUTH_REQUIRED",
        "Debes iniciar sesión para crear un perfil"
      )
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
    } = req.body;

    if (!username?.trim()) {
      return apiError(
        res,
        400,
        "USERNAME_REQUIRED",
        "No puedes dejar vacío el nombre de usuario"
      );
    }

    const db = await getDb();
    const existingUser = await db.query(
      `
        SELECT id 
        FROM usuarios 
        WHERE firebase_uid = $1
      `,
      [decodedToken.uid]
    );

    if (existingUser.rows.length > 0) {
      return apiError(
        res,
        409,
        "PROFILE_ALREADY_EXISTS",
        "Ya existe un perfil para esta cuenta"
      );
    }
    
    const result = await db.query(
      `
      INSERT INTO usuarios (
        firebase_uid,
        email,
        username,
        nombres,
        apellido_paterno,
        apellido_materno,
        curp,
        telefono
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)

      RETURNING *
      `,
      [
        decodedToken.uid,
        decodedToken.email,
        username.trim(),
        nombres?.trim() || null,
        apellido_paterno?.trim() || null,
        apellido_materno?.trim() || null,
        curp || null,
        telefono?.trim() || null,
      ]
    );

    return success(res, result.rows[0], 201);

  } catch (error: any) {
    console.error("POST /profile:", error);

    if (error.code === "23505") {
      if (error.constraint?.includes("username")) {
        return apiError(
          res,
          409,
          "USERNAME_TAKEN",
          "Ese nombre de usuario ya está registrado.",
          "username"
        );
      }

      if (error.constraint?.includes("curp")) {
        return apiError(
          res,
          409,
          "CURP_TAKEN",
          "Esa CURP ya está registrada.",
          "curp"
        );
      }
    }

    // if (error.constraint?.includes("email")) {
    //   return res.status(409).json({
    //     field: "email",
    //     error: "El correo electrónico ya está en uso"
    //   });
    // }

    return res.status(500).json({
      error: "Error al guardar el perfil"
    });
  }
});

app.patch("/profile", async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return apiError(
        res,
        401,
        "AUTH_REQUIRED",
        "Debes iniciar sesión para modificar tu perfil"
      );
    }

    const token = authorization.substring(7);
    const decodedToken = await adminAuth.verifyIdToken(token);

    const allowedFields = [
      "username",
      "nombres",
      "apellido_paterno",
      "apellido_materno",
      "curp",
      "telefono",
    ];

    const fields: string[] = [];
    const values: unknown[] = [];

     for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) {
        continue;
      }
      
      const rawValue = req.body[field];

      if (
        typeof rawValue === "string" &&
        rawValue.trim() === ""
      ) {
        continue;
      }

      fields.push(`${field} = $${values.length + 1}`);

      values.push(
        typeof rawValue === "string"
          ? rawValue.trim()
          : rawValue
      );
    }

    if (fields.length === 0) {
      return apiError(
        res,
        400,
        "NO_CHANGES",
        "No se enviaron cambios válidos."
      );
    }

    const db = await getDb();
    values.push(decodedToken.uid);
    
    const result = await db.query(
      `
        UPDATE usuarios
        SET ${fields.join(", ")}
        WHERE firebase_uid = $${values.length}
        RETURNING *
      `,
      values
    );

    if (result.rows.length === 0) {
      return apiError(
        res,
        404,
        "PROFILE_NOT_FOUND",
        "Aún no existe un perfil para esta cuenta."
      );
    }

    return success(res, result.rows[0]);

  } catch (error: any) {
    console.error("PATCH /profile:", error);

    if (error.code === "23505") {
      if (error.constraint?.includes("username")) {
        return apiError(
          res,
          409,
          "USERNAME_TAKEN",
          "Ese nombre de usuario ya está registrado.",
          "username"
        );
      }

      if (error.constraint?.includes("curp")) {
        return apiError(
          res,
          409,
          "CURP_TAKEN",
          "Esa CURP ya está registrada.",
          "curp"
        );
      }
    }

    return apiError(
      res,
      500,
      "INTERNAL_ERROR",
      "No fue posible actualizar tu perfil."
    );
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