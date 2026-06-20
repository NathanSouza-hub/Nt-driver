require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDb, pool, isPostgres, dialect, sqliteFile } = require('./models/db');
const recordsRouter = require('./routes/records');
const authRouter = require('./routes/auth');
const personalExpensesRouter = require('./routes/personal-expenses');
const personalSheetRouter = require('./routes/personal-sheet');
const adminNotesRouter = require('./routes/admin-notes');
const summaryGoalsRouter = require('./routes/summary-goals');
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'nt-driver-dev-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
// In production, auto enables secure cookies on HTTPS and keeps HTTP working locally.
const COOKIE_SECURE_MODE = IS_PRODUCTION ? 'auto' : false;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME || 'user_sessions';

if (!SESSION_SECRET || SESSION_SECRET === 'nt-driver-dev-secret') {
  console.warn('[security] SESSION_SECRET padrao em uso. Defina SESSION_SECRET forte em producao.');
}

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PRODUCTION ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = String(req.ip || '');
    return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
  },
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});

const AUTH_LIMITED_ROUTES = new Set([
  'POST /login',
  'POST /register',
  'POST /resend-verification',
  'POST /forgot-password',
  'POST /reset-password',
  'POST /change-password'
]);

const authSelectiveLimiter = (req, res, next) => {
  const key = `${req.method.toUpperCase()} ${req.path}`;
  if (!AUTH_LIMITED_ROUTES.has(key)) {
    return next();
  }
  return authLimiter(req, res, next);
};

const publicPath = path.join(__dirname, 'public');
const distPath = path.join(__dirname, 'dist');
const frontendPath = fs.existsSync(path.join(distPath, 'index.html')) ? distPath : publicPath;

const setNoCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (String(filePath || '').endsWith('index.html')) {
      setNoCacheHeaders(res);
    }
  }
}));
if (frontendPath !== publicPath) {
  app.use(express.static(publicPath, {
    setHeaders: (res, filePath) => {
      const normalizedPath = String(filePath || '');
      if (normalizedPath.endsWith('manifest.json')) {
        setNoCacheHeaders(res);
      }
    }
  }));
}
app.use(express.json());

const sessionConfig = {
  name: 'ntdriver.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE_MODE,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};

if (IS_PRODUCTION && isPostgres) {
  sessionConfig.store = new PgSession({
    pool,
    tableName: SESSION_TABLE_NAME,
    createTableIfMissing: true
  });
}

app.use(session({
  ...sessionConfig
}));

app.use('/api/auth', authSelectiveLimiter);
app.use('/api/auth', authRouter);
app.use('/api/records', recordsRouter);
app.use('/api/personal-expenses', personalExpensesRouter);
app.use('/api/personal-sheet', personalSheetRouter);
app.use('/api/admin-notes', adminNotesRouter);
app.use('/api/summary-goals', summaryGoalsRouter);

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, service: 'nt-driver' });
});


// Fallback para SPA: qualquer rota que nao seja API retorna a interface ativa.
app.get(/^\/(?!api).*/, (req, res) => {
  setNoCacheHeaders(res);
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const startServer = async () => {
  try {
    await initDb();
    if (!isPostgres) {
      console.log(`[database] SQLite ativo em ${sqliteFile}`);
    } else {
      console.log(`[database] PostgreSQL ativo via ${dialect}`);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Nt driver rodando em http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Falha ao iniciar a aplicacao:', error.message);
    process.exit(1);
  }
};

startServer();
