# 1️⃣ Stage: build
FROM node:20 AS build

WORKDIR /app

# Копируем package + tsconfig
COPY package*.json ./
COPY tsconfig*.json ./

# Устанавливаем все зависимости (для сборки нужны devDeps)
RUN npm ci

# Копируем исходники
COPY src ./src

# Собираем TypeScript
RUN npm run build

# 2️⃣ Stage: production
FROM node:20 AS production

WORKDIR /app

# Копируем только package.json + production зависимости
COPY package*.json ./
RUN npm ci --omit=dev

# Копируем только скомпилированный JS
COPY --from=build /app/dist ./dist

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=3001

# Порт
EXPOSE 3001

# Запуск
CMD ["node", "dist/index.js"]