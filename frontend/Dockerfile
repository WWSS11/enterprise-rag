ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginx:1.29-alpine

FROM ${NODE_IMAGE} AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_HOST_IP=127.0.0.1
ARG VITE_APP_ORIGIN=http://127.0.0.1:3000
ARG VITE_API_BASE_URL=http://127.0.0.1:8000
ARG VITE_OIDC_AUTHORITY=http://127.0.0.1:18080/realms/enterprise-rag
ARG VITE_OIDC_CLIENT_ID=enterprise-rag-web
ARG VITE_OIDC_SCOPE="openid profile email"

ENV VITE_HOST_IP=${VITE_HOST_IP} \
    VITE_APP_ORIGIN=${VITE_APP_ORIGIN} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_OIDC_AUTHORITY=${VITE_OIDC_AUTHORITY} \
    VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID} \
    VITE_OIDC_SCOPE=${VITE_OIDC_SCOPE}

RUN npm run build

FROM ${NGINX_IMAGE}

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
