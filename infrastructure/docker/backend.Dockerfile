FROM golang:1.23-alpine AS build
WORKDIR /src
COPY backend/go.mod ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/auction ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/auction /auction
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/auction"]
