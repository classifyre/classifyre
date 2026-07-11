# Classifyre Desktop build entry points.
#
#   make deps      Install JS dependencies + fix native dylib symlinks
#   make stage     Build API/web and stage all bundled resources (python, venv…)
#   make package   Package the Electron app (no installers; requires `make stage` first)
#   make dist      Create platform installers (dmg / win zip / deb+rpm; requires `make stage` first)
#   make all       deps + stage + dist — a full from-scratch release build
#   make dev       Run the app in development mode
#   make test      Namespace lifecycle test
#   make e2e       Playwright end-to-end tests
#   make clean     Remove build output and staged resources
#
# Useful env toggles (see scripts/stage-resources.sh):
#   SKIP_PYTHON=1 SKIP_APP_BUILD=1 make stage   # fast dev iteration

.PHONY: all deps stage package dist dev test e2e clean

all: deps stage dist

deps:
	cd ../.. && bun install
	node scripts/postinstall.js

stage:
	bash scripts/stage-resources.sh

package:
	bun run build

dist:
	bun run make

dev:
	bun run dev

test:
	bun run test

e2e:
	bun run test:e2e

clean:
	rm -rf out .vite resources ../cli/.venv-desktop .python-dist
