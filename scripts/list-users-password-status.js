'use strict';

const { pool } = require('../src/config/db');
const { parseDjangoHash } = require('../src/utils/pbkdf2Django');

function parseIdsArg(argv) {
  const idsIndex = argv.indexOf('--ids');
  if (idsIndex === -1) return [];

  const rawValue = argv[idsIndex + 1] || '';
  return rawValue
    .split(',')
    .map(value => Number.parseInt(String(value).trim(), 10))
    .filter(Number.isInteger);
}

function describirEstadoPassword(password) {
  if (password === null || password === undefined) return 'NULL';

  const texto = String(password).trim();
  if (!texto) return 'VACIA';

  try {
    const parsed = parseDjangoHash(texto);
    if (parsed.algorithm === 'pbkdf2_sha256') return 'HASH_DJANGO';
  } catch {
    // Si no coincide con el formato Django, se considera no soportado.
  }

  return 'FORMATO_NO_SOPORTADO';
}

async function obtenerUsuarios(ids = []) {
  const filtros = [];
  const params = [];

  if (ids.length > 0) {
    filtros.push(`id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }

  const where = filtros.length > 0 ? `WHERE ${filtros.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `
      SELECT id, nombre, email, codigo, area, is_active, is_admin, password
      FROM usuario
      ${where}
      ORDER BY id ASC
    `,
    params
  );

  return rows;
}

async function main() {
  const ids = parseIdsArg(process.argv.slice(2));
  const usuarios = await obtenerUsuarios(ids);

  if (!usuarios.length) {
    console.log('No se encontraron usuarios.');
    return;
  }

  console.table(
    usuarios.map(usuario => ({
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      codigo: usuario.codigo,
      area: usuario.area,
      activo: usuario.is_active ? 'SI' : 'NO',
      is_admin: usuario.is_admin ? 'SI' : 'NO',
      estado_password: describirEstadoPassword(usuario.password),
    }))
  );
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error('[users:password-status]', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch {
        // Ignorar errores al cerrar pool.
      }
    });
}

module.exports = {
  describirEstadoPassword,
  obtenerUsuarios,
  parseIdsArg,
};
