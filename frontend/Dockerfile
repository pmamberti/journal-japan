FROM node:20-alpine@sha256:afdf98210b07b586eb71fa22ba2e432e058e4cd1304d31ed60888755b8c865fb AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine@sha256:1d40e3eb3bf4f138de1d67193f2aa5309fcaf343eb5ffadbf5e9439de1eb1ebb

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create placeholder icons (you can replace these later)
RUN apk add --no-cache imagemagick && \
    convert -size 192x192 xc:'#667eea' /usr/share/nginx/html/icon-192.png && \
    convert -size 512x512 xc:'#667eea' /usr/share/nginx/html/icon-512.png && \
    apk del imagemagick

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
