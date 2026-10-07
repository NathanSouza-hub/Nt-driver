# NT Driver - Estrutura do Projeto

Este projeto esta organizado para separar claramente backend, frontend e configuracoes.

## Raiz do projeto

A raiz e a pasta principal que contem `package.json` e `server.js`.
No seu caso: `C:\Users\natha\Nt driver`

## Estrutura atual

- `server.js`: ponto de entrada do servidor Express
- `.env`: configuracoes locais (nao versionar)
- `.env.example`: modelo de configuracoes
- `package.json`: dependencias e scripts
- `database/`: banco SQLite local (arquivos `.db`)
- `models/`: camada de acesso e inicializacao do banco
- `routes/`: rotas da API (`auth`, `records`, `personal-expenses`)
- `middleware/`: middlewares de autenticacao/autorizacao
- `public/`: frontend (HTML, CSS, JS, logo)

## Regra simples para nao se perder

- Tudo que e API/seguranca/autenticacao fica em `server.js`, `routes/`, `middleware/`, `models/`
- Tudo que e tela/visual/interacao do usuario fica em `public/`
- Tudo que e segredo/credencial fica em `.env` (na raiz)

## Checklist rapido antes de rodar

1. Para localhost, use `.env.local` e rode `npm run start:local`
2. Rodar `npm install`
3. Abrir `http://localhost:3000`
4. Se der erro de porta, liberar porta 3000 e iniciar novamente

## Rodar em localhost

O projeto tem um arquivo `.env.local` para rodar o ambiente local sem depender do servidor de producao.
Ele usa SQLite em `database/ntdriver.db` e define `APP_BASE_URL=http://localhost:3000`.

```bash
npm run start:local
```

Depois acesse:

```text
http://localhost:3000
```

## Variaveis essenciais do `.env`

- `SESSION_SECRET`: chave longa e aleatoria
- `DB_CLIENT`: `sqlite` para banco no mesmo app ou `postgres` para banco externo
- `SQLITE_FILE`: caminho do arquivo SQLite (ex.: `database/ntdriver.db` em localhost)
- `DATABASE_URL`: URL do PostgreSQL/Supabase quando `DB_CLIENT=postgres`
- `APP_BASE_URL`: URL publica do app (ou localhost em desenvolvimento)
- `SESSION_TABLE_NAME`: opcional, nome da tabela de sessao no PostgreSQL (padrao: `user_sessions`)
- `PUBLIC_REGISTER_ENABLED`: `true` para liberar cadastro na tela de login mesmo com usuarios existentes
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: envio de email para recuperação de senha e confirmação de cadastro
- `EMAIL_VERIFICATION_TOKEN_MINUTES`: validade do link de confirmação de email

## Deploy basico (backend + frontend juntos)

1. Defina no `.env` de producao:
	- `NODE_ENV=production`
	- `APP_BASE_URL=https://SEU-DOMINIO-PUBLICO`
	- para banco no mesmo app: `DB_CLIENT=sqlite` e `SQLITE_FILE=/data/ntdriver.db`
	- para PostgreSQL externo: `DB_CLIENT=postgres` e `DATABASE_URL` apontando para Supabase
	- `SESSION_SECRET` forte
2. Instale dependencias: `npm install`
3. Se estiver migrando historico do SQLite: `npm run migrate:sqlite-to-postgres`
4. Inicie o app: `npm start`
5. Abra `https://SEU-DOMINIO-PUBLICO` e valide login e dados

## Cadastro com verificação de email

- Novos cadastros públicos precisam confirmar o email antes do primeiro login.
- O sistema envia um link de verificação usando o SMTP configurado.
- Senhas novas precisam ter no mínimo 8 caracteres com letra maiúscula, minúscula, número e caractere especial.
- Usuários antigos continuam funcionando; a exigência vale para novas contas criadas no fluxo público.

## Sessao em producao

- Em `NODE_ENV=production` com `DB_CLIENT=postgres`, o app usa `connect-pg-simple` para salvar sessao no PostgreSQL.
- Em `DB_CLIENT=sqlite`, a sessao fica no store padrao do processo; reinicios e deploys encerram sessoes ativas.

## Deploy no Render

O arquivo `render.yaml` descreve o servico (Blueprint). Com o repositorio conectado no Render,
cada push na branch `main` gera um deploy automatico.

1. No Render: New + Blueprint, escolher este repositorio (le o `render.yaml`)
2. Preencher as variaveis marcadas como `sync: false`:
	- `DATABASE_URL` do PostgreSQL/Supabase
	- `APP_BASE_URL` com a URL publica do Render
	- `RESEND_API_KEY` e `RESEND_FROM` (ex.: `NT Driver <nao-responda@seudominio.com>`, com o dominio verificado no Resend)
3. O Render roda `npm ci && npm run build` e depois `npm start`
4. No plano gratuito o disco nao e persistente: use `DB_CLIENT=postgres` (SQLite perderia os dados)

## Checklist final de publicacao

1. Confirmar variaveis no ambiente de producao:
	- `NODE_ENV=production`
	- `PORT=3000`
	- `SESSION_SECRET` forte
	- `APP_BASE_URL` com URL publica HTTPS
	- `DATABASE_URL` do Supabase
	- `SESSION_TABLE_NAME=user_sessions` (opcional)
2. Rodar local antes de publicar:
	- `npm install`
	- `npm start`
	- validar `http://localhost:3000/healthz`
3. Migrar dados antigos (se ainda nao migrou):
	- `npm run migrate:sqlite-to-postgres`
4. Publicar no provedor (sugestao: Render):
	- New + Web Service
	- conectar este repositorio
	- Build Command: `npm ci && npm run build`
	- Start Command: `npm start`
	- adicionar todas as variaveis de ambiente acima
	- Health Check Path: `/healthz`
5. Configurar dominio proprio (opcional):
	- no Render: Settings + Custom Domains
	- apontar DNS no seu provedor para o destino indicado pelo Render
	- atualizar `APP_BASE_URL` para o dominio final HTTPS
6. Validacao final:
	- login de admin
	- listar registros e despesas
	- criar novo usuario no painel admin
	- reset de senha
	- logout e login novamente

## Observacao de seguranca

- Nunca exponha `.env` nem credenciais do Supabase em repositorio publico.
- Se alguma senha/chave foi compartilhada, gere novas credenciais imediatamente.

## Observacoes

- Nunca colocar `.env` dentro de `public/`
- Nunca enviar senha/URL completa do banco em chat
- `public/` e acessivel no navegador; backend nao
