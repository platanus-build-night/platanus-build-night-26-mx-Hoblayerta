FROM node:22-alpine
WORKDIR /app

# Instala dependencias (incluye dev para compilar TS).
COPY package.json package-lock.json* ./
RUN npm install

# Copia el código y compila a dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
# El host de deploy normalmente inyecta PORT; el server lo respeta.
EXPOSE 8787
CMD ["node", "dist/server.js"]
