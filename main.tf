terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1.0"
    }
  }
}

provider "aws" {
  region  = "us-east-1"
  profile = "terraform"
}

resource "random_id" "random_path" {
  byte_length = 16
}

resource "random_string" "random_token" {
  length           = 128
  special          = true
  override_special = "_-"
}

variable "telegram_token" {
  type      = string
  sensitive = true
}

variable "openai_token" {
  type      = string
  sensitive = true
}

variable "openai_max_token" {
  type      = number
  sensitive = false
}

variable "openai_temperature" {
  type      = number
  sensitive = false
}

resource "aws_ssm_parameter" "secret-token" {
  name  = "secret-token"
  type  = "SecureString"
  value = random_string.random_token.result
}

resource "aws_ssm_parameter" "bot-token" {
  name  = "bot-token"
  type  = "SecureString"
  value = var.telegram_token
}

resource "aws_ssm_parameter" "openai-token" {
  name  = "openai-token"
  type  = "SecureString"
  value = var.openai_token
}

data "external" "build" {
  program = [
    "bash", "-c", <<EOT
(npm run prezip) >&2 && echo "{\"dest\": \"package\"}"
EOT
  ]
  working_dir = "${path.module}/"
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/tattoo-lambda.zip"
  source_dir  = "${data.external.build.working_dir}/${data.external.build.result.dest}"
}

resource "aws_lambda_function" "auth_lambda" {
  function_name = "tattoo-authoriser"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  environment {
    variables = {
      domain       = aws_apigatewayv2_api.api.api_endpoint
      path_key     = random_id.random_path.hex
      secret_token = aws_ssm_parameter.secret-token.name
      bot_token    = aws_ssm_parameter.bot-token.name
    }
  }

  timeout = 30
  handler = "app.authorise"
  runtime = "nodejs14.x"
  role    = aws_iam_role.lambda_exec.arn
}

resource "aws_lambda_function" "app_lambda" {
  function_name = "tattoo-app"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  environment {
    variables = {
      bot_token          = aws_ssm_parameter.bot-token.name
      openai_token       = aws_ssm_parameter.openai-token.name
      openai_max_token   = var.openai_max_token
      openai_temperature = var.openai_temperature
      log_level          = "info"
    }
  }

  timeout = 30
  handler = "app.handler"
  runtime = "nodejs14.x"
  role    = aws_iam_role.lambda_exec.arn
}

data "aws_lambda_invocation" "set_webhook" {
  function_name = aws_lambda_function.auth_lambda.function_name

  input = <<JSON
{
	"setWebhook": true
}
JSON
}

data "aws_iam_policy_document" "lambda_exec_role_policy" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "arn:aws:logs:*:*:*"
    ]
  }
  statement {
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      aws_ssm_parameter.bot-token.arn,
      aws_ssm_parameter.openai-token.arn,
      aws_ssm_parameter.secret-token.arn,
    ]
  }
}

resource "aws_cloudwatch_log_group" "app_log" {
  name              = "/aws/lambda/${aws_lambda_function.app_lambda.function_name}"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "auth_log" {
  name              = "/aws/lambda/${aws_lambda_function.auth_lambda.function_name}"
  retention_in_days = 14
}


resource "aws_iam_role_policy" "lambda_exec_role" {
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec_role_policy.json
}

resource "aws_iam_role" "lambda_exec" {
  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow"
    }
  ]
}
EOF
}

# api gw

resource "aws_apigatewayv2_api" "api" {
  name          = "tattoo-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id           = aws_apigatewayv2_api.api.id
  integration_type = "AWS_PROXY"

  integration_method     = "POST"
  integration_uri        = aws_lambda_function.app_lambda.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_authorizer" "lambda_authorizer" {
  name                              = "Telegram-Bot-Api-Secret-Token"
  api_id                            = aws_apigatewayv2_api.api.id
  authorizer_payload_format_version = "2.0"
  authorizer_result_ttl_in_seconds  = 3600
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.auth_lambda.invoke_arn
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.x-telegram-bot-api-secret-token"]
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "ANY /${random_id.random_path.hex}/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.lambda_authorizer.id
}

resource "aws_lambda_permission" "apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app_lambda.arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_lambda.arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.lambda_authorizer.id}"
}
