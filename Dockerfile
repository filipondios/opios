FROM oven/bun:1-slim
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY preguntas ./preguntas
ENV HOST=0.0.0.0 \
    PORT=10000 \
    OPIOS_DB=/data/opios.db
RUN mkdir -p /data
VOLUME /data
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]