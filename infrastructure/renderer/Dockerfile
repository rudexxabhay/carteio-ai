# Build manually on the isolated Linux worker. Never mount API files or credentials.
FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY package.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY worker.mjs render-page.mjs ./
ENV HOME=/tmp
USER pwuser
CMD ["node", "/app/worker.mjs"]
