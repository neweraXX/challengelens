FROM node:24-slim

WORKDIR /app
COPY --chown=node:node package.json /app/package.json
USER node

ENV NPM_CONFIG_CACHE=/tmp/npm-cache
ENV TSX_DISABLE_CACHE=1

# Bootstrap image only: dependencies are installed into the project bind mount.
# After generating package-lock.json, use npm ci --ignore-scripts for replay.
# Record an inspected node:24-slim digest before freezing the build.
CMD ["npm", "run", "typecheck"]
