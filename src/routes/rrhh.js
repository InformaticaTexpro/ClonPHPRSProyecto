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

const { requireAuth } = require('../middlewares/requireAuth');
const {
  listarConfirmaciones,
  obtenerConfirmacionPorId,
} = require('../models/confirmacion');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rrhh/confirmaciones
// Lista todas las confirmaciones de ventas (para vista RRHH).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/confirmaciones', requireAuth, async (req, res) => {
  try {
    const mes  = req.query.mes  ? Number(req.query.mes)  : undefined;
    const anio = req.query.anio ? Number(req.query.anio) : undefined;
    const confirmaciones = await listarConfirmaciones({ mes, anio });

    res.json({ ok: true, confirmaciones });
  } catch (err) {
    console.error('[GET /api/rrhh/confirmaciones]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener confirmaciones' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rrhh/confirmaciones/:id/pdf
// Descarga el PDF de una confirmación específica.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/confirmaciones/:id/pdf', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

    const conf = await obtenerConfirmacionPorId(id);
    if (!conf) return res.status(404).json({ ok: false, error: 'Confirmación no encontrada' });

    const rutaAbsoluta = path.join(process.cwd(), conf.ruta_pdf);
    if (!fs.existsSync(rutaAbsoluta)) {
      return res.status(404).json({ ok: false, error: 'Archivo PDF no encontrado en disco' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${conf.nombre_archivo}"`
    );
    fs.createReadStream(rutaAbsoluta).pipe(res);
  } catch (err) {
    console.error('[GET /api/rrhh/confirmaciones/:id/pdf]', err.message);
    res.status(500).json({ ok: false, error: 'Error al servir el PDF' });
  }
});

module.exports = router;
