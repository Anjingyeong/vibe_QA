FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY README.md ./

RUN mkdir -p /app/artifacts && chown -R pwuser:pwuser /app/artifacts

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    VIBECHECK_JOB_STORE=/app/artifacts/web/jobs.json

USER pwuser
EXPOSE 8787

CMD ["node", "src/web/server.js"]
