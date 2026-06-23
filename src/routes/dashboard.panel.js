'use strict';

/**
 * routes/dashboard.panel.js
 *
 * Rutas específicas del panel coordinador de Ventas Asignadas.
 *
 * La tabla "Folios Asignados" debe respetar el mes/año seleccionado en el
 * panel. Si no se envía período, devuelve todas las asignaciones del
 * coordinador para mantener compatibilidad con usos internos.
 */

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { requireAuth } = require('../middlewares/requireAuth');
const { validarMesAnio } = require('../utils/stringHelpers');

router.use(requireAuth);

function getCodigosCoordinador(usuario) {
  return (usuario?.vendedores || [])
    .filter(v => v.tipo === 'C')
    .map(v => v.cod_vendedor)
    .filter(Boolean);
}

// GET /api/dashboard/asignados
router.get('/asignados', async (req, res) => {
  const codigosCoord = getCodigosCoordinador(req.usuario);
  if (!codigosCoord.length) return res.json({ ok: true, asignados: [] });

  let filtroMes = null;
  let filtroAnio = null;

  if (req.query.mes != null || req.query.anio != null) {
    try {
      const parsed = validarMesAnio(req.query.mes, req.query.anio);
      filtroMes = parsed.mes;
      filtroAnio = parsed.anio;
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  try {
    const placeholders = codigosCoord.map(() => '?').join(',');
    const params = [...codigosCoord];
    let filtroPeriodo = '';

    if (filtroMes !== null) {
      filtroPeriodo = 'AND fc.mes = ? AND fc.anio = ?';
      params.push(filtroMes, filtroAnio);
    }

    const [rows] = await db.pool.query(`
      SELECT
        fc.id,
        fc.folio,
        fc.fecha,
        fc.cliente,
        fc.monto_neto,
        fc.monto_asignado,
        fc.porcentaje,
        fc.cod_vendedor_principal,
        fc.cod_vendedor_compartido,
        fc.nombre_vendedor_compartido,
        fc.mes,
        fc.anio
      FROM factura_compartida fc
      WHERE fc.cod_vendedor_principal IN (${placeholders})
        AND fc.rol = 'compartido'
        ${filtroPeriodo}
      ORDER BY fc.fecha DESC, fc.folio DESC
    `, params);

    res.json({ ok: true, asignados: rows });
  } catch (err) {
    console.error('[GET /api/dashboard/asignados panel]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener folios asignados' });
  }
});

module.exports = router;
