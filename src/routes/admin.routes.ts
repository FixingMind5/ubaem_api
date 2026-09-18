import { Router } from 'express';
import { apiError, success } from "../utils/responses";
import { getDb } from "../db";
import { adminAuth } from "../firebaseAdmin";

const router = Router();

router.post("/users", async (req, res) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return apiError(
      res,
      401,
      "AUTH_REQUIRED",
      "Debes iniciar sesión para crear usuarios."
    );
  }

  let createdFirebaseUid: string | null = null;
  const db = await getDb();
  const client = await db.connect();

  try {
    const token = authorization.substring(7);

    const decodedToken =
      await adminAuth.verifyIdToken(token);

    // 1. Buscar al usuario que hace la petición
    const adminResult = await client.query(
      `
      SELECT
        u.id,
        u.tipo_usuario_id,
        t.clave
      FROM usuarios u
      JOIN tipos_usuario t
        ON t.id = u.tipo_usuario_id
      WHERE u.firebase_uid = $1
        AND u.activo = true
      `,
      [decodedToken.uid]
    );

    if (adminResult.rows.length === 0) {
      return apiError(
        res,
        403,
        "FORBIDDEN",
        "No tienes permisos para realizar esta acción."
      );
    }

    if (adminResult.rows[0].clave !== "ADMIN") {
      return apiError(
        res,
        403,
        "ADMIN_REQUIRED",
        "Solo un administrador puede crear usuarios."
      );
    }

    const {
      email,
      tipo_usuario_id
    } = req.body;

    // 2. Validaciones básicas
    if (!email?.trim()) {
      return apiError(
        res,
        400,
        "EMAIL_REQUIRED",
        "El correo electrónico es obligatorio.",
        "email"
      );
    }

    if (!tipo_usuario_id) {
      return apiError(
        res,
        400,
        "USER_TYPE_REQUIRED",
        "Debes seleccionar un tipo de usuario.",
        "tipo_usuario_id"
      );
    }

    // 3. Verificar tipo de usuario
    const tipoResult = await client.query(
      `
      SELECT id, clave
      FROM tipos_usuario
      WHERE id = $1
      `,
      [tipo_usuario_id]
    );

    if (tipoResult.rows.length === 0) {
      return apiError(
        res,
        400,
        "INVALID_USER_TYPE",
        "El tipo de usuario seleccionado no existe.",
        "tipo_usuario_id"
      );
    }

    const tipo = tipoResult.rows[0];

    // 4. Obtener periodo activo
    const periodoResult = await client.query(
      `
      SELECT id, clave
      FROM periodos
      WHERE activo = true
      LIMIT 1
      `
    );

    if (periodoResult.rows.length === 0) {
      return apiError(
        res,
        409,
        "NO_ACTIVE_PERIOD",
        "No existe un periodo académico activo."
      );
    }

    const periodo = periodoResult.rows[0];

    // 5. Empezar transacción
    await client.query("BEGIN");

    // 6. Consecutivo atómico
    const consecutivoResult = await client.query(
      `
      INSERT INTO consecutivos_matricula (
        tipo_usuario_id,
        periodo_id,
        ultimo_numero
      )
      VALUES ($1, $2, 1)

      ON CONFLICT (tipo_usuario_id, periodo_id)
      DO UPDATE
      SET ultimo_numero =
        consecutivos_matricula.ultimo_numero + 1

      RETURNING ultimo_numero
      `,
      [
        tipo_usuario_id,
        periodo.id
      ]
    );

    const consecutivo =
      consecutivoResult.rows[0].ultimo_numero;

    // 7. Construir matrícula
    const prefijos: Record<string, string> = {
      ADMIN: "1",
      DOCENTE: "2",
      ALUMNO: "3"
    };

    const prefijo = prefijos[tipo.clave];

    if (!prefijo) {
      throw new Error(
        `Tipo de usuario sin prefijo: ${tipo.clave}`
      );
    }

    const matricula =
      `${prefijo}${periodo.clave}${String(consecutivo).padStart(4, "0")}`;

    // 8. Crear usuario Firebase
    const firebaseUser =
      await adminAuth.createUser({
        email: email.trim().toLowerCase(),
        emailVerified: false,
        disabled: false
      });

    createdFirebaseUid = firebaseUser.uid;

    // 9. Crear usuario PostgreSQL
    const usuarioResult = await client.query(
      `
      INSERT INTO usuarios (
        firebase_uid,
        email,
        matricula,
        tipo_usuario_id,
        periodo_ingreso_id,
        activo,
        perfil_completo
      )
      VALUES ($1, $2, $3, $4, $5, true, false)

      RETURNING
        id,
        firebase_uid,
        email,
        matricula,
        tipo_usuario_id,
        periodo_ingreso_id,
        activo,
        perfil_completo
      `,
      [
        firebaseUser.uid,
        firebaseUser.email,
        matricula,
        tipo_usuario_id,
        periodo.id
      ]
    );

    // 10. Generar enlace para establecer contraseña
    const passwordLink =
      await adminAuth.generatePasswordResetLink(
        firebaseUser.email!
      );

    await client.query("COMMIT");

    return success(
      res,
      {
        usuario: usuarioResult.rows[0],

        // TEMPORAL mientras probamos.
        passwordSetupLink: passwordLink
      },
      201
    );

  } catch (error: any) {

    await client.query("ROLLBACK");

    // Si Firebase alcanzó a crear al usuario pero PostgreSQL falló,
    // lo eliminamos para no dejar registros huérfanos.
    if (createdFirebaseUid) {
      try {
        await adminAuth.deleteUser(
          createdFirebaseUid
        );
      } catch (firebaseRollbackError) {
        console.error(
          "No fue posible revertir Firebase:",
          firebaseRollbackError
        );
      }
    }

    console.error("POST /admin/users:", error);

    if (
      error.code === "auth/email-already-exists"
    ) {
      return apiError(
        res,
        409,
        "EMAIL_ALREADY_EXISTS",
        "Ya existe una cuenta con ese correo.",
        "email"
      );
    }

    if (error.code === "23505") {
      return apiError(
        res,
        409,
        "DUPLICATE_USER",
        "Ya existe un usuario con esos datos."
      );
    }

    return apiError(
      res,
      500,
      "USER_CREATION_FAILED",
      "No fue posible crear el usuario."
    );

  } finally {
    client.release();
  }
});

export default router;