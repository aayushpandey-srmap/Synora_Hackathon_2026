# Infrastructure

Baseline AWS ECS/Fargate deployment for the frontend behind a public ALB. The
sample uses public subnets to stay small; production deployments should add
private subnets/NAT, HTTPS (ACM), WAF, autoscaling, and a managed secret store.

```sh
docker build -f infrastructure/docker/frontend.Dockerfile -t auction-frontend .
terraform init
terraform plan -var 'frontend_image=registry.example/auction-frontend:sha'
terraform apply -var 'frontend_image=registry.example/auction-frontend:sha'
```

Never commit `*.tfvars` containing credentials. Use an AWS role/profile and
immutable image digests in CI.
