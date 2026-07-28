const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const normalizeKind = (value) => {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'income' || kind === 'expense') return kind;
  return '';
};

const normalizeName = (value) => String(value || '').trim().slice(0, 80);

const parseYear = (value) => {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
};

const parseMonth = (value) => {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
};

const parseDay = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

const resolveProfileType = async (req) => {
  if (req.session?.profileType) return String(req.session.profileType);
  const user = await db.get('SELECT profile_type FROM users WHERE id = $1', [req.session.userId]);
  const profile = String(user?.profile_type || 'driver');
  req.session.profileType = profile;
  return profile;
};

const requirePersonalProfile = async (req, res, next) => {
  try {
    const profileType = await resolveProfileType(req);
    if (profileType !== 'personal') {
        return res.status(403).json({ error: 'Módulo disponível apenas para perfil pessoal.' });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao validar perfil do usuário.' });
  }
};

router.use(requirePersonalProfile);

router.get('/', async (req, res) => {
  const userId = req.session.userId;
  const year = parseYear(req.query?.year) || new Date().getFullYear();

  try {
    const rows = await db.all(
      `SELECT id, kind, name, sort_order
       FROM personal_sheet_rows
       WHERE user_id = $1
       ORDER BY kind ASC, sort_order ASC, id ASC`,
      [userId]
    );

    const values = await db.all(
      `SELECT row_id, month, amount, day_of_month
       FROM personal_sheet_values
       WHERE user_id = $1 AND year = $2`,
      [userId, year]
    );

    const rowKindById = new Map((rows || []).map((row) => [Number(row.id), row.kind]));
    const incomeByMonth = {};
    const expenseByMonth = {};
    const balanceByMonth = {};

    for (let month = 1; month <= 12; month += 1) {
      incomeByMonth[String(month)] = 0;
      expenseByMonth[String(month)] = 0;
      balanceByMonth[String(month)] = 0;
    }

    (values || []).forEach((value) => {
      const rowId = Number(value.row_id);
      const month = String(Number(value.month));
      const amount = Number(value.amount) || 0;
      const kind = rowKindById.get(rowId);

      if (kind === 'income') incomeByMonth[month] += amount;
      if (kind === 'expense') expenseByMonth[month] += amount;
    });

    for (let month = 1; month <= 12; month += 1) {
      const key = String(month);
      balanceByMonth[key] = (incomeByMonth[key] || 0) - (expenseByMonth[key] || 0);
    }

    return res.json({
      year,
      rows: (rows || []).map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        sortOrder: row.sort_order
      })),
      values: (values || []).map((value) => ({
        rowId: value.row_id,
        month: Number(value.month),
        amount: Number(value.amount) || 0,
        day: value.day_of_month === null || value.day_of_month === undefined ? null : Number(value.day_of_month)
      })),
      totals: {
        incomeByMonth,
        expenseByMonth,
        balanceByMonth
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao carregar planilha pessoal.' });
  }
});

router.post('/rows', async (req, res) => {
  const userId = req.session.userId;
  const kind = normalizeKind(req.body?.kind);
  const name = normalizeName(req.body?.name);

  if (!kind || !name) {
    return res.status(400).json({ error: 'Informe tipo válido (income/expense) e nome da linha.' });
  }

  try {
    const orderRow = await db.get(
      'SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM personal_sheet_rows WHERE user_id = $1 AND kind = $2',
      [userId, kind]
    );
    const sortOrder = Number(orderRow?.max_order || 0) + 1;

    const result = await db.query(
      `INSERT INTO personal_sheet_rows (user_id, kind, name, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, kind, name, sortOrder]
    );

    return res.status(201).json({
      row: {
        id: result.rows[0]?.id || null,
        kind,
        name,
        sortOrder
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao criar linha da planilha.' });
  }
});

router.patch('/rows/:id', async (req, res) => {
  const userId = req.session.userId;
  const rowId = Number(req.params.id);
  const name = normalizeName(req.body?.name);

  if (!Number.isInteger(rowId) || rowId <= 0 || !name) {
    return res.status(400).json({ error: 'Dados inválidos para atualizar linha.' });
  }

  try {
    const row = await db.get(
      `UPDATE personal_sheet_rows
       SET name = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, kind, name, sort_order`,
      [name, rowId, userId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Linha não encontrada.' });
    }

    return res.json({
      row: {
        id: row.id,
        kind: row.kind,
        name: row.name,
        sortOrder: row.sort_order
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao atualizar linha da planilha.' });
  }
});

router.delete('/rows/:id', async (req, res) => {
  const userId = req.session.userId;
  const rowId = Number(req.params.id);

  if (!Number.isInteger(rowId) || rowId <= 0) {
    return res.status(400).json({ error: 'Linha inválida.' });
  }

  try {
    const result = await db.query(
      'DELETE FROM personal_sheet_rows WHERE id = $1 AND user_id = $2',
      [rowId, userId]
    );

    if ((result.rowCount || 0) <= 0) {
      return res.status(404).json({ error: 'Linha não encontrada.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao excluir linha da planilha.' });
  }
});

router.put('/values', async (req, res) => {
  const userId = req.session.userId;
  const year = parseYear(req.body?.year);
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

  if (!year) {
    return res.status(400).json({ error: 'Ano inválido.' });
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Nenhuma atualização informada.' });
  }

  if (updates.length > 1000) {
    return res.status(400).json({ error: 'Limite de atualizações excedido.' });
  }

  const normalizedUpdates = [];
  for (const item of updates) {
    const rowId = Number(item?.rowId);
    const month = parseMonth(item?.month);

    if (!Number.isInteger(rowId) || rowId <= 0 || !month) {
        return res.status(400).json({ error: 'Atualização inválida: rowId ou month.' });
    }

    const rawAmount = item?.amount;
    const day = parseDay(item?.day);
    const shouldDelete = rawAmount === null || rawAmount === '' || rawAmount === undefined;
    const amount = shouldDelete ? 0 : Number(rawAmount);

    if (!shouldDelete && !Number.isFinite(amount)) {
        return res.status(400).json({ error: 'Atualização inválida: amount deve ser numérico.' });
    }

    if (item?.day !== null && item?.day !== undefined && item?.day !== '' && day === null) {
        return res.status(400).json({ error: 'Atualização inválida: dia deve estar entre 1 e 31.' });
    }

    normalizedUpdates.push({ rowId, month, shouldDelete, amount, day });
  }

  try {
    const rowIds = [...new Set(normalizedUpdates.map((item) => item.rowId))];
    const ownerRows = await db.all(
      'SELECT id FROM personal_sheet_rows WHERE user_id = $1 AND id = ANY($2::bigint[])',
      [userId, rowIds]
    );

    if ((ownerRows || []).length !== rowIds.length) {
      return res.status(400).json({ error: 'Uma ou mais linhas não pertencem ao usuário.' });
    }

    await db.withTransaction(async (client) => {
      for (const item of normalizedUpdates) {
        if (item.shouldDelete) {
          await client.query(
            `DELETE FROM personal_sheet_values
             WHERE user_id = $1 AND row_id = $2 AND year = $3 AND month = $4`,
            [userId, item.rowId, year, item.month]
          );
          continue;
        }

        await client.query(
          `INSERT INTO personal_sheet_values (user_id, row_id, year, month, amount, day_of_month)
           VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, row_id, year, month)
           DO UPDATE SET
             amount = EXCLUDED.amount,
             day_of_month = EXCLUDED.day_of_month,
             updated_at = NOW()`,
          [userId, item.rowId, year, item.month, item.amount, item.day]
        );
      }
    });

    return res.json({ ok: true, updated: normalizedUpdates.length });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao salvar valores da planilha.' });
  }
});

module.exports = router;
