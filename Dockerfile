FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 OPSLEDGER_DB=/app/data/opsledger.sqlite
RUN mkdir /app/data && chown node:node /app/data
COPY --chown=node:node server.js model.js app.js index.html styles.css ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
