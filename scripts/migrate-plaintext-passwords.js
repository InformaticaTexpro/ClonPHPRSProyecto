'use strict';

const { pool } = require('../src/config/db');
const { hashPasswordDjango, parseDjangoHash } = require('../src/utils/pbkdf2Django');

function parseIdsArg(argv) {
  const idsIndex = argv.indexOf('--ids');
  if (idsIndex === -1) return [];

  const rawValue = argv[idsIndex + 1] || '';
  return rawValue
    .split(',')
    .map(value => Number.parseInt(String(value).trim(), 10))
    .filter(Number.isInteger);
}

function hasApplyFlag(argv) {
  return argv.includes('--apply');
}

function describePasswordState(password) {
  if (password === null || password === undefined) return 'NULL';

  const texto = String(password).trim();
  if (!texto) return 'VACIA';

  try {
    const parsed = parseDjangoHash(texto);
    if (parsed.algorithm === 'pbkdf2_sha256') return 'HASH_DJANGO';
  } catch {
    // No es hash Django.
  }

  return 'FORMATO_NO_SOPORTADO';
}

function isPlaintextSafeToMigrate(password) {
  if (password === null || password === undefined) return false;

  const texto = String(password);
  if (!texto.trim()) return false;
  if (texto.startsWith('pbkdf2_sha256$')) return false;

  // Heurística conservadora: migramos solo strings que no parezcan hash legado.
  // Si contiene separadores típicos de hash, se deja en revisión manual.
  return !texto.includes('$');
}

async function loadUsersByIds(ids) {
  if (!ids.length) {
    return [];
  }

  const [rows] = await pool.execute(
    `
      SELECT id, nombre, email, codigo, area, is_active, is_admin, password
      FROM usuario
      WHERE id IN (${ids.map(() => '?').join(', ')})
      ORDER BY id ASC
    `,
    ids
  );

  return rows;
}

function buildActionSummary(usuario) {
  const estado = describePasswordState(usuario.password);
  if (estado === 'HASH_DJANGO') {
    return { estado, accion: 'saltado: ya está en hash Django', migrar: false };
  }

  if (estado === 'NULL' || estado === 'VACIA') {
    return { estado, accion: 'saltado: password vacío o nulo', migrar: false };
  }

  if (!isPlaintextSafeToMigrate(usuario.password)) {
    return { estado, accion: 'saltado: formato no apto para migración automática', migrar: false };
  }

  return { estado, accion: 'migrar a hash Django PBKDF2', migrar: true };
}

async function main() {
  const ids = parseIdsArg(process.argv.slice(2));
  const apply = hasApplyFlag(process.argv.slice(2));

  if (!ids.length) {
    console.error('Debes indicar los ids a migrar con --ids 36,37,38');
    process.exitCode = 1;
    return;
  }

  const usuarios = await loadUsersByIds(ids);

  if (!usuarios.length) {
    console.log('No se encontraron usuarios para los ids indicados.');
    return;
  }

  const resumen = usuarios.map(usuario => {
    const info = buildActionSummary(usuario);
    return {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      codigo: usuario.codigo,
      area: usuario.area,
      activo: usuario.is_active ? 'SI' : 'NO',
      is_admin: usuario.is_admin ? 'SI' : 'NO',
      estado_password: info.estado,
      accion: info.accion,
    };
  });

  console.table(resumen);

  if (!apply) {
    console.log('Dry-run completado. No se realizaron cambios.');
    return;
  }

  const usuariosAMigrar = usuarios.filter(usuario => buildActionSummary(usuario).migrar);

  if (!usuariosAMigrar.length) {
    console.log('No hay passwords aptos para migrar.');
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const usuario of usuariosAMigrar) {
      const hash = hashPasswordDjango(String(usuario.password));
      await connection.execute(
        'UPDATE usuario SET password = ? WHERE id = ?',
        [hash, usuario.id]
      );
    }

    await connection.commit();
    console.log(`Migración completada para ${usuariosAMigrar.length} usuario(s).`);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error('[users:migrate-plaintext-passwords]', err.message);
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
  buildActionSummary,
  describePasswordState,
  isPlaintextSafeToMigrate,
  loadUsersByIds,
  parseIdsArg,
};
