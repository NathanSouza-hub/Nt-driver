const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';
const explicitDialect = String(process.env.DB_CLIENT || '').trim().toLowerCase();
const defaultSqliteFile = process.env.NODE_ENV === 'production'
  ? '/data/ntdriver.db'
  : path.join(__dirname, '..', 'database', 'ntdriver.db');
const SQLITE_FILE = process.env.SQLITE_FILE || process.env.DATABASE_FILE || defaultSqliteFile;
const dialect = explicitDialect || (DATABASE_URL ? 'postgres' : 'sqlite');
const isPostgres = dialect === 'postgres';

if (dialect !== 'postgres' && dialect !== 'sqlite') {
  console.error(`DB_CLIENT invalido: "${dialect}". Use "postgres" ou "sqlite".`);
  process.exit(1);
}

if (isPostgres && !DATABASE_URL) {
  console.error('DATABASE_URL nao foi definida para o modo postgres.');
  process.exit(1);
}

let pgPool = null;
let sqliteDb = null;

const getPostgresSslConfig = (databaseUrl) => {
  if (!databaseUrl) return false;

  try {
    const parsedUrl = new URL(databaseUrl);
    const sslMode = String(process.env.PGSSLMODE || parsedUrl.searchParams.get('sslmode') || '').trim().toLowerCase();
    const sslFlag = String(parsedUrl.searchParams.get('ssl') || '').trim().toLowerCase();
    const hostname = String(parsedUrl.hostname || '').trim().toLowerCase();

    if (sslFlag === 'false' || sslFlag === '0') return false;
    if (sslMode === 'disable' || sslMode === 'allow' || sslMode === 'prefer') return false;
    if (hostname.endsWith('.internal')) return false;

    return {
      rejectUnauthorized: false
    };
  } catch (error) {
    return {
      rejectUnauthorized: false
    };
  }
};

const normalizeSqliteValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

const normalizeSqliteError = (error) => {
  if (!error) return error;
  if (error.code === 'SQLITE_CONSTRAINT' && /unique|UNIQUE constraint failed/i.test(String(error.message || ''))) {
    error.code = '23505';
  }
  return error;
};

const openSqlite = (filename) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(filename, (error) => {
    if (error) return reject(normalizeSqliteError(error));
    return resolve(db);
  });
});

const closeSqlite = (db) => new Promise((resolve, reject) => {
  db.close((error) => {
    if (error) return reject(normalizeSqliteError(error));
    return resolve();
  });
});

const runSqlite = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(error) {
    if (error) return reject(normalizeSqliteError(error));
    return resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const getSqlite = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => {
    if (error) return reject(normalizeSqliteError(error));
    return resolve(row || null);
  });
});

const allSqlite = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => {
    if (error) return reject(normalizeSqliteError(error));
    return resolve(rows || []);
  });
});

const execSqlite = (db, sql) => new Promise((resolve, reject) => {
  db.exec(sql, (error) => {
    if (error) return reject(normalizeSqliteError(error));
    return resolve();
  });
});

const compileSqliteStatement = (sql, params = []) => {
  let compiledSql = String(sql || '');
  const compiledParams = [];

  compiledSql = compiledSql.replace(/=\s*ANY\(\$(\d+)::[A-Za-z_][A-Za-z0-9_\[\]]*\)/gi, (_, indexText) => {
    const index = Number(indexText) - 1;
    const values = Array.isArray(params[index]) ? params[index] : [];
    if (!values.length) return 'IN (NULL)';
    values.forEach((value) => compiledParams.push(normalizeSqliteValue(value)));
    return `IN (${values.map(() => '?').join(', ')})`;
  });

  compiledSql = compiledSql
    .replace(/::[A-Za-z_][A-Za-z0-9_\[\]]*/g, '')
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bBTRIM\(/gi, 'TRIM(')
    .replace(/\bCONCAT\(\s*'expense-',\s*id\s*\)/gi, "('expense-' || id)")
    .replace(/SUBSTRING\(\s*([^)]+?)\s+FROM\s+(\d+)\s+FOR\s+(\d+)\s*\)/gi, 'SUBSTR($1, $2, $3)');

  compiledSql = compiledSql.replace(/\$(\d+)/g, (_, indexText) => {
    const index = Number(indexText) - 1;
    compiledParams.push(normalizeSqliteValue(params[index]));
    return '?';
  });

  return {
    sql: compiledSql,
    params: compiledParams
  };
};

const sqliteQueryInternal = async (db, sql, params = []) => {
  const compiled = compileSqliteStatement(sql, params);
  const normalizedSql = compiled.sql.trim().toUpperCase();
  const shouldReadRows = /\bRETURNING\b/i.test(compiled.sql)
    || normalizedSql.startsWith('SELECT')
    || normalizedSql.startsWith('WITH')
    || normalizedSql.startsWith('PRAGMA');

  if (shouldReadRows) {
    const rows = await allSqlite(db, compiled.sql, compiled.params);
    return { rows, rowCount: rows.length };
  }

  const result = await runSqlite(db, compiled.sql, compiled.params);
  return {
    rows: [],
    rowCount: Number(result.changes || 0),
    lastID: result.lastID
  };
};

const sqliteGetInternal = async (db, sql, params = []) => {
  const result = await sqliteQueryInternal(db, sql, params);
  if (result.rows && result.rows.length) return result.rows[0];

  const compiled = compileSqliteStatement(sql, params);
  const normalizedSql = compiled.sql.trim().toUpperCase();
  if (normalizedSql.startsWith('SELECT') || normalizedSql.startsWith('PRAGMA') || /\bRETURNING\b/i.test(compiled.sql)) {
    return getSqlite(db, compiled.sql, compiled.params);
  }

  return null;
};

const sqliteAllInternal = async (db, sql, params = []) => {
  const compiled = compileSqliteStatement(sql, params);
  return allSqlite(db, compiled.sql, compiled.params);
};

if (isPostgres) {
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: getPostgresSslConfig(DATABASE_URL)
  });

  pgPool.on('error', (error) => {
    console.error('Erro inesperado no pool PostgreSQL:', error.message);
  });
} else {
  fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
  sqliteDb = new sqlite3.Database(SQLITE_FILE, (error) => {
    if (error) {
      console.error('Falha ao abrir SQLite:', error.message);
      process.exit(1);
    }
  });
}

const query = (text, params = []) => {
  if (isPostgres) return pgPool.query(text, params);
  return sqliteQueryInternal(sqliteDb, text, params);
};

const get = async (text, params = []) => {
  if (isPostgres) {
    const result = await query(text, params);
    return result.rows[0] || null;
  }
  return sqliteGetInternal(sqliteDb, text, params);
};

const all = async (text, params = []) => {
  if (isPostgres) {
    const result = await query(text, params);
    return result.rows || [];
  }
  return sqliteAllInternal(sqliteDb, text, params);
};

const withTransaction = async (handler) => {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const transactionDb = await openSqlite(SQLITE_FILE);
  const client = {
    query: (sql, params = []) => sqliteQueryInternal(transactionDb, sql, params),
    get: (sql, params = []) => sqliteGetInternal(transactionDb, sql, params),
    all: (sql, params = []) => sqliteAllInternal(transactionDb, sql, params)
  };

  try {
    await execSqlite(transactionDb, 'PRAGMA foreign_keys = ON;');
    await execSqlite(transactionDb, 'BEGIN IMMEDIATE;');
    const result = await handler(client);
    await execSqlite(transactionDb, 'COMMIT;');
    return result;
  } catch (error) {
    try {
      await execSqlite(transactionDb, 'ROLLBACK;');
    } catch (rollbackError) {
      console.error('Falha ao fazer rollback no SQLite:', rollbackError.message);
    }
    throw error;
  } finally {
    await closeSqlite(transactionDb);
  }
};

const ensureSqliteColumn = async (tableName, columnName, definition) => {
  const columns = await allSqlite(sqliteDb, `PRAGMA table_info(${tableName})`);
  if ((columns || []).some((column) => column.name === columnName)) return;
  await execSqlite(sqliteDb, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

const initPostgresDb = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      email_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);

  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_type TEXT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE');
  await query(`
    UPDATE users
    SET profile_type = 'driver'
    WHERE profile_type IS NULL OR profile_type = ''
  `);
  await query("ALTER TABLE users ALTER COLUMN profile_type SET DEFAULT 'driver'");
  await query('ALTER TABLE users ALTER COLUMN profile_type SET NOT NULL');
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_type_check'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_profile_type_check
        CHECK (profile_type IN ('driver', 'personal'));
      END IF;
    END $$;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS records (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      income_value DOUBLE PRECISION DEFAULT 0,
      income_source TEXT,
      expense_value DOUBLE PRECISION DEFAULT 0,
      expense_type TEXT,
      km DOUBLE PRECISION DEFAULT 0,
      hours_worked DOUBLE PRECISION DEFAULT 0,
      operation_notes TEXT
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, date)');

  await query(`
    CREATE TABLE IF NOT EXISTS personal_expenses (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_key TEXT,
      description TEXT,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      type TEXT DEFAULT 'saida',
      category TEXT DEFAULT 'outros',
      account TEXT DEFAULT 'outros',
      status TEXT DEFAULT 'pendente',
      status_months TEXT,
      date TEXT NOT NULL,
      due_day INTEGER,
      installments TEXT,
      is_fixed BOOLEAN,
      installments_start_month TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query('ALTER TABLE personal_expenses ADD COLUMN IF NOT EXISTS entry_key TEXT');
  await query('ALTER TABLE personal_expenses ADD COLUMN IF NOT EXISTS status_months TEXT');
  await query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY
            user_id,
            COALESCE(description, ''),
            amount,
            COALESCE(type, 'saida'),
            COALESCE(category, 'outros'),
            COALESCE(account, 'outros'),
            COALESCE(status, 'pendente'),
            COALESCE(status_months, ''),
            date,
            COALESCE(due_day, -1),
            COALESCE(installments, ''),
            COALESCE(is_fixed::text, 'null'),
            COALESCE(installments_start_month, '')
          ORDER BY id DESC
        ) AS duplicate_rank
      FROM personal_expenses
    )
    DELETE FROM personal_expenses AS expenses
    USING ranked
    WHERE expenses.id = ranked.id
      AND ranked.duplicate_rank > 1
  `);
  await query(`
    UPDATE personal_expenses
    SET entry_key = CONCAT('expense-', id)
    WHERE entry_key IS NULL OR BTRIM(entry_key) = ''
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_id ON personal_expenses(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_date ON personal_expenses(user_id, date)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_expenses_user_entry_key ON personal_expenses(user_id, entry_key)');

  await query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_email_verification_user_id ON email_verification_tokens(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_email_verification_hash ON email_verification_tokens(token_hash)');

  await query(`
    CREATE TABLE IF NOT EXISTS admin_notes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      content_html TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_admin_notes_user_id ON admin_notes(user_id)');

  await query(`
    CREATE TABLE IF NOT EXISTS admin_note_documents (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Arquivo sem titulo',
      content_html TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_admin_note_documents_user_id ON admin_note_documents(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_admin_note_documents_user_updated ON admin_note_documents(user_id, updated_at DESC, id DESC)');

  await query(`
    INSERT INTO admin_note_documents (user_id, title, content_html, created_at, updated_at)
    SELECT user_id, 'Bloco principal', content_html, created_at, updated_at
    FROM admin_notes legacy
    WHERE NOT EXISTS (
      SELECT 1
      FROM admin_note_documents docs
      WHERE docs.user_id = legacy.user_id
    )
  `);

  await query(`
    CREATE OR REPLACE FUNCTION set_admin_notes_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await query('DROP TRIGGER IF EXISTS trg_admin_notes_updated_at ON admin_notes');
  await query(`
    CREATE TRIGGER trg_admin_notes_updated_at
    BEFORE UPDATE ON admin_notes
    FOR EACH ROW
    EXECUTE FUNCTION set_admin_notes_updated_at()
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash)');

  await query(`
    CREATE TABLE IF NOT EXISTS personal_sheet_rows (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS personal_sheet_values (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      row_id BIGINT NOT NULL REFERENCES personal_sheet_rows(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, row_id, year, month)
    )
  `);

  await query('ALTER TABLE personal_sheet_values ADD COLUMN IF NOT EXISTS day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31)');

  await query('CREATE INDEX IF NOT EXISTS idx_personal_sheet_rows_user ON personal_sheet_rows(user_id, kind, sort_order, id)');
  await query('CREATE INDEX IF NOT EXISTS idx_personal_sheet_values_user_year_month ON personal_sheet_values(user_id, year, month)');

  await query(`
    CREATE TABLE IF NOT EXISTS summary_daily_goals (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year_month TEXT NOT NULL,
      day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
      goal DOUBLE PRECISION,
      day_off BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, year_month, day_of_month)
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_summary_daily_goals_user_month ON summary_daily_goals(user_id, year_month)');

  await query(`
    CREATE OR REPLACE FUNCTION set_personal_sheet_values_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await query('DROP TRIGGER IF EXISTS trg_personal_sheet_values_updated_at ON personal_sheet_values');
  await query(`
    CREATE TRIGGER trg_personal_sheet_values_updated_at
    BEFORE UPDATE ON personal_sheet_values
    FOR EACH ROW
    EXECUTE FUNCTION set_personal_sheet_values_updated_at()
  `);

  await query(`
    CREATE OR REPLACE FUNCTION set_summary_daily_goals_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await query('DROP TRIGGER IF EXISTS trg_summary_daily_goals_updated_at ON summary_daily_goals');
  await query(`
    CREATE TRIGGER trg_summary_daily_goals_updated_at
    BEFORE UPDATE ON summary_daily_goals
    FOR EACH ROW
    EXECUTE FUNCTION set_summary_daily_goals_updated_at()
  `);
};

const initSqliteDb = async () => {
  await execSqlite(sqliteDb, 'PRAGMA foreign_keys = ON;');
  await execSqlite(sqliteDb, 'PRAGMA busy_timeout = 5000;');
  await allSqlite(sqliteDb, 'PRAGMA journal_mode = WAL;');

  await execSqlite(sqliteDb, `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      email_verification_required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      profile_type TEXT NOT NULL DEFAULT 'driver' CHECK (profile_type IN ('driver', 'personal'))
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      income_value REAL DEFAULT 0,
      income_source TEXT,
      expense_value REAL DEFAULT 0,
      expense_type TEXT,
      km REAL DEFAULT 0,
      hours_worked REAL DEFAULT 0,
      operation_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_key TEXT,
      description TEXT,
      amount REAL NOT NULL DEFAULT 0,
      type TEXT DEFAULT 'saida',
      category TEXT DEFAULT 'outros',
      account TEXT DEFAULT 'outros',
      status TEXT DEFAULT 'pendente',
      status_months TEXT,
      date TEXT NOT NULL,
      due_day INTEGER,
      installments TEXT,
      is_fixed INTEGER,
      installments_start_month TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      content_html TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_note_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Arquivo sem titulo',
      content_html TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS personal_sheet_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS personal_sheet_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      row_id INTEGER NOT NULL REFERENCES personal_sheet_rows(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, row_id, year, month)
    );

    CREATE TABLE IF NOT EXISTS summary_daily_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year_month TEXT NOT NULL,
      day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
      goal REAL,
      day_off INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, year_month, day_of_month)
    );

    CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
    CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_id ON personal_expenses(user_id);
    CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_date ON personal_expenses(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_admin_notes_user_id ON admin_notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_note_documents_user_id ON admin_note_documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_note_documents_user_updated ON admin_note_documents(user_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verification_user_id ON email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_hash ON email_verification_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_personal_sheet_rows_user ON personal_sheet_rows(user_id, kind, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_personal_sheet_values_user_year_month ON personal_sheet_values(user_id, year, month);
    CREATE INDEX IF NOT EXISTS idx_summary_daily_goals_user_month ON summary_daily_goals(user_id, year_month);
  `);

  await ensureSqliteColumn('users', 'profile_type', "TEXT NOT NULL DEFAULT 'driver'");
  await ensureSqliteColumn('users', 'last_login_at', 'TEXT');
  await ensureSqliteColumn('users', 'email_verified_at', 'TEXT');
  await ensureSqliteColumn('users', 'email_verification_required', 'INTEGER NOT NULL DEFAULT 0');
  await ensureSqliteColumn('personal_expenses', 'entry_key', 'TEXT');
  await ensureSqliteColumn('personal_expenses', 'status_months', 'TEXT');
  await ensureSqliteColumn('personal_sheet_values', 'day_of_month', 'INTEGER');

  await query(`
    UPDATE users
    SET profile_type = 'driver'
    WHERE profile_type IS NULL OR profile_type = ''
  `);

  await query(`
    DELETE FROM personal_expenses
    WHERE id IN (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY
              user_id,
              COALESCE(description, ''),
              amount,
              COALESCE(type, 'saida'),
              COALESCE(category, 'outros'),
              COALESCE(account, 'outros'),
              COALESCE(status, 'pendente'),
              COALESCE(status_months, ''),
              date,
              COALESCE(due_day, -1),
              COALESCE(installments, ''),
              COALESCE(CAST(is_fixed AS TEXT), 'null'),
              COALESCE(installments_start_month, '')
            ORDER BY id DESC
          ) AS duplicate_rank
        FROM personal_expenses
      ) ranked
      WHERE ranked.duplicate_rank > 1
    )
  `);

  await query(`
    UPDATE personal_expenses
    SET entry_key = ('expense-' || id)
    WHERE entry_key IS NULL OR TRIM(entry_key) = ''
  `);

  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_expenses_user_entry_key ON personal_expenses(user_id, entry_key)');

  await query(`
    INSERT INTO admin_note_documents (user_id, title, content_html, created_at, updated_at)
    SELECT user_id, 'Bloco principal', content_html, created_at, updated_at
    FROM admin_notes legacy
    WHERE NOT EXISTS (
      SELECT 1
      FROM admin_note_documents docs
      WHERE docs.user_id = legacy.user_id
    )
  `);
};

const initDb = async () => {
  if (isPostgres) await initPostgresDb();
  else await initSqliteDb();

  const adminCountRow = await get('SELECT COUNT(*) AS count FROM users WHERE is_admin = TRUE');
  if (Number(adminCountRow?.count || 0) <= 0) {
    await query(`
      UPDATE users
      SET is_admin = TRUE
      WHERE id = (
        SELECT id FROM users ORDER BY id DESC LIMIT 1
      )
    `);
  }
};

const close = async () => {
  if (isPostgres && pgPool) {
    await pgPool.end();
    return;
  }

  if (sqliteDb) {
    const db = sqliteDb;
    sqliteDb = null;
    await closeSqlite(db);
  }
};

const pool = isPostgres
  ? pgPool
  : {
    end: close
  };

module.exports = {
  pool,
  query,
  get,
  all,
  withTransaction,
  initDb,
  close,
  dialect,
  isPostgres,
  sqliteFile: isPostgres ? null : SQLITE_FILE
};
