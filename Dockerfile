# O servico no Render usa o runtime Docker: este arquivo e obrigatorio para o deploy.
# trixie: o binario do sqlite3 6 exige glibc >= 2.38 (a imagem slim padrao, bookworm, tem 2.36).
FROM node:24.12.0-trixie-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
