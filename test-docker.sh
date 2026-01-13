#!/bin/bash
# Docker Test Runner Script for ally-be
# This script provides convenient commands to run tests in Docker containers

set -e

# Detect if colors are supported
if [ -t 1 ]; then
    # Colors for output (only if stdout is a terminal)
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    RED='\033[0;31m'
    NC='\033[0m' # No Color
else
    # No colors if output is not a terminal
    GREEN=''
    YELLOW=''
    BLUE=''
    RED=''
    NC=''
fi

# Show usage
show_usage() {
    echo -e "${BLUE}Docker Test Runner - ally-be${NC}"
    echo ""
    echo "Usage: ./test-docker.sh [command] [options]"
    echo ""
    echo "Commands:"
    echo -e "  ${GREEN}all${NC}           Run all unit tests"
    echo -e "  ${GREEN}unit${NC}          Run unit tests (same as 'all')"
    echo -e "  ${GREEN}e2e${NC}           Run end-to-end tests"
    echo -e "  ${GREEN}watch${NC}         Run tests in watch mode (in running dev containers)"
    echo -e "  ${GREEN}coverage${NC}      Run tests with coverage report"
    echo -e "  ${GREEN}clean${NC}         Clean up test containers and volumes"
    echo ""
    echo "Examples:"
    echo "  ./test-docker.sh all         # Run all unit tests"
    echo "  ./test-docker.sh e2e         # Run e2e tests"
    echo "  ./test-docker.sh coverage    # Generate coverage report"
    echo ""
}

# Clean up test containers and volumes
cleanup() {
    echo -e "${YELLOW}Cleaning up test containers and volumes...${NC}"
    docker-compose -f compose.test.yaml down -v --remove-orphans
    echo -e "${GREEN}Cleanup complete!${NC}"
}

# Run unit tests
run_unit_tests() {
    echo -e "${BLUE}Running unit tests in Docker...${NC}"
    docker-compose -f compose.test.yaml run --rm --remove-orphans test-runner
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ All unit tests passed!${NC}"
    else
        echo -e "${RED}✗ Tests failed with exit code $exit_code${NC}"
        exit $exit_code
    fi
}

# Run e2e tests
run_e2e_tests() {
    echo -e "${BLUE}Running e2e tests in Docker...${NC}"
    docker-compose -f compose.test.yaml run --rm --remove-orphans test-e2e
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ All e2e tests passed!${NC}"
    else
        echo -e "${RED}✗ E2E tests failed with exit code $exit_code${NC}"
        exit $exit_code
    fi
}

# Run tests with coverage
run_coverage() {
    echo -e "${BLUE}Running tests with coverage...${NC}"
    docker-compose -f compose.test.yaml run --rm --remove-orphans test-coverage
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Coverage report generated!${NC}"
        echo -e "${YELLOW}Coverage reports saved in ./coverage directory${NC}"
    else
        echo -e "${RED}✗ Coverage generation failed${NC}"
        exit $exit_code
    fi
}

# Run tests in watch mode (uses running dev containers)
run_watch_mode() {
    echo -e "${YELLOW}Starting tests in watch mode...${NC}"
    echo -e "${YELLOW}Note: This uses the running dev containers for fast iteration${NC}"
    echo -e "${YELLOW}Press Ctrl+C to exit${NC}"
    echo ""

    # Check if containers are running
    if ! docker-compose ps | grep -q "Up"; then
        echo -e "${RED}Dev containers are not running. Starting them...${NC}"
        docker-compose up -d
        sleep 5
    fi

    # Run tests in watch mode
    docker-compose exec app npm run test:watch
}

# Main script logic
case "${1:-help}" in
    all|unit)
        run_unit_tests
        ;;
    e2e)
        run_e2e_tests
        ;;
    watch)
        run_watch_mode
        ;;
    coverage)
        run_coverage
        ;;
    clean)
        cleanup
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        show_usage
        exit 1
        ;;
esac
