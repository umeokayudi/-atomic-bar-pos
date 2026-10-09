#!/usr/bin/env bash
set -euo pipefail

# Build and create a Vercel preview deployment.
# Production promotion is intentionally done separately in the Vercel dashboard.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

npm ci
npm run build
npx vercel deploy --yes
