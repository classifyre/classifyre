# Classifyre Minikube Validation (Local Only)

This guide is for local testing and development workflows only.
It is not intended as a production deployment guide.

## Fast Path

```bash
cd /unstructured
bash ./helm/test-minikube.sh
```

To force image rebuild after local API/CLI changes:

```bash
cd /unstructured
REBUILD_IMAGE=1 bash ./helm/test-minikube.sh
```

`test-minikube.sh`:

- builds/uses local `classifyre/all-in-one:k8s-dev` image,
- installs chart with `values-minikube.yaml`,
- validates `GET /` and `GET /api/ping` through web service.

## Manual Flow

1. Start minikube:

```bash
minikube start
```

2. Build/load local image:

```bash
cd /unstructured
minikube image build -t classifyre/all-in-one:k8s-dev -f ./Dockerfile --build-opt build-arg=WEB_API_URL=http://classifyre-api:8000 .
```

3. Install chart with local values:

```bash
cd /unstructured
helm upgrade --install classifyre ./helm/classifyre -n classifyre-dev --create-namespace -f ./helm/classifyre/values-minikube.yaml \
  --set api.image.repository=classifyre/all-in-one \
  --set api.image.tag=k8s-dev \
  --set frontend.image.repository=classifyre/all-in-one \
  --set frontend.image.tag=k8s-dev \
  --set api.cliJobs.image.repository=classifyre/all-in-one \
  --set api.cliJobs.image.tag=k8s-dev
```

4. Port-forward web and verify:

```bash
kubectl -n classifyre-dev port-forward svc/classifyre-web 3100:3100
curl -i http://127.0.0.1:3100/
curl -i http://127.0.0.1:3100/api/ping
```

5. Verify CLI job orchestration:

```bash
kubectl -n classifyre-dev get jobs -w
```

## Separate API/Web/CLI Images via Local Registry

Use this flow when validating split images (for example `classifyre/{api,web,cli}:main`).

1. Start Minikube:

```bash
minikube start --driver=docker
```

2. Use Minikube Docker daemon and run a local registry inside the node:

```bash
eval "$(minikube docker-env)"
export DOCKER_API_VERSION=1.43
docker run -d --restart=always -p 5000:5000 --name registry registry:2 || docker start registry
```

3. On Apple Silicon / ARM nodes, install amd64 emulation if the source images are amd64-only:

```bash
docker run --privileged --rm tonistiigi/binfmt --install amd64
```

4. Pull and mirror split images into local registry:

```bash
docker pull --platform linux/amd64 classifyre/api:main
docker pull --platform linux/amd64 classifyre/web:main
docker pull --platform linux/amd64 classifyre/cli:main

docker tag classifyre/api:main localhost:5000/classifyre/api:main
docker tag classifyre/web:main localhost:5000/classifyre/web:main
docker tag classifyre/cli:main localhost:5000/classifyre/cli:main

docker push localhost:5000/classifyre/api:main
docker push localhost:5000/classifyre/web:main
docker push localhost:5000/classifyre/cli:main
```

5. Deploy with split-image Minikube values:

```bash
helm upgrade --install classifyre-local ./helm/classifyre \
  -n classifyre-local \
  --create-namespace \
  -f ./helm/classifyre/values-minikube-separate-images.yaml \
  --wait --timeout 15m
```

6. Validate web + api:

```bash
kubectl -n classifyre-local port-forward svc/classifyre-local-web 3100:3100
curl -i http://127.0.0.1:3100/
curl -i http://127.0.0.1:3100/api/ping
```
