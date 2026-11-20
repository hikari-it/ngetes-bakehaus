// api/login.js
import { Pool } from 'pg';

const isPooler = process.env.DATABASE_URL?.includes(':6543');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isPooler ? false : { rejectUnauthorized: false }
});
pool.on('error', (err) => console.error('PG Pool Error:', err.message));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method tidak diizinkan' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id_karyawan, nama_karyawan, jabatan, username, role 
       FROM karyawan 
       WHERE LOWER(username) = LOWER($1) AND password = $2`,
      [username.trim(), password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}