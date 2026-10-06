# O servico no Render usa o runtime Docker: este arquivo e obrigatorio para o deploy.
FROM node:24.12.0-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
