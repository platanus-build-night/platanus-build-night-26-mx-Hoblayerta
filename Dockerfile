FROM node:22-alpine
WORKDIR /app

# Instala dependencias (mppx y el MCP SDK son ESM; se corre con tsx, no se compila).
COPY package.json package-lock.json* ./
RUN npm install

# Copia el código.
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
# El host de deploy normalmente inyecta PORT; el server lo respeta.
EXPOSE 8787
# Se ejecuta con tsx para soportar dependencias ESM sin paso de build.
CMD ["npm", "start"]
