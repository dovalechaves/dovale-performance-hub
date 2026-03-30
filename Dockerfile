FROM node:22-alpine

WORKDIR /app

# Copia só o package.json primeiro — aproveita cache se não mudar
COPY package*.json ./

RUN npm ci --omit=dev

# Copia o restante do código
COPY . .

EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
