# Etapa 1: Build do Frontend (Vite) com Node.js
FROM node:20-bullseye AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html main.js style.css vite.config.js* ./
COPY public ./public
COPY src ./src
RUN npm run build

# Etapa 2: Servidor Python com dependências
# Usamos Debian Bullseye porque ele vem com OpenSSL 1.1 nativo (com suporte ao RC2 da Adobe)
FROM python:3.9-bullseye
WORKDIR /app

# Instalar gunicorn e dependências da API
COPY api/requirements.txt ./api/
RUN pip install --no-cache-dir -r api/requirements.txt gunicorn

# Copiar código Python
COPY api ./api

# Copiar o Frontend compilado da Etapa 1
COPY --from=frontend-builder /app/dist ./dist

# Definir as permissões adequadas
RUN chmod -R 777 /tmp

# Expor a porta 10000 (Padrão para vários hosts, mas usamos a porta que o ambiente injetar)
ENV PORT=10000
EXPOSE $PORT

# Rodar o Gunicorn apontando para a aplicação Flask em api/index.py
CMD gunicorn -w 2 -b 0.0.0.0:$PORT api.index:app
