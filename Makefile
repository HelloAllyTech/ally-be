HEALTH_URL := http://localhost:8001/api/health
MAX_RETRIES := 30
SLEEP_SECONDS := 2

health-check:
	@echo "⏳ Waiting for service to become healthy at $(HEALTH_URL) ..."
	@healthy=false; \
	for i in $$(seq 1 $(MAX_RETRIES)); do \
		if curl -fs "$(HEALTH_URL)" > /dev/null; then \
			echo "✅ Service is healthy!"; \
			healthy=true; \
			break; \
		fi; \
		echo "🔄 Attempt $$i/$(MAX_RETRIES): Service not ready yet..."; \
		sleep $(SLEEP_SECONDS); \
	done; \
	if [ "$$healthy" != true ]; then \
		echo "❌ Service did not become healthy after $$(( $(MAX_RETRIES) * $(SLEEP_SECONDS) )) seconds"; \
		exit 1; \
	fi