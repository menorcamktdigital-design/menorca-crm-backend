import { Pool, types } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Las columnas `timestamp without time zone` (contactos.creado_en,
// ultima_actividad, conversaciones.fecha) guardan el instante en UTC pero
// sin marca de zona. Por defecto el driver pg parsea ese tipo (OID 1114)
// usando la zona local del proceso, lo que corre la hora +5 en Perú
// (America/Lima). Se fuerza a interpretarlo como UTC (añadiendo la 'Z')
// para que el Date resultante represente el instante correcto y el
// frontend lo pueda mostrar en cualquier zona sin desfase.
const parseTimestampUTC = (val: string | null) =>
  val === null ? null : new Date(val.replace(' ', 'T') + 'Z');
types.setTypeParser(1114, parseTimestampUTC);

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export async function query(sql: string, params?: any[]) {
  const client = await pool.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    client.release();
  }
}