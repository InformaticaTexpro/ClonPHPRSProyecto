'use strict';

/**
 * server.js — Texpro RSProyecto
 */

const path      = require('path');
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.error('[ERROR CRÍTICO] Variable de entorno FRONTEND_URL no definida.');
  process.exit(1);
}

const { testConnection }    = require('./config/db');
const authRoutes            = require('./routes/auth');
const recuperarRoutes       = require('./routes/recuperar');
const ventasRoutes          = require('./routes/ventas');
const dashboardAjustesRoutes = require('./routes/dashboard.ajustes');
const dashboardRoutes       = require('./routes/dashboard');
const adminRoutes           = require('./routes/admin');
const notificacionesRoutes  = require('./routes/notificaciones');
const carteraRoutes         = require('./routes/cartera');
const alertasRoutes         = require('./routes/alertas');
const indicadoresRoutes     = require('./routes/indicadores');

const vendedoresRoutes      = require('./routes/vendedores');   // ← NUEVO
const rrhhRoutes            = require('./routes/rrhh');
const { requireAuth }       = require('./middlewares/requireAuth');
const { getDetalleFolio }   = require('./models/venta');
const { validateFolio }     = require('./utils/validators');

const app  = express();
const PORT = Number(process.env.PORT || 3000);

// ── Proxy confiable (Render / Railway usan proxy inverso)
app.set('trust proxy', 1);

const CDN_SCRIPTS = [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'", ...CDN_SCRIPTS],
        scriptSrcElem:  ["'self'", ...CDN_SCRIPTS],
        styleSrc:       ["'self'", "'unsafe-inline'",
                         'https://fonts.googleapis.com',
                         'https://cdnjs.cloudflare.com'],
        fontSrc:        ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc:         ["'self'", 'data:', 'blob:'],
        connectSrc:     ["'self'", 'https://cdn.jsdelivr.net'],
        objectSrc:      ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

app.use((req, res, next) => {
  const allowed = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Intenta en 15 minutos.' },
  handler: (req, res, next, options) => {
    console.warn(`[SEGURIDAD] Rate limit — IP: ${req.ip} | ${new Date().toISOString()}`);
    res.status(429).json(options.message);
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
  message: { ok: false, error: 'Demasiadas solicitudes. Intenta en un momento.' },
});

app.use(express.static(path.join(__dirname, '..')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Ruta raíz
app.get('/', (_req, res) => res.redirect('/src/modulo/varios/login/index.html'));

app.get('/api/health', async (_req, res) => {
  try {
    await testConnection();
    res.status(200).json({ ok: true, app: 'RSProyecto', db: 'connected' });
  } catch {
    res.status(500).json({ ok: false, app: 'RSProyecto', db: 'disconnected' });
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth/login',      loginLimiter);
app.use('/api/auth/refresh',    loginLimiter);
app.use('/api/auth',            authRoutes);
app.use('/api/auth',            recuperarRoutes);
app.use('/api/ventas',          ventasRoutes);

// Compatibilidad para Ventas Asignadas: el detalle del dashboard debe exponer
// CodAux desde Softland.cwtauxi para completar el campo "Cód. Cliente".
app.get('/api/dashboard/detalle/:folio', requireAuth, async (req, res) => {
  try {
    const folio = validateFolio(req.params.folio);
    const detalle = await getDetalleFolio({ folio });
    res.json({ ok: true, folio, detalle });
  } catch (err) {
    const msg = err.message || 'Error al obtener detalle del folio';
    const status = msg.toLowerCase().includes('inválid') ? 400 : 500;
    console.error('[GET /api/dashboard/detalle]', msg);
    res.status(status).json({ ok: false, error: status === 400 ? msg : 'Error al obtener detalle del folio' });
  }
});

app.use('/api/dashboard', dashboardAjustesRoutes);
app.use('/api/dashboard',       dashboardRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/notificaciones',  notificacionesRoutes);
app.use('/api/cartera',         carteraRoutes);
app.use('/api/alertas',         alertasRoutes);
app.use('/api/indicadores',     indicadoresRoutes);

app.use('/api/vendedores',      vendedoresRoutes);   // ← NUEVO
app.use('/api/rrhh',            rrhhRoutes);



// ── 404
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
  }
  res.redirect('/src/modulo/varios/login/index.html');
});

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[RSProyecto] Servidor en http://localhost:${PORT}`));
}

module.exports = app;
