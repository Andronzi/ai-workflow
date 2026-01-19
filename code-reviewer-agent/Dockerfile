# 1️⃣ Stage: build
FROM node:20 AS build

WORKDIR /app

# Копируем package + tsconfig
COPY package*.json ./
COPY tsconfig*.json ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходники
COPY src ./src

# Собираем TypeScript (common должен быть установлен через npm)
RUN npm run build

# 2️⃣ Stage: production
FROM node:20-alpine AS production

WORKDIR /app

# Копируем package.json
COPY package*.json ./
RUN npm ci --omit=dev

# Копируем скомпилированный код
COPY --from=build /app/dist ./dist

EXPOSE 3002
CMD ["node", "dist/index.js"]