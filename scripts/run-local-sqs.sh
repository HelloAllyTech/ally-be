#!/usr/bin/env bash
set -e

LOCALSTACK_CONTAINER_NAME="localstack"
LOCALSTACK_PORT=4566
AWS_REGION="us-east-1"
AWS_ACCESS_KEY="test"
AWS_SECRET_KEY="test"


create_queue() {
  QUEUE_NAME=$1
  REGION=${AWS_REGION:-us-east-1}
  echo "Ensuring queue exists: $QUEUE_NAME"

  if aws --endpoint-url="http://localhost:${LOCALSTACK_PORT}" \
         --region "$REGION" \
         sqs get-queue-url --queue-name "$QUEUE_NAME" >/dev/null 2>&1; then
    echo "   ↳ Queue already exists: $QUEUE_NAME"
  else
    aws --endpoint-url="http://localhost:${LOCALSTACK_PORT}" \
        --region "$REGION" \
        sqs create-queue --queue-name "$QUEUE_NAME"
    echo "Created queue: $QUEUE_NAME"
  fi
}

#  Create required queues
create_queue "sqs-ai-transcription-request-queue"
create_queue "sqs-ai-transcription-response-queue"
create_queue "sqs-ai-transcription-request-dlq"
create_queue "sqs-ai-transcription-response-dlq"

# Function to attach DLQ
attach_dlq() {
  MAIN_QUEUE="$1"
  DLQ_QUEUE="$2"
  REGION="${AWS_REGION:-us-east-1}"
  ENDPOINT="http://localhost:${LOCALSTACK_PORT}"

  echo "🔗 Attaching DLQ $DLQ_QUEUE to $MAIN_QUEUE ..."

  MAIN_URL=$(aws --endpoint-url="$ENDPOINT" --region "$REGION" sqs get-queue-url --queue-name "$MAIN_QUEUE" --query 'QueueUrl' --output text)
  DLQ_URL=$(aws --endpoint-url="$ENDPOINT" --region "$REGION" sqs get-queue-url --queue-name "$DLQ_QUEUE" --query 'QueueUrl' --output text)
  DLQ_ARN=$(aws --endpoint-url="$ENDPOINT" --region "$REGION" sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

  aws --endpoint-url="$ENDPOINT" --region "$REGION" sqs set-queue-attributes \
    --queue-url "$MAIN_URL" \
    --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"'"$DLQ_ARN"'\",\"maxReceiveCount\":\"5\"}"}'

  echo " Attached $DLQ_QUEUE as DLQ for $MAIN_QUEUE (maxReceiveCount=5)"
}

# Attach DLQs
attach_dlq "sqs-ai-transcription-request-queue" "sqs-ai-transcription-request-dlq"
attach_dlq "sqs-ai-transcription-response-queue" "sqs-ai-transcription-response-dlq"

echo "All queues and DLQs are ready!"
