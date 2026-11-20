// api/menu.js
import { Pool } from 'pg';

const isPooler = process.env.DATABASE_URL?.includes(':6543');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isPooler ? false : { rejectUnauthorized: false }
});
pool.on('error', (err) => console.error('PG Pool Error:', err.message));

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // 1. Ambil semua menu non-donut + varian jika ada
      const { rows: regularRows } = await pool.query(`
        SELECT 
          m.id_menu, m.nama_menu, k.nama_kategori AS cat, m.harga_satuan AS price,
          m.hpp AS cost, m.stok AS stock, m.is_tersedia AS "on",
          v.id_varian, v.nama_varian, COALESCE(v.harga_tambahan, 0) AS harga_tambahan
        FROM menu m
        JOIN kategori_menu k ON m.id_kategori = k.id_kategori
        LEFT JOIN varian_menu v ON v.id_menu = m.id_menu
        WHERE k.nama_kategori != 'Donut'
        ORDER BY k.urutan, m.id_menu, v.id_varian
      `);

      // 2. Ambil menu donut yang digabung dengan 3 jenis adonan (sesuai tampilan POS HTML)
      const { rows: donutRows } = await pool.query(`
        SELECT 
          m.id_menu, m.nama_menu, k.nama_kategori AS cat, m.harga_satuan AS price,
          m.hpp AS cost, m.stok AS stock, m.is_tersedia AS "on",
          a.id_adonan, a.nama_adonan
        FROM menu m
        JOIN kategori_menu k ON m.id_kategori = k.id_kategori
        JOIN rating_adonan_donut r ON r.id_menu = m.id_menu
        JOIN jenis_adonan a ON a.id_adonan = r.id_adonan
        WHERE k.nama_kategori = 'Donut'
        ORDER BY m.id_menu, a.id_adonan
      `);

      let idx = 1;
      const formatted = [];

      for (const r of regularRows) {
        const fullName = r.nama_varian ? `${r.nama_menu} (${r.nama_varian})` : r.nama_menu;
        formatted.push({
          id: idx++,
          id_menu: r.id_menu,
          id_varian: r.id_varian || null,
          id_adonan: null,
          name: fullName,
          cat: r.cat,
          price: r.price + r.harga_tambahan,
          cost: r.cost,
          stock: r.stock,
          on: r.on,
          sold: 0,
          sku: `${r.id_menu}${r.id_varian ? '-V' + r.id_varian : ''}`
        });
      }

      for (const d of donutRows) {
        formatted.push({
          id: idx++,
          id_menu: d.id_menu,
          id_varian: null,
          id_adonan: d.id_adonan,
          name: `${d.nama_menu} - ${d.nama_adonan}`,
          cat: d.cat,
          price: d.price,
          cost: d.cost,
          stock: d.stock,
          on: d.on,
          sold: 0,
          sku: `${d.id_menu}-${d.id_adonan}`
        });
      }

      return res.status(200).json(formatted);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Toggle status aktif / update stok / edit menu dari Admin
  if (req.method === 'PUT') {
    const { id_menu, nama_menu, price, cost, stock, on } = req.body;
    try {
      await pool.query(
        `UPDATE menu SET 
          nama_menu = COALESCE($1, nama_menu),
          harga_satuan = COALESCE($2, harga_satuan),
          hpp = COALESCE($3, hpp),
          stok = COALESCE($4, stok),
          is_tersedia = COALESCE($5, is_tersedia)
         WHERE id_menu = $6`,
        [nama_menu, price, cost, stock, on, id_menu]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method tidak diizinkan' });
}