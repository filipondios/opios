# syntax=docker/dockerfile:1
# Imagen fijada a una versión concreta de Bun para que las compilaciones sean reproducibles.
FROM oven/bun:1.4.3-slim
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY preguntas ./preguntas
ENV HOST=0.0.0.0 \
    PORT=10000 \
    OPIOS_DB=/data/opios.db \
    TZ=Europe/Madrid
# El usuario `bun` debe poder escribir la base de datos en el volumen.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 10000
# Para acceder por una IP de la LAN añade su nombre/IP a ALLOWED_HOSTS (por defecto solo loopback).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
