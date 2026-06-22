'use strict';
/**
 * routes/rrhh.js — Submódulo RRHH (verificación de confirmaciones)
 *
 * GET  /api/rrhh/confirmaciones          — lista todas las confirmaciones
 * GET  /api/rrhh/confirmaciones/:id/pdf  — descarga el PDF de una confirmación
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const { requireAuth, requireRrhhOrAdmin } = require('../middlewares/requireAuth');
const { validateId, validateMesAnio } = require('../utils/validators');
const {
  listarConfirmaciones,
  obtenerConfirmacionPorId,
} = require('../models/confirmacion');

router.use(requireAuth, requireRrhhOrAdmin);

function safeJoinFromProject(relativePath) {
  const projectRoot = process.cwd();
  const target = path.resolve(projectRoot, String(relativePath || ''));
  if (!target.startsWith(projectRoot + path.sep)) {
    throw new Error('Ruta de archivo inválida');
  }
  return target;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rrhh/confirmaciones
// Lista todas las confirmaciones de ventas (para vista RRHH).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/confirmaciones', async (req, res) => {
  try {
    let mes;
    let anio;

    if (req.query.mes != null || req.query.anio != null) {
      ({ mes, anio } = validateMesAnio(req.query.mes, req.query.anio));
    }

    const confirmaciones = await listarConfirmaciones({ mes, anio });
    res.json({ ok: true, confirmaciones });
  } catch (err) {
    const status = err.message.includes('inválid') || err.message.includes('inválido') ? 400 : 500;
    console.error('[GET /api/rrhh/confirmaciones]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al obtener confirmaciones' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rrhh/confirmaciones/:id/pdf
// Descarga el PDF de una confirmación específica.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/confirmaciones/:id/pdf', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    const conf = await obtenerConfirmacionPorId(id);
    if (!conf) return res.status(404).json({ ok: false, error: 'Confirmación no encontrada' });

    const rutaAbsoluta = safeJoinFromProject(conf.ruta_pdf);
    if (!fs.existsSync(rutaAbsoluta)) {
      return res.status(404).json({ ok: false, error: 'Archivo PDF no encontrado en disco' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(conf.nombre_archivo || 'confirmacion.pdf')}"`
    );
    fs.createReadStream(rutaAbsoluta).pipe(res);
  } catch (err) {
    const status = err.message.includes('inválid') || err.message.includes('inválido') ? 400 : 500;
    console.error('[GET /api/rrhh/confirmaciones/:id/pdf]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al servir el PDF' });
  }
});

module.exports = router;
