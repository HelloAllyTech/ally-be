set -e

LOCALSTACK_CONTAINER_NAME="localstack"
LOCALSTACK_PORT=4566
AWS_REGION="us-east-1"
AWS_ACCESS_KEY="test"
AWS_SECRET_KEY="test"


echo "🧹 Cleaning up old LocalStack container (if any)..."
docker rm -f $LOCALSTACK_CONTAINER_NAME 2>/dev/null || true

#Start LocalStack container
echo "Starting LocalStack..."
docker run -d --rm \
  --name $LOCALSTACK_CONTAINER_NAME \
  -p ${LOCALSTACK_PORT}:4566 \
  -e SERVICES=sqs \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_KEY \
  -e DEFAULT_REGION=$AWS_REGION \
  localstack/localstack:latest

# Wait until LocalStack is ready
echo "Waiting for LocalStack SQS to become available..."
until curl -s http://localhost:${LOCALSTACK_PORT}/_localstack/health | jq -r '.services.sqs' | grep -q "available"; do
  echo "   ...still waiting..."
  sleep 2
done
echo "LocalStack SQS is available!"
# Function to create a queue if it doesn’t exist
create_queue() {
  QUEUE_NAME=$1
  echo "Ensuring queue exists: $QUEUE_NAME"
  if aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs get-queue-url --queue-name $QUEUE_NAME >/dev/null 2>&1; then
    echo "   ↳ Queue already exists: $QUEUE_NAME"
  else
    aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs create-queue --queue-name $QUEUE_NAME
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
  MAIN_QUEUE=$1
  DLQ_QUEUE=$2
  echo "🔗 Attaching DLQ $DLQ_QUEUE to $MAIN_QUEUE ..."

  MAIN_URL=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs get-queue-url --queue-name $MAIN_QUEUE --query 'QueueUrl' --output text)
  DLQ_URL=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs get-queue-url --queue-name $DLQ_QUEUE --query 'QueueUrl' --output text)
  DLQ_ARN=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs get-queue-attributes --queue-url $DLQ_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

aws --endpoint-url=http://localhost:${LOCALSTACK_PORT} sqs set-queue-attributes \
  --queue-url $MAIN_URL \
  --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"'"$DLQ_ARN"'\",\"maxReceiveCount\":\"5\"}"}'


  echo "Attached $DLQ_QUEUE as DLQ for $MAIN_QUEUE (maxReceiveCount=5)"
}

# Attach DLQs
attach_dlq "sqs-ai-transcription-request-queue" "sqs-ai-transcription-request-dlq"
attach_dlq "sqs-ai-transcription-response-queue" "sqs-ai-transcription-response-dlq"

echo "All queues and DLQs are ready!"
