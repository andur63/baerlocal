# Multi-stage image for the BärGPT React frontend (Turborepo monorepo).
FROM node:24.18.0-slim AS base

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.9.14
COPY . .
RUN turbo prune baergpt-frontend --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci
COPY --from=pruner /app/out/full/ .

ARG VERCEL_ENV=development
ARG VITE_VERCEL_ENV=development
ARG VITE_SUPABASE_URL=http://127.0.0.1:54321
ARG VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
ARG VITE_API_URL=http://localhost:3000
ARG VITE_MAX_TOTAL_FILES_UPLOADED=100
ARG VITE_UPLOAD_FILE_SIZE_LIMIT_MB=20
ARG VITE_MAX_PARALLEL_FILE_UPLOADS=5
ARG VITE_ADMIN_URL=http://localhost:5174
ARG VITE_SENTRY_URL=http://localhost:3000
ARG VITE_SENTRY_DSN=https://local@localhost/1
ARG VITE_SENTRY_ORG=local
ARG VITE_SENTRY_PROJECT=local
ARG VITE_TRACE_PROPAGATION_TARGETS=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:54321
ARG VITE_MATOMO_URL=
ARG VITE_MATOMO_SITE_ID=
ARG VITE_DEFAULT_DOCUMENT_PROCESSING_MODEL=fast
ARG VITE_FEATURE_FLAG_MCP_PARLA_ALLOWED=false
ARG VITE_FEATURE_FLAG_MCP_OPEN_DATA_ALLOWED=false
ARG VITE_FEATURE_FLAG_MCP_DATAWRAPPER_ALLOWED=false
ARG VITE_FEATURE_FLAG_WEB_SEARCH_ALLOWED=false
ARG VITE_FEATURE_FLAG_SPLASH_SCREEN_ALLOWED=false
ARG VITE_FEATURE_FLAG_EXPERIMENTAL_MODEL_ALLOWED=false
ARG VITE_FEATURE_FLAG_EXTENDED_THINKING_ALLOWED=true
ARG VITE_SPLASH_CONTENT_URL=http://localhost:5173
ARG VITE_SPLASH_API_COMMIT_URL=http://localhost:5173

ENV VERCEL_ENV=$VERCEL_ENV \
    VITE_VERCEL_ENV=$VITE_VERCEL_ENV \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL \
    VITE_MAX_TOTAL_FILES_UPLOADED=$VITE_MAX_TOTAL_FILES_UPLOADED \
    VITE_UPLOAD_FILE_SIZE_LIMIT_MB=$VITE_UPLOAD_FILE_SIZE_LIMIT_MB \
    VITE_MAX_PARALLEL_FILE_UPLOADS=$VITE_MAX_PARALLEL_FILE_UPLOADS \
    VITE_ADMIN_URL=$VITE_ADMIN_URL \
    VITE_SENTRY_URL=$VITE_SENTRY_URL \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ORG=$VITE_SENTRY_ORG \
    VITE_SENTRY_PROJECT=$VITE_SENTRY_PROJECT \
    VITE_TRACE_PROPAGATION_TARGETS=$VITE_TRACE_PROPAGATION_TARGETS \
    VITE_MATOMO_URL=$VITE_MATOMO_URL \
    VITE_MATOMO_SITE_ID=$VITE_MATOMO_SITE_ID \
    VITE_DEFAULT_DOCUMENT_PROCESSING_MODEL=$VITE_DEFAULT_DOCUMENT_PROCESSING_MODEL \
    VITE_FEATURE_FLAG_MCP_PARLA_ALLOWED=$VITE_FEATURE_FLAG_MCP_PARLA_ALLOWED \
    VITE_FEATURE_FLAG_MCP_OPEN_DATA_ALLOWED=$VITE_FEATURE_FLAG_MCP_OPEN_DATA_ALLOWED \
    VITE_FEATURE_FLAG_MCP_DATAWRAPPER_ALLOWED=$VITE_FEATURE_FLAG_MCP_DATAWRAPPER_ALLOWED \
    VITE_FEATURE_FLAG_WEB_SEARCH_ALLOWED=$VITE_FEATURE_FLAG_WEB_SEARCH_ALLOWED \
    VITE_FEATURE_FLAG_SPLASH_SCREEN_ALLOWED=$VITE_FEATURE_FLAG_SPLASH_SCREEN_ALLOWED \
    VITE_FEATURE_FLAG_EXPERIMENTAL_MODEL_ALLOWED=$VITE_FEATURE_FLAG_EXPERIMENTAL_MODEL_ALLOWED \
    VITE_FEATURE_FLAG_EXTENDED_THINKING_ALLOWED=$VITE_FEATURE_FLAG_EXTENDED_THINKING_ALLOWED \
    VITE_SPLASH_CONTENT_URL=$VITE_SPLASH_CONTENT_URL \
    VITE_SPLASH_API_COMMIT_URL=$VITE_SPLASH_API_COMMIT_URL

RUN npx turbo build --filter=baergpt-frontend

FROM base AS runner
WORKDIR /srv
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs web
COPY --from=builder --chown=web:nodejs /app/apps/frontend/dist ./dist
USER web
EXPOSE 5173
CMD ["node", "-e", "const http=require('http'),fs=require('fs'),path=require('path');const root='/srv/dist';const mimes={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.pdf':'application/pdf'};http.createServer((req,res)=>{const u=decodeURIComponent((req.url||'/').split('?')[0]);let p=path.resolve(root,'.'+u);if(!p.startsWith(root)){res.writeHead(403);return res.end();}if(fs.existsSync(p)&&fs.statSync(p).isDirectory()){p=path.join(p,'index.html');}if(!fs.existsSync(p)||!fs.statSync(p).isFile()){p=path.join(root,'index.html');}const ext=path.extname(p).toLowerCase();res.writeHead(200,{'Content-Type':mimes[ext]||'application/octet-stream'});fs.createReadStream(p).pipe(res);}).listen(5173,'0.0.0.0',()=>console.log('Frontend listening on http://localhost:5173'));"]
