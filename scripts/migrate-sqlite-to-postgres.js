require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = require('../models/db');

const sqliteDb = new sqlite3.Database(path.join(__dirname, '../database/ntdriver.db'), (err) => {
  if (err) {
    console.error('Erro ao abrir SQLite:', err.message);
    process.exit(1);
  }
});

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const migrate = async () => {
  try {
    console.log('Iniciando migração do SQLite para PostgreSQL...\n');

    const users = await all('SELECT * FROM users ORDER BY id ASC');
    console.log(`[usuarios] Encontrados ${users.length} usuario(s) no SQLite`);

    if (users.length === 0) {
      console.log('Nenhum usuario para migrar. Encerrando.');
      process.exit(0);
    }

    const userIdMap = {};

    for (const user of users) {
      const exists = await db.get('SELECT id FROM users WHERE email = $1', [user.email]);
      
      if (exists) {
        console.log(`  ✓ usuario ja existe: ${user.email} (id: ${exists.id})`);
        userIdMap[user.id] = exists.id;
      } else {
        const result = await db.query(
          `INSERT INTO users (
            name, email, password_hash, is_admin, profile_type,
            email_verified_at, email_verification_required, created_at, last_login_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            user.name,
            user.email,
            user.password_hash,
            user.is_admin,
            user.profile_type || 'driver',
            user.email_verified_at || null,
            user.email_verification_required || false,
            user.created_at,
            user.last_login_at || null
          ]
        );
        const newId = result.rows[0]?.id;
        userIdMap[user.id] = newId;
        console.log(`  + usuario criado: ${user.email} (novo id: ${newId})`);
      }
    }

    const records = await all('SELECT * FROM records ORDER BY id ASC');
    console.log(`\n[registros] Encontrados ${records.length} registro(s) no SQLite`);

    for (const record of records) {
      const newUserId = userIdMap[record.user_id];
      if (!newUserId) {
        console.log(`  ! registro ignorado (usuario não encontrado): id=${record.id}, user_id=${record.user_id}`);
        continue;
      }

      const exists = await db.get(
        'SELECT id FROM records WHERE user_id = $1 AND date = $2 AND income_value = $3 AND expense_value = $4',
        [newUserId, record.date, record.income_value || 0, record.expense_value || 0]
      );

      if (exists) {
        console.log(`  ✓ registro ja existe: id=${exists.id}, date=${record.date}`);
      } else {
        await db.query(
          `INSERT INTO records (user_id, date, income_value, income_source, expense_value, expense_type, km, hours_worked, operation_notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newUserId,
            record.date,
            record.income_value || 0,
            record.income_source,
            record.expense_value || 0,
            record.expense_type,
            record.km || 0,
            record.hours_worked || 0,
            record.operation_notes
          ]
        );
        console.log(`  + registro criado: id=${record.id}, date=${record.date}`);
      }
    }

    const expenses = await all('SELECT * FROM personal_expenses ORDER BY id ASC');
    console.log(`\n[despesas pessoais] Encontradas ${expenses.length} despesa(s) no SQLite`);

    for (const expense of expenses) {
      const newUserId = userIdMap[expense.user_id];
      if (!newUserId) {
        console.log(`  ! despesa ignorada (usuario não encontrado): id=${expense.id}, user_id=${expense.user_id}`);
        continue;
      }

      const exists = await db.get(
        'SELECT id FROM personal_expenses WHERE user_id = $1 AND description = $2 AND amount = $3 AND date = $4',
        [newUserId, expense.description, expense.amount, expense.date]
      );

      if (exists) {
        console.log(`  ✓ despesa ja existe: id=${exists.id}, ${expense.description}`);
      } else {
        await db.query(
          `INSERT INTO personal_expenses (user_id, entry_key, description, amount, type, category, account, status, status_months, date, due_day, installments, is_fixed, installments_start_month, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            newUserId,
            expense.entry_key || `expense-${expense.id}`,
            expense.description,
            expense.amount,
            expense.type || 'saida',
            expense.category || 'outros',
            expense.account || 'outros',
            expense.status || 'pendente',
            expense.status_months || null,
            expense.date,
            expense.due_day,
            expense.installments,
            expense.is_fixed,
            expense.installments_start_month,
            expense.created_at
          ]
        );
        console.log(`  + despesa criada: id=${expense.id}, ${expense.description}`);
      }
    }

    const documents = await all('SELECT * FROM admin_note_documents ORDER BY id ASC');
    console.log(`\n[documentos de notas] Encontrados ${documents.length} documento(s) no SQLite`);

    for (const document of documents) {
      const newUserId = userIdMap[document.user_id];
      if (!newUserId) continue;
      const exists = await db.get(
        'SELECT id FROM admin_note_documents WHERE user_id = $1 AND title = $2 AND content_html = $3',
        [newUserId, document.title, document.content_html]
      );
      if (!exists) {
        await db.query(
          `INSERT INTO admin_note_documents (user_id, title, content_html, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [newUserId, document.title, document.content_html, document.created_at, document.updated_at]
        );
      }
    }

    const dailyGoals = await all('SELECT * FROM summary_daily_goals ORDER BY id ASC');
    console.log(`\n[metas diarias] Encontradas ${dailyGoals.length} meta(s) no SQLite`);

    for (const dailyGoal of dailyGoals) {
      const newUserId = userIdMap[dailyGoal.user_id];
      if (!newUserId) continue;
      await db.query(
        `INSERT INTO summary_daily_goals (user_id, year_month, day_of_month, goal, day_off, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, year_month, day_of_month)
         DO UPDATE SET goal = EXCLUDED.goal, day_off = EXCLUDED.day_off, updated_at = EXCLUDED.updated_at`,
        [
          newUserId,
          dailyGoal.year_month,
          dailyGoal.day_of_month,
          dailyGoal.goal,
          Boolean(dailyGoal.day_off),
          dailyGoal.created_at,
          dailyGoal.updated_at
        ]
      );
    }

    const tokens = await all('SELECT * FROM password_reset_tokens ORDER BY id ASC');
    console.log(`\n[tokens de reset] Encontrados ${tokens.length} token(s) no SQLite`);

    for (const token of tokens) {
      const newUserId = userIdMap[token.user_id];
      if (!newUserId) {
        console.log(`  ! token ignorado (usuario não encontrado): id=${token.id}, user_id=${token.user_id}`);
        continue;
      }

      const exists = await db.get(
        'SELECT id FROM password_reset_tokens WHERE user_id = $1 AND token_hash = $2',
        [newUserId, token.token_hash]
      );

      if (exists) {
        console.log(`  ✓ token ja existe: id=${exists.id}`);
      } else {
        await db.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            newUserId,
            token.token_hash,
            token.expires_at,
            token.used_at,
            token.created_at
          ]
        );
        console.log(`  + token criado: id=${token.id}`);
      }
    }

    console.log('\n✓ Migração concluida com sucesso!');
    console.log(`  - ${users.length} usuario(s)`);
    console.log(`  - ${records.length} registro(s)`);
    console.log(`  - ${expenses.length} despesa(s)`);
    console.log(`  - ${documents.length} documento(s) de notas`);
    console.log(`  - ${dailyGoals.length} meta(s) diaria(s)`);
    console.log(`  - ${tokens.length} token(s) de reset`);

  } catch (error) {
    console.error('Erro durante a migração:', error.message);
    process.exit(1);
  } finally {
    sqliteDb.close();
    await db.pool.end();
  }
};

migrate();
