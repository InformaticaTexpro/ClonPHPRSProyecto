'use strict';

/**
 * routes/vendedores.js
 *
 * Gestión del PDF de contrato asociado a cada vendedor (usuario).
 *
 * Endpoints:
 *   POST  /api/vendedores/:id/contrato       — sube o reemplaza el PDF
 *   GET   /api/vendedores/:id/contrato       — descarga / sirve el PDF
 *   DELETE /api/vendedores/:id/contrato      — elimina el PDF del disco y BD
 *   PUT   /api/vendedores/:id/rut            — actualiza el RUT del usuario
 *
 * Seguridad:
 *   - requireAuth en todos los endpoints
 *   - Solo el propio usuario O un admin puede ver/subir/eliminar su contrato
 *
 * Almacenamiento:
 *   - Los archivos se guardan en  uploads/contratos/  (carpeta en raíz del proyecto)
 *   - Nombre del archivo: contrato_<id>_<timestamp>.pdf
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const db = require('../config/db');

// ─── Carpeta de destino ───────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'contratos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Configuración Multer ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, _file, cb) => {
    const id        = req.params.id;
    const timestamp = Date.now();
    cb(null, `contrato_${id}_${timestamp}.pdf`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos PDF'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máximo
});

// ─── Helper: verificar acceso ─────────────────────────────────────────────────
function puedeAcceder(req, targetId) {
  const usuarioId = req.usuario.id ?? req.usuario.sub;
  return req.usuario.is_admin || Number(usuarioId) === Number(targetId);
}

// =============================================================================
// POST /api/vendedores/:id/contrato
// Sube (o reemplaza) el PDF de contrato de un vendedor
// =============================================================================
router.post(
  '/:id/contrato',
  requireAuth,
  (req, res, next) => {
    if (!puedeAcceder(req, req.params.id)) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }
    next();
  },
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo PDF' });
      }

      const id = Number(req.params.id);

      // Verificar que el usuario existe
      const [rows] = await db.pool.query(
        'SELECT id, pdf_contrato FROM usuario WHERE id = ?',
        [id]
      );
      if (rows.length === 0) {
        fs.unlinkSync(req.file.path); // limpiar archivo subido
        return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      }

      // Eliminar PDF anterior si existe
      const anteriorRuta = rows[0].pdf_contrato;
      if (anteriorRuta) {
        const rutaAbsoluta = path.join(process.cwd(), anteriorRuta);
        if (fs.existsSync(rutaAbsoluta)) {
          try { fs.unlinkSync(rutaAbsoluta); } catch { /* ignorar */ }
        }
      }

      // Ruta relativa para guardar en BD
      const rutaRelativa = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');

      // Guardar ruta en la base de datos
      await db.pool.query(
        'UPDATE usuario SET pdf_contrato = ? WHERE id = ?',
        [rutaRelativa, id]
      );

      res.json({
        ok: true,
        mensaje: 'PDF de contrato cargado correctamente',
        ruta: rutaRelativa,
        nombre: req.file.filename,
        tamano: req.file.size,
      });
    } catch (err) {
      console.error('[POST /vendedores/:id/contrato]', err.message);
      // Limpiar archivo si fue guardado antes del error
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignorar */ }
      }
      res.status(500).json({ ok: false, error: 'Error al guardar el contrato' });
    }
  }
);

// =============================================================================
// GET /api/vendedores/:id/contrato
// Descarga o sirve el PDF del contrato de un vendedor
// =============================================================================
router.get('/:id/contrato', requireAuth, async (req, res) => {
  try {
    if (!puedeAcceder(req, req.params.id)) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }

    const id = Number(req.params.id);
    const [rows] = await db.pool.query(
      'SELECT nombre, pdf_contrato FROM usuario WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const { pdf_contrato, nombre } = rows[0];

    if (!pdf_contrato) {
      return res.status(404).json({ ok: false, error: 'Este vendedor no tiene contrato cargado' });
    }

    const rutaAbsoluta = path.join(process.cwd(), pdf_contrato);
    if (!fs.existsSync(rutaAbsoluta)) {
      // Limpiar referencia huérfana en BD
      await db.pool.query('UPDATE usuario SET pdf_contrato = NULL WHERE id = ?', [id]);
      return res.status(404).json({ ok: false, error: 'Archivo PDF no encontrado en disco' });
    }

    const nombreArchivo = `contrato_${nombre.replace(/\s+/g, '_')}.pdf`;
    const inline = req.query.inline === 'true';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${nombreArchivo}"`
    );
    fs.createReadStream(rutaAbsoluta).pipe(res);
  } catch (err) {
    console.error('[GET /vendedores/:id/contrato]', err.message);
    res.status(500).json({ ok: false, error: 'Error al servir el contrato' });
  }
});

// =============================================================================
// DELETE /api/vendedores/:id/contrato
// Elimina el PDF del disco y limpia la referencia en BD
// =============================================================================
router.delete('/:id/contrato', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await db.pool.query(
      'SELECT pdf_contrato FROM usuario WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const { pdf_contrato } = rows[0];

    if (!pdf_contrato) {
      return res.status(404).json({ ok: false, error: 'No hay contrato que eliminar' });
    }

    // Borrar archivo físico
    const rutaAbsoluta = path.join(process.cwd(), pdf_contrato);
    if (fs.existsSync(rutaAbsoluta)) {
      try { fs.unlinkSync(rutaAbsoluta); } catch { /* ignorar */ }
    }

    // Limpiar en BD
    await db.pool.query('UPDATE usuario SET pdf_contrato = NULL WHERE id = ?', [id]);

    res.json({ ok: true, mensaje: 'Contrato eliminado correctamente' });
  } catch (err) {
    console.error('[DELETE /vendedores/:id/contrato]', err.message);
    res.status(500).json({ ok: false, error: 'Error al eliminar el contrato' });
  }
});

// =============================================================================
// PUT /api/vendedores/:id/rut
// Actualiza el RUT del vendedor (solo admin o el propio usuario)
// =============================================================================
router.put('/:id/rut', requireAuth, async (req, res) => {
  try {
    if (!puedeAcceder(req, req.params.id)) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }

    const id  = Number(req.params.id);
    const { rut } = req.body;

    if (!rut || typeof rut !== 'string' || rut.trim().length < 8) {
      return res.status(400).json({ ok: false, error: 'RUT inválido' });
    }

    await db.pool.query(
      'UPDATE usuario SET rut = ? WHERE id = ?',
      [rut.trim(), id]
    );

    res.json({ ok: true, mensaje: 'RUT actualizado correctamente' });
  } catch (err) {
    console.error('[PUT /vendedores/:id/rut]', err.message);
    res.status(500).json({ ok: false, error: 'Error al actualizar el RUT' });
  }
});

// =============================================================================
// GET /api/vendedores/:id/info
// Devuelve datos públicos del vendedor incluyendo si tiene contrato cargado
// =============================================================================
router.get('/:id/info', requireAuth, async (req, res) => {
  try {
    if (!puedeAcceder(req, req.params.id)) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }

    const id = Number(req.params.id);
    const [rows] = await db.pool.query(
      `SELECT id, nombre, email, codigo, area, rut,
              CASE WHEN pdf_contrato IS NOT NULL THEN 1 ELSE 0 END AS tiene_contrato,
              pdf_contrato
       FROM usuario WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[GET /vendedores/:id/info]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener información del vendedor' });
  }
});

// ─── Manejo de errores de Multer ──────────────────────────────────────────────
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'El PDF excede el límite de 10 MB' });
  }
  if (err.message === 'Solo se permiten archivos PDF') {
    return res.status(415).json({ ok: false, error: err.message });
  }
  console.error('[vendedores] Error inesperado:', err.message);
  res.status(500).json({ ok: false, error: 'Error interno en módulo vendedores' });
});

module.exports = router;
