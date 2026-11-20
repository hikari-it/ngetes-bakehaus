// api/transaksi.js
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
      const { rows } = await pool.query(`
        SELECT 
          v.no_struk AS id,
          EXTRACT(EPOCH FROM v.tanggal_waktu) * 1000 AS time,
          v.tipe_pesanan AS type,
          mp.nama_metode AS pay,
          k.nama_karyawan AS cashier,
          v.subtotal AS sub,
          v.diskon AS disc,
          v.total_tagihan AS total,
          v.nominal_bayar AS cash,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'name', m.nama_menu || COALESCE(' - ' || a.nama_adonan, '') || COALESCE(' (' || vm.nama_varian || ')', ''),
              'q', d.qty,
              'price', d.harga_satuan,
              'disc', 0
            ))
            FROM detail_transaksi d
            JOIN menu m ON m.id_menu = d.id_menu
            LEFT JOIN jenis_adonan a ON a.id_adonan = d.id_adonan
            LEFT JOIN varian_menu vm ON vm.id_varian = d.id_varian
            WHERE d.no_struk = v.no_struk), '[]'
          ) AS items
        FROM v_transaksi_total v
        JOIN metode_pembayaran mp ON mp.id_metode = v.id_metode
        JOIN karyawan k ON k.id_karyawan = v.id_karyawan
        ORDER BY v.tanggal_waktu DESC
        LIMIT 200
      `);
      return res.status(200).json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const client = await pool.connect();
    try {
      const { no_struk, tipe_pesanan, nominal_bayar, diskon, id_karyawan, metode_nama, items } = req.body;
      const mapMetode = { 'QRIS': 'MTD01', 'Tunai': 'MTD02', 'Debit': 'MTD03' };
      const id_metode = mapMetode[metode_nama] || 'MTD02';

      await client.query('BEGIN');

      await client.query(
        `INSERT INTO transaksi 
         (no_struk, tanggal_waktu, tipe_pesanan, nominal_bayar, diskon, persen_pajak, id_toko, id_karyawan, id_pos, id_metode)
         VALUES ($1, NOW(), $2, $3, $4, 0, 'T01', $5, 'P01', $6)`,
        [no_struk, tipe_pesanan, nominal_bayar, diskon || 0, id_karyawan || 'E01', id_metode]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO detail_transaksi (no_struk, id_menu, id_varian, id_adonan, qty, harga_satuan)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [no_struk, item.id_menu, item.id_varian || null, item.id_adonan || null, item.qty, item.harga_satuan]
        );

        // Kurangi stok jika stok >= 0 (bukan unlimited -1)
        await client.query(
          `UPDATE menu SET stok = GREATEST(0, stok - $1) WHERE id_menu = $2 AND stok > 0`,
          [item.qty, item.id_menu]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ ok: true, no_struk });
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  return res.status(405).json({ error: 'Method tidak diizinkan' });
}