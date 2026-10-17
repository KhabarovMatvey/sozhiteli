# syntax=docker/dockerfile:1
# Образ сервиса profile. Контекст сборки - каталог backend/:
#   docker build -f backend/services/profile/Dockerfile backend
# В контекст попадают только platform/ и код этого сервиса: сервис физически
# не может импортировать код другого сервиса.

FROM golang:1.27.2-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOWORK=off GOFLAGS=-trimpath

COPY platform/go.mod platform/go.sum platform/
COPY services/profile/go.mod services/profile/go.sum services/profile/
RUN --mount=type=cache,target=/go/pkg/mod     cd services/profile && go mod download

COPY platform platform
COPY services/profile services/profile
RUN --mount=type=cache,target=/go/pkg/mod     --mount=type=cache,target=/root/.cache/go-build     cd services/profile && go build -ldflags="-s -w" -o /out/profile ./cmd/profile

# Без оболочки и пакетного менеджера, процесс работает не от root.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/profile /profile
USER nonroot:nonroot
EXPOSE 8080 9080
ENTRYPOINT ["/profile"]
CMD ["serve"]
