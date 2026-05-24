variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for web servers"
  type        = string
  default     = "t3.micro"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_password" {
  description = "Password for the RDS PostgreSQL instance"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name (used for tagging)"
  type        = string
  default     = "demo"
}

variable "project_name" {
  description = "Project name (used for naming resources)"
  type        = string
  default     = "blast-radius-demo"
}
