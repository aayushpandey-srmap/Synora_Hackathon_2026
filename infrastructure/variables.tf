variable "name" { type = string; default = "auction" }
variable "aws_region" { type = string; default = "us-east-1" }
variable "vpc_cidr" { type = string; default = "10.42.0.0/16" }
variable "frontend_image" { type = string; description = "Immutable registry URL and tag for frontend image." }
variable "desired_count" { type = number; default = 2; validation { condition = var.desired_count > 0; error_message = "desired_count must be positive." } }
