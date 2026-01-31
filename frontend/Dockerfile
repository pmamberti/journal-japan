FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create placeholder icons (you can replace these later)
RUN apk add --no-cache imagemagick && \
    convert -size 192x192 xc:'#667eea' /usr/share/nginx/html/icon-192.png && \
    convert -size 512x512 xc:'#667eea' /usr/share/nginx/html/icon-512.png && \
    apk del imagemagick

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
